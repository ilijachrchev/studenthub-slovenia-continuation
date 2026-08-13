const express = require("express");
const rateLimit = require("express-rate-limit");
const catchAsync = require("../middleware/catchAsync");
const { requireRole } = require("../middleware/auth");
const { buildOpportunityAnalytics, insertAnalyticsEvents, normalizeEventInput } = require("../lib/opportunity/analytics");

const router = express.Router();

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many analytics events, please slow down" },
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.events)) return value.events;
  if (value && typeof value === "object" && value.eventType) return [value];
  if (value && typeof value === "object" && value.event_type) return [value];
  return [];
}

router.post("/analytics/events", analyticsLimiter, catchAsync(async (req, res) => {
  const client = await require("../db").connect();
  try {
    const events = asArray(req.body);
    const normalized = events.map(normalizeEventInput).filter(Boolean);
    if (normalized.length === 0) {
      return res.status(400).json({ error: "At least one valid analytics event is required" });
    }

    const inserted = await insertAnalyticsEvents(
      client,
      normalized,
      req.session.user?.id || null
    );

    res.status(201).json({ inserted });
  } finally {
    client.release();
  }
}));

router.get("/organizer/opportunities/:id/analytics", requireRole("organizer"), catchAsync(async (req, res) => {
  const client = await require("../db").connect();
  try {
    const { rows: ownerRows } = await client.query(
      `SELECT o.id
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
       WHERE o.id = $1 AND op.user_id = $2`,
      [req.params.id, req.session.user.id]
    );

    if (ownerRows.length === 0) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const analytics = await buildOpportunityAnalytics(req.params.id, client);
    if (!analytics) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    res.json(analytics);
  } finally {
    client.release();
  }
}));

module.exports = router;
