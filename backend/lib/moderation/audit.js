const pool = require("../../db");

const BLOCKED_METADATA_KEYS = new Set([
  "comment",
  "comments",
  "details",
  "email",
  "message",
  "note",
  "notes",
  "reason",
  "resolution_note",
  "summary",
  "text",
]);

function scrubMetadata(value) {
  if (Array.isArray(value)) {
    return value.map(scrubMetadata);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (BLOCKED_METADATA_KEYS.has(key.toLowerCase())) {
      return acc;
    }

    acc[key] = scrubMetadata(entry);
    return acc;
  }, {});
}

async function recordModerationAudit({
  actorUserId,
  action,
  resourceType,
  resourceId,
  metadata,
  client,
}) {
  if (!actorUserId || !action || !resourceType || !resourceId) {
    return null;
  }

  const db = client || pool;
  const safeMetadata = scrubMetadata(metadata || {});

  const { rows } = await db.query(
    `INSERT INTO moderation_audit_log
      (actor_user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, actor_user_id, action, resource_type, resource_id, metadata, created_at`,
    [actorUserId, action, resourceType, resourceId, JSON.stringify(safeMetadata)]
  );

  return rows[0] || null;
}

module.exports = {
  recordModerationAudit,
  scrubMetadata,
};
