const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");
const { notificationLimiter } = require("../middleware/rateLimits");
const {
  parsePositiveInteger,
  validateNotificationPreferencesInput,
} = require("../validators/input");

const router = express.Router();

const DEFAULT_PREFERENCES = {
  "application.received": true,
  "application.status_changed": true,
};

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function parsePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

router.get("/", requireAuth, catchAsync(async (req, res) => {
  const userId = req.session.user.id;
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const unreadOnly = parseBoolean(req.query.unread);
  const offset = (page - 1) * limit;

  const filters = ["recipient_user_id = $1"];
  const values = [userId];
  if (unreadOnly === true) {
    filters.push(`is_read = false`);
  }

  const whereClause = filters.join(" AND ");

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM notification WHERE ${whereClause}`,
    values
  );

  const { rows: unreadRows } = await pool.query(
    "SELECT COUNT(*)::int AS unread_count FROM notification WHERE recipient_user_id = $1 AND is_read = false",
    [userId]
  );

  const { rows } = await pool.query(
    `SELECT id, recipient_user_id, type, payload, is_read, created_at, read_at
     FROM notification
     WHERE ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  res.json({
    items: rows,
    page,
    limit,
    total: countRows[0].total,
    unread_count: unreadRows[0].unread_count,
  });
}));

router.post("/:id/read", requireAuth, notificationLimiter, catchAsync(async (req, res) => {
  const notificationId = parsePositiveInteger(req.params.id);
  if (!notificationId) {
    return res.status(404).json({ error: "Notification not found" });
  }

  const { rowCount, rows } = await pool.query(
    `UPDATE notification
     SET is_read = true,
         read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND recipient_user_id = $2
     RETURNING id, recipient_user_id, type, payload, is_read, created_at, read_at`,
    [notificationId, req.session.user.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "Notification not found" });
  }

  res.json({ notification: rows[0] });
}));

router.post("/read-all", requireAuth, notificationLimiter, catchAsync(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE notification
     SET is_read = true,
         read_at = COALESCE(read_at, NOW())
     WHERE recipient_user_id = $1 AND is_read = false`,
    [req.session.user.id]
  );

  res.json({ message: "Notifications marked as read", count: rowCount });
}));

router.get("/preferences", requireAuth, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT preferences FROM notification_preferences WHERE user_id = $1",
    [req.session.user.id]
  );

  res.json({
    preferences: rows.length ? rows[0].preferences : DEFAULT_PREFERENCES,
  });
}));

router.put("/preferences", requireAuth, notificationLimiter, catchAsync(async (req, res) => {
  const validation = validateNotificationPreferencesInput(req.body);
  if (validation.errors.length > 0) {
    return res.status(400).json({ error: validation.errors[0] });
  }

  const { rows } = await pool.query(
    `INSERT INTO notification_preferences (user_id, preferences, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()
     RETURNING preferences`,
    [req.session.user.id, JSON.stringify(validation.value)]
  );

  res.json({ preferences: rows[0].preferences });
}));

module.exports = router;
