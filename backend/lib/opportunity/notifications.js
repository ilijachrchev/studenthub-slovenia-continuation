const pool = require("../../db");

const TYPE_ALIASES = {
  "application.received": ["application_updates"],
  "application.status_changed": ["application_updates"],
  "opportunity.recommendation": ["recommendation_updates"],
  "opportunity.deadline_reminder": ["deadline_reminders"],
};

function isEnabledForType(preferences, type) {
  if (!preferences || typeof preferences !== "object") {
    return true;
  }

  const keys = [type, ...(TYPE_ALIASES[type] || [])];

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(preferences, key) && preferences[key] === false) {
      return false;
    }
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(preferences, key) && preferences[key] === true) {
      return true;
    }
  }

  return true;
}

async function emit(recipientUserId, type, payload, client) {
  if (!recipientUserId || !type) {
    return null;
  }

  const db = client || pool;
  const { rows: prefRows } = await db.query(
    "SELECT preferences FROM notification_preferences WHERE user_id = $1",
    [recipientUserId]
  );

  const preferences = prefRows.length ? prefRows[0].preferences : null;
  if (!isEnabledForType(preferences, type)) {
    return null;
  }

  const { rows } = await db.query(
    `INSERT INTO notification (recipient_user_id, type, payload)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, recipient_user_id, type, payload, is_read, created_at, read_at`,
    [recipientUserId, type, JSON.stringify(payload || {})]
  );

  return rows[0] || null;
}

module.exports = {
  emit,
  isEnabledForType,
};
