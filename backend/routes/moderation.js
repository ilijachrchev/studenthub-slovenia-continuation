const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { buildOpportunityAnalytics, recordEvent } = require("../lib/opportunity/analytics");
const { recordModerationAudit } = require("../lib/moderation/audit");

const router = express.Router();

const requireAdmin = requireRole("admin");
const requireStudent = requireRole("student");

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reports, please try again later" },
});

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parsePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 20;
}

function parseBoolean(value) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return false;
}

async function loadAuditTrail(client, reportId) {
  const { rows } = await client.query(
    `SELECT id, actor_user_id, action, resource_type, resource_id, metadata, created_at
     FROM moderation_audit_log
     WHERE resource_type = 'opportunity_report' AND resource_id = $1
     ORDER BY created_at ASC, id ASC`,
    [reportId]
  );

  return rows.map((row) => ({
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

async function loadReport(client, reportId) {
  const { rows } = await client.query(
    `SELECT r.id, r.opportunity_id, r.reporter_user_id, r.reason, r.details, r.status,
            r.resolution_note, r.resolved_by_user_id, r.created_at, r.updated_at,
            o.title AS opportunity_title, o.status AS opportunity_status,
            org.name AS organization_name,
            reporter.first_name || ' ' || reporter.last_name AS reporter_name,
            reporter.email AS reporter_email,
            resolver.email AS resolved_by_email
     FROM opportunity_report r
     JOIN opportunity o ON o.id = r.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     JOIN "user" reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN "user" resolver ON resolver.id = r.resolved_by_user_id
     WHERE r.id = $1`,
    [reportId]
  );

  return rows[0] || null;
}

function serializeReport(row, auditTrail = []) {
  return {
    id: row.id,
    opportunity_id: row.opportunity_id,
    opportunity_title: row.opportunity_title,
    opportunity_status: row.opportunity_status,
    organization_name: row.organization_name,
    reporter_user_id: row.reporter_user_id,
    reporter_name: row.reporter_name,
    reporter_email: row.reporter_email,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution_note: row.resolution_note,
    resolved_by_user_id: row.resolved_by_user_id,
    resolved_by_email: row.resolved_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
    audit_trail: auditTrail.map((entry) => ({
      id: entry.id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      actor_user_id: entry.actor_user_id,
      created_at: entry.created_at,
      metadata: entry.metadata,
    })),
  };
}

router.post("/opportunities/:id/report", requireStudent, reportLimiter, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  const details = typeof req.body.details === "string" ? req.body.details.trim() : "";

  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  if (!reason) {
    return res.status(400).json({ error: "Reason is required" });
  }

  const { rows: opportunityRows } = await pool.query(
    `SELECT o.id
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved'`,
    [opportunityId]
  );

  if (opportunityRows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO opportunity_report
        (opportunity_id, reporter_user_id, reason, details, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id, opportunity_id, reporter_user_id, reason, details, status, resolution_note,
                 resolved_by_user_id, created_at, updated_at`,
      [
        opportunityId,
        req.session.user.id,
        reason,
        details || null,
      ]
    );

    const report = rows[0];

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_created",
      resourceType: "opportunity_report",
      resourceId: report.id,
      metadata: {
        opportunity_id: opportunityId,
      },
    });

    await recordEvent("opportunity_reported", {
      userId: req.session.user.id,
      opportunityId,
    });

    res.status(201).json({ report });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "You have already reported this opportunity" });
    }

    logger.error({ err: error }, "Opportunity report creation failed");
    res.status(500).json({ error: "Internal server error" });
  }
}));

router.get("/admin/moderation/reports", requireAdmin, catchAsync(async (req, res) => {
  const status = normalizeStatus(req.query.status || "open");
  const page = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit);

  const allowed = new Set(["open", "in_review", "resolved", "dismissed", "all"]);
  if (!allowed.has(status)) {
    return res.status(400).json({ error: "Invalid report status filter" });
  }

  const values = [];
  const filters = [];
  if (status !== "all") {
    values.push(status);
    filters.push(`r.status = $${values.length}`);
  }
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM opportunity_report r
     ${whereSql}`,
    values
  );

  const total = countResult.rows[0]?.total || 0;
  const listValues = [...values, limit, (page - 1) * limit];

  const { rows } = await pool.query(
    `SELECT r.id, r.opportunity_id, r.reporter_user_id, r.reason, r.details, r.status,
            r.resolution_note, r.resolved_by_user_id, r.created_at, r.updated_at,
            o.title AS opportunity_title, o.status AS opportunity_status,
            org.name AS organization_name,
            reporter.first_name || ' ' || reporter.last_name AS reporter_name,
            reporter.email AS reporter_email,
            resolver.email AS resolved_by_email
     FROM opportunity_report r
     JOIN opportunity o ON o.id = r.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     JOIN "user" reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN "user" resolver ON resolver.id = r.resolved_by_user_id
     ${whereSql}
     ORDER BY
       CASE r.status
         WHEN 'open' THEN 0
         WHEN 'in_review' THEN 1
         WHEN 'resolved' THEN 2
         WHEN 'dismissed' THEN 3
         ELSE 4
       END,
       r.created_at DESC,
       r.id DESC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues
  );

  const reports = rows.map((row) => serializeReport(row));

  res.json({
    reports,
    items: reports,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.get("/admin/moderation/reports/:id", requireAdmin, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const report = await loadReport(pool, reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found" });
  }

  const auditTrail = await loadAuditTrail(pool, reportId);
  res.json({ report: serializeReport(report, auditTrail) });
}));

router.post("/admin/moderation/reports/:id/review", requireAdmin, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, opportunity_id, status
       FROM opportunity_report
       WHERE id = $1
       FOR UPDATE`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (report.status !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    const { rowCount } = await client.query(
      `UPDATE opportunity_report
       SET status = 'in_review',
           updated_at = NOW()
       WHERE id = $1 AND status = 'open'`,
      [reportId]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_review_started",
      resourceType: "opportunity_report",
      resourceId: reportId,
      metadata: { previous_status: "open", next_status: "in_review" },
      client,
    });

    await client.query("COMMIT");
    res.json({ message: "Report moved to in review" });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Report review transition failed");
    throw error;
  } finally {
    client.release();
  }
}));

async function transitionReport(req, res, nextStatus) {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
  if (!note) {
    return res.status(400).json({ error: "Moderation note is required" });
  }

  const archiveOpportunity = parseBoolean(req.body.archive_opportunity);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, opportunity_id, status
       FROM opportunity_report
       WHERE id = $1
       FOR UPDATE`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (!["open", "in_review"].includes(report.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    const { rowCount } = await client.query(
      `UPDATE opportunity_report
       SET status = $2,
           updated_at = NOW(),
           resolution_note = $3,
           resolved_by_user_id = $4
       WHERE id = $1
         AND status IN ('open', 'in_review')`,
      [reportId, nextStatus, note, req.session.user.id]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: nextStatus === "resolved" ? "report_resolved" : "report_dismissed",
      resourceType: "opportunity_report",
      resourceId: reportId,
      metadata: {
        previous_status: report.status,
        next_status: nextStatus,
        archive_opportunity: archiveOpportunity,
      },
      client,
    });

    if (archiveOpportunity) {
      await client.query(
        "UPDATE opportunity SET status = 'archived' WHERE id = $1 AND status <> 'archived'",
        [report.opportunity_id]
      );
      await recordModerationAudit({
        actorUserId: req.session.user.id,
        action: "opportunity_archived",
        resourceType: "opportunity",
        resourceId: report.opportunity_id,
        metadata: { archived_from_report: true },
        client,
      });
    }

    const updated = await loadReport(client, reportId);
    const auditTrail = await loadAuditTrail(client, reportId);
    await client.query("COMMIT");

    res.json({ report: serializeReport(updated, auditTrail) });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Moderation transition failed");
    throw error;
  } finally {
    client.release();
  }
}

router.post("/admin/moderation/reports/:id/resolve", requireAdmin, catchAsync(async (req, res) => {
  return transitionReport(req, res, "resolved");
}));

router.post("/admin/moderation/reports/:id/dismiss", requireAdmin, catchAsync(async (req, res) => {
  return transitionReport(req, res, "dismissed");
}));

module.exports = router;
