const ALLOWED_EVENTS = new Set([
  "opportunity_view",
  "opportunity_saved",
  "opportunity_unsaved",
  "opportunity_applied",
  "opportunity_report_clicked",
]);

function normalizeCapturedEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const name = typeof event.event === "string" ? event.event.trim() : "";
  const opportunityId = Number.parseInt(event.opportunityId ?? event.opportunity_id, 10);

  if (!ALLOWED_EVENTS.has(name) || !Number.isFinite(opportunityId)) {
    return null;
  }

  const payload = { ...event };
  delete payload.event;
  delete payload.opportunityId;
  delete payload.opportunity_id;

  return {
    event_name: name,
    opportunity_id: opportunityId,
    metadata: payload,
  };
}

async function insertAnalyticsEvents(client, events, actorUserId, visitorKey) {
  const normalized = events.map(normalizeCapturedEvent).filter(Boolean);
  if (normalized.length === 0) {
    return 0;
  }

  const values = [];
  const placeholders = normalized.map((item, index) => {
    const base = index * 5;
    values.push(
      item.opportunity_id,
      item.event_name,
      actorUserId || null,
      visitorKey || null,
      JSON.stringify(item.metadata || {})
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`;
  });

  await client.query(
    `INSERT INTO opportunity_analytics_event
     (opportunity_id, event_name, actor_user_id, visitor_key, metadata)
     VALUES ${placeholders.join(", ")}`,
    values
  );

  return normalized.length;
}

async function loadOpportunityAnalytics(client, opportunityId, ownerUserId) {
  const { rows: ownershipRows } = await client.query(
    `SELECT o.id, o.title, o.description, o.status, o.deadline, o.created_at,
            org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE o.id = $1 AND op.user_id = $2`,
    [opportunityId, ownerUserId]
  );

  if (ownershipRows.length === 0) {
    return null;
  }

  const opportunity = ownershipRows[0];

  const { rows: eventRows } = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_name = 'opportunity_view')::int AS views,
       COUNT(DISTINCT visitor_key) FILTER (WHERE event_name = 'opportunity_view')::int AS visits,
       COUNT(*) FILTER (WHERE event_name = 'opportunity_saved')::int AS saves,
       COUNT(*) FILTER (WHERE event_name = 'opportunity_applied')::int AS applied_events
     FROM opportunity_analytics_event
     WHERE opportunity_id = $1`,
    [opportunityId]
  );

  const { rows: applicationRows } = await client.query(
    `SELECT
       COUNT(*)::int AS applications,
       COUNT(*) FILTER (WHERE status IN ('under_review', 'shortlisted'))::int AS reviews,
       COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepts,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejects
     FROM application
     WHERE opportunity_id = $1`,
    [opportunityId]
  );

  const summaryBase = eventRows[0] || {};
  const applicationBase = applicationRows[0] || {};
  const applications = Number(applicationBase.applications || 0);
  const accepts = Number(applicationBase.accepts || 0);
  const summary = {
    views: Number(summaryBase.views || 0),
    visits: Number(summaryBase.visits || 0),
    applications,
    reviews: Number(applicationBase.reviews || 0),
    accepts,
    rejects: Number(applicationBase.rejects || 0),
    conversion: applications > 0 ? accepts / applications : 0,
  };

  const funnel = [
    { stage: "views", count: summary.views },
    { stage: "visits", count: summary.visits },
    { stage: "applications", count: summary.applications },
    { stage: "reviews", count: summary.reviews },
    { stage: "accepts", count: summary.accepts },
    { stage: "rejects", count: summary.rejects },
  ];

  const { rows: timeseriesRows } = await client.query(
    `SELECT day::date AS date, COUNT(*)::int AS count
     FROM (
       SELECT date_trunc('day', created_at) AS day
       FROM opportunity_analytics_event
       WHERE opportunity_id = $1
       UNION ALL
       SELECT date_trunc('day', created_at) AS day
       FROM application
       WHERE opportunity_id = $1
     ) activity
     GROUP BY day
     ORDER BY day ASC`,
    [opportunityId]
  );

  return {
    opportunity,
    summary,
    funnel,
    timeseries: timeseriesRows.map((row) => ({
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
      count: Number(row.count || 0),
    })),
  };
}

module.exports = {
  ALLOWED_EVENTS,
  insertAnalyticsEvents,
  loadOpportunityAnalytics,
  normalizeCapturedEvent,
};
