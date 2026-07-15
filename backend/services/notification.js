const pool = require("../db");

const NOTIFICATION_TYPES = {
  REGISTRATION: "registration",
  EVENT_APPROVED: "event_approved",
  EVENT_REJECTED: "event_rejected",
  EVENT_CANCELLED: "event_cancelled",
};

async function create({ userId, type, title, message, relatedId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notification (user_id, type, title, message, related_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, type, title, message, related_id, is_read, created_at`,
    [userId, type, title, message, relatedId]
  );
  return rows[0];
}

async function getByUser(userId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  const [notifs, countResult] = await Promise.all([
    pool.query(
      `SELECT id, user_id, type, title, message, is_read, related_id, created_at
       FROM notification
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(
      "SELECT COUNT(*)::int AS total FROM notification WHERE user_id = $1",
      [userId]
    ),
  ]);

  return {
    notifications: notifs.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

async function getUnreadCount(userId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM notification WHERE user_id = $1 AND is_read = FALSE",
    [userId]
  );
  return rows[0].count;
}

async function markAsRead(notificationId, userId) {
  const { rowCount } = await pool.query(
    "UPDATE notification SET is_read = TRUE WHERE id = $1 AND user_id = $2",
    [notificationId, userId]
  );
  return rowCount > 0;
}

async function markAllAsRead(userId) {
  const { rowCount } = await pool.query(
    "UPDATE notification SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
    [userId]
  );
  return rowCount;
}

async function remove(notificationId, userId) {
  const { rowCount } = await pool.query(
    "DELETE FROM notification WHERE id = $1 AND user_id = $2",
    [notificationId, userId]
  );
  return rowCount > 0;
}

module.exports = {
  NOTIFICATION_TYPES,
  create,
  getByUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  remove,
};
