const pool = require("../../db");
const logger = require("../../middleware/logger");

const VALID_EVENT_TYPES = new Set([
  "opportunity_view",
  "opportunity_saved",
  "opportunity_unsaved",
  "opportunity_applied",
  "opportunity_withdrawn",
  "opportunity_reported",
  "recommendation_clicked",
]);

function normalizeEventType(value) {
  return String(value || "").trim().toLowerCase();
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEventInput(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const eventType = normalizeEventType(
    event.eventType ?? event.event_type ?? event.name ?? event.type
  );
  const opportunityId = parseId(event.opportunityId ?? event.opportunity_id);

  if (!VALID_EVENT_TYPES.has(eventType) || !opportunityId) {
    return null;
  }

  return {
    eventType,
    opportunityId,
  };
}

async function recordEvent(eventType, options = {}, client) {
  const normalizedType = normalizeEventType(eventType);
  const opportunityId = parseId(options.opportunityId);
  const userId = parseId(options.userId);

  if (!VALID_EVENT_TYPES.has(normalizedType) || !opportunityId) {
    return null;
  }

  const db = client || pool;

  try {
    const { rows } = await db.query(
      `INSERT INTO opportunity_event (opportunity_id, user_id, event_type)
       VALUES ($1, $2, $3)
       RETURNING id, opportunity_id, user_id, event_type, created_at`,
      [opportunityId, userId, normalizedType]
    );

    return rows[0] || null;
  } catch (error) {
    logger.warn({ err: error, eventType: normalizedType }, "analytics event insert skipped");
    return null;
  }
}

async function insertAnalyticsEvents(client, events, userId = null) {
  const inserted = [];
  for (const event of events) {
    const normalized = normalizeEventInput(event);
    if (!normalized) continue;
    const row = await recordEvent(normalized.eventType, {
      opportunityId: normalized.opportunityId,
      userId,
    }, client);
    if (row) {
      inserted.push(row);
    }
  }
  return inserted;
}

async function buildOpportunityAnalytics(opportunityId, client) {
  const db = client || pool;
  const parsedOpportunityId = parseId(opportunityId);
  if (!parsedOpportunityId) {
    return null;
  }

  const { rows: opportunityRows } = await db.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at,
            org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1`,
    [parsedOpportunityId]
  );

  if (opportunityRows.length === 0) {
    return null;
  }

  const opportunity = opportunityRows[0];

  const [
    viewsResult,
    savedResult,
    appliedResult,
    reviewResult,
    acceptedResult,
    rejectedResult,
    withdrawnResult,
    timelineResult,
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM opportunity_event
       WHERE opportunity_id = $1 AND event_type = 'opportunity_view'`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM opportunity_event
       WHERE opportunity_id = $1 AND event_type = 'opportunity_saved'`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM application
       WHERE opportunity_id = $1`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM application
       WHERE opportunity_id = $1 AND status IN ('under_review', 'shortlisted')`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM application
       WHERE opportunity_id = $1 AND status = 'accepted'`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM application
       WHERE opportunity_id = $1 AND status = 'rejected'`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM application
       WHERE opportunity_id = $1 AND status = 'withdrawn'`,
      [parsedOpportunityId]
    ),
    db.query(
      `SELECT DATE(created_at)::text AS date, COUNT(*)::int AS count
       FROM opportunity_event
       WHERE opportunity_id = $1
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`,
      [parsedOpportunityId]
    ),
  ]);

  const views = Number(viewsResult.rows[0]?.count || 0);
  const applications = Number(appliedResult.rows[0]?.count || 0);

  return {
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      description: opportunity.description,
      location: opportunity.location,
      status: opportunity.status,
      deadline: opportunity.deadline,
      organization_name: opportunity.organization_name,
      created_at: opportunity.created_at,
    },
    summary: {
      views,
      visits: views,
      bookmarks: Number(savedResult.rows[0]?.count || 0),
      applications,
      reviews: Number(reviewResult.rows[0]?.count || 0),
      accepts: Number(acceptedResult.rows[0]?.count || 0),
      rejects: Number(rejectedResult.rows[0]?.count || 0),
      withdrawn: Number(withdrawnResult.rows[0]?.count || 0),
      conversion: views > 0 ? applications / views : 0,
    },
    funnel: [
      { stage: "views", count: views },
      { stage: "bookmarks", count: Number(savedResult.rows[0]?.count || 0) },
      { stage: "applications", count: applications },
      { stage: "reviews", count: Number(reviewResult.rows[0]?.count || 0) },
      { stage: "accepts", count: Number(acceptedResult.rows[0]?.count || 0) },
      { stage: "rejects", count: Number(rejectedResult.rows[0]?.count || 0) },
    ],
    timeseries: timelineResult.rows.map((row) => ({
      date: row.date,
      count: Number(row.count || 0),
    })),
  };
}

module.exports = {
  VALID_EVENT_TYPES,
  buildOpportunityAnalytics,
  insertAnalyticsEvents,
  normalizeEventInput,
  normalizeEventType,
  recordEvent,
};
