const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { recordEvent } = require("../lib/opportunity/analytics");

const router = express.Router();

const requireStudent = requireRole("student");
const requireAdmin = requireRole("admin");

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reports, please try again later" },
});

function firstPresent(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
}

router.post("/opportunities/:id/report", requireStudent, reportLimiter, catchAsync(async (req, res) => {
  const opportunityId = req.params.id;
  const reason = firstPresent(req.body, ["reason"]);
  const details = firstPresent(req.body, ["details"]) || null;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "Reason is required" });
  }

  const { rows: opportunityRows } = await pool.query(
    `SELECT e.id
     FROM event e
     WHERE e.id = $1`,
    [opportunityId]
  );

  if (opportunityRows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO opportunity_report
        (opportunity_id, reporter_user_id, reason, details)
       VALUES ($1, $2, $3, $4)
       RETURNING id, opportunity_id, reporter_user_id, reason, details, status, created_at`,
      [
        opportunityId,
        req.session.user.id,
        String(reason).trim(),
        details && String(details).trim() ? String(details).trim() : null,
      ]
    );

    await recordEvent("opportunity_reported", {
      actorUserId: req.session.user.id,
      opportunityId,
      metadata: {
        reportId: rows[0].id,
        reason: String(reason).trim(),
      },
    });

    res.status(201).json({ report: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "You have already reported this opportunity" });
    }

    logger.error({ err: error }, "Opportunity report failed");
    res.status(500).json({ error: "Internal server error" });
  }
}));

router.get("/admin/moderation/reports", requireAdmin, catchAsync(async (req, res) => {
  const status = firstPresent(req.query, ["status"]);
  const params = [];
  let whereClause = "";

  if (status) {
    params.push(status);
    whereClause = `WHERE r.status = $1`;
  }

  const { rows } = await pool.query(
    `SELECT r.id, r.opportunity_id, r.reporter_user_id, r.reason, r.details,
            r.status, r.resolved_by_user_id, r.resolved_at, r.created_at,
            e.title AS opportunity_title,
            u.email AS reporter_email,
            resolver.email AS resolved_by_email
     FROM opportunity_report r
     JOIN event e ON e.id = r.opportunity_id
     JOIN "user" u ON u.id = r.reporter_user_id
     LEFT JOIN "user" resolver ON resolver.id = r.resolved_by_user_id
     ${whereClause}
     ORDER BY
       CASE r.status
         WHEN 'open' THEN 0
         WHEN 'reviewing' THEN 1
         WHEN 'resolved' THEN 2
         WHEN 'dismissed' THEN 3
         ELSE 4
       END,
       r.created_at DESC,
       r.id DESC`,
    params
  );

  res.json({ reports: rows });
}));

router.post("/admin/moderation/reports/:id/resolve", requireAdmin, catchAsync(async (req, res) => {
  const reportId = req.params.id;
  const status = firstPresent(req.body, ["status", "resolution"]);

  if (!["resolved", "dismissed"].includes(status)) {
    return res.status(400).json({ error: "status must be resolved or dismissed" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE opportunity_report
       SET status = $1,
           resolved_by_user_id = $2,
           resolved_at = NOW()
       WHERE id = $3
       RETURNING id, opportunity_id, reporter_user_id, reason, details, status, resolved_by_user_id, resolved_at, created_at`,
      [status, req.session.user.id, reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    await recordEvent(
      "report.resolved",
      {
        actorUserId: req.session.user.id,
        opportunityId: rows[0].opportunity_id,
        metadata: {
          reportId: rows[0].id,
          status,
        },
      },
      client
    );

    await client.query("COMMIT");
    res.json({ report: rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Report resolution failed");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

router.get("/admin/analytics/overview", requireAdmin, catchAsync(async (req, res) => {
  const [
    users,
    opportunities,
    publishedOpportunities,
    reportsOpen,
    reportsClosed,
    views30d,
    clicks30d,
    reports30d,
    registrations30d,
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM "user"'),
    pool.query("SELECT COUNT(*)::int AS count FROM event"),
    pool.query("SELECT COUNT(*)::int AS count FROM event WHERE status = 'published'"),
    pool.query("SELECT COUNT(*)::int AS count FROM opportunity_report WHERE status IN ('open', 'reviewing')"),
    pool.query("SELECT COUNT(*)::int AS count FROM opportunity_report WHERE status IN ('resolved', 'dismissed')"),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM analytics_events
       WHERE event_type = 'opportunity_viewed'
         AND created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM analytics_events
       WHERE event_type = 'recommendation_clicked'
         AND created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM opportunity_report
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM registration
       WHERE registered_at >= NOW() - INTERVAL '30 days'`
    ),
  ]);

  res.json({
    counts: {
      users: users.rows[0].count,
      opportunities: opportunities.rows[0].count,
      published_opportunities: publishedOpportunities.rows[0].count,
      reports_open: reportsOpen.rows[0].count,
      reports_closed: reportsClosed.rows[0].count,
    },
    activity_30d: {
      opportunity_views: views30d.rows[0].count,
      recommendation_clicks: clicks30d.rows[0].count,
      reports_created: reports30d.rows[0].count,
      registrations: registrations30d.rows[0].count,
    },
  });
}));

module.exports = router;


