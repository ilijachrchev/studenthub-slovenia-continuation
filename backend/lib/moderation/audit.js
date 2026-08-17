const pool = require("../../db");

/**
 * Appends one immutable moderation audit record. Never call UPDATE/DELETE
 * against moderation_audit_log — the database itself rejects those
 * statements (see the 20260817000001 migration trigger), so the only way to
 * "correct" history is to append a new, superseding entry.
 *
 * @param {object} params
 * @param {number|null} params.actorUserId - who performed the action; null for system-initiated entries.
 * @param {string} params.action - short verb, e.g. "report_created", "report_claimed".
 * @param {string} params.targetType - polymorphic target discriminator, e.g. "opportunity".
 * @param {number} params.targetId
 * @param {number|null} [params.reportId] - the moderation_report this action relates to, if any.
 * @param {object} [params.metadata] - JSON-serializable context. Never put secrets or full PII here.
 * @param {object} [params.client] - an in-flight transaction client; falls back to the pool.
 */
async function recordModerationAudit({
  actorUserId = null,
  action,
  targetType,
  targetId,
  reportId = null,
  metadata = {},
  client,
}) {
  if (!action || !targetType || !targetId) {
    throw new Error("recordModerationAudit requires action, targetType and targetId");
  }

  const db = client || pool;
  const { rows } = await db.query(
    `INSERT INTO moderation_audit_log (actor_user_id, action, target_type, target_id, report_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, actor_user_id, action, target_type, target_id, report_id, metadata, created_at`,
    [actorUserId, action, targetType, targetId, reportId, JSON.stringify(metadata || {})]
  );

  return rows[0];
}

async function loadAuditTrailForReport(client, reportId) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT id, actor_user_id, action, target_type, target_id, report_id, metadata, created_at
     FROM moderation_audit_log
     WHERE report_id = $1
     ORDER BY created_at ASC, id ASC`,
    [reportId]
  );
  return rows;
}

async function loadAuditTrailForTarget(client, targetType, targetId) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT id, actor_user_id, action, target_type, target_id, report_id, metadata, created_at
     FROM moderation_audit_log
     WHERE target_type = $1 AND target_id = $2
     ORDER BY created_at ASC, id ASC`,
    [targetType, targetId]
  );
  return rows;
}

module.exports = {
  recordModerationAudit,
  loadAuditTrailForReport,
  loadAuditTrailForTarget,
};
