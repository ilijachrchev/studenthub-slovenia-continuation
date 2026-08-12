const pool = require("../../db");
const logger = require("../../middleware/logger");

async function recordEvent(eventType, options = {}, client) {
  const {
    actorUserId = null,
    opportunityId = null,
    applicationId = null,
    metadata = {},
  } = options;

  const db = client || pool;

  try {
    const { rows } = await db.query(
      `INSERT INTO analytics_events
        (event_type, actor_user_id, opportunity_id, application_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_type, actor_user_id, opportunity_id, application_id, metadata, created_at`,
      [
        eventType,
        actorUserId,
        opportunityId,
        applicationId,
        metadata && typeof metadata === "object" ? metadata : {},
      ]
    );

    return rows[0] || null;
  } catch (error) {
    logger.warn({ err: error, eventType }, "analytics event insert skipped");
    return null;
  }
}

module.exports = { recordEvent };


