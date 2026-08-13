const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireAdminRecord } = require("../middleware/auth");
const { recordModerationAudit } = require("../lib/moderation/audit");

const router = express.Router();

const requireAdmin = requireAdminRecord;

const MODERATION_STATUSES = new Set(["open", "in_review", "resolved", "dismissed", "all"]);

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePage(value) {
  return Math.max(1, Number.parseInt(value, 10) || 1);
}

function parseLimit(value) {
  return Math.min(50, Math.max(1, Number.parseInt(value, 10) || 20));
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parseBoolean(value) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return false;
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
    category: row.category,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_by_email: row.reviewed_by_email,
    archive_opportunity: row.archive_opportunity,
    resolution_note: row.resolution_note,
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

async function loadReportRow(client, reportId) {
  const { rows } = await client.query(
    `SELECT r.id, r.opportunity_id, r.reporter_user_id, r.category, r.reason, r.status,
            r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by_user_id,
            r.archive_opportunity, r.resolution_note,
            o.title AS opportunity_title, o.status AS opportunity_status,
            org.name AS organization_name,
            reporter.first_name || ' ' || reporter.last_name AS reporter_name,
            reporter.email AS reporter_email,
            reviewer.email AS reviewed_by_email
     FROM opportunity_report r
     JOIN opportunity o ON o.id = r.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     JOIN "user" reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN "user" reviewer ON reviewer.id = r.reviewed_by_user_id
     WHERE r.id = $1`,
    [reportId]
  );

  return rows[0] || null;
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

async function loadAdminContext(userId) {
  const { rows } = await pool.query(
    "SELECT id FROM admin WHERE user_id = $1",
    [userId]
  );

  return rows[0] || null;
}

async function updateOpportunityArchive(client, opportunityId, archiveOpportunity, actorUserId) {
  if (!archiveOpportunity) {
    return null;
  }

  const { rowCount } = await client.query(
    "UPDATE opportunity SET status = 'archived' WHERE id = $1 AND status <> 'archived'",
    [opportunityId]
  );

  if (rowCount > 0) {
    await recordModerationAudit({
      actorUserId,
      action: "opportunity_archived",
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: {
        archived_from_report: true,
      },
      client,
    });
  }

  return rowCount;
}

router.get("/reports", requireAdmin, catchAsync(async (req, res) => {
  const status = normalizeStatus(req.query.status || "open");
  const page = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit);

  if (!MODERATION_STATUSES.has(status)) {
    return res.status(400).json({ error: "Invalid report status filter" });
  }

  const filters = [];
  const values = [];

  if (status !== "all") {
    values.push(status);
    filters.push(`r.status = $${values.length}`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM opportunity_report r
     ${whereSql}`,
    values
  );

  const total = countRows[0]?.total || 0;

  const listValues = values.slice();
  listValues.push(limit);
  listValues.push((page - 1) * limit);

  const { rows } = await pool.query(
    `SELECT r.id, r.opportunity_id, r.reporter_user_id, r.category, r.reason, r.status,
            r.created_at, r.updated_at, r.reviewed_at, r.reviewed_by_user_id,
            r.archive_opportunity, r.resolution_note,
            o.title AS opportunity_title, o.status AS opportunity_status,
            org.name AS organization_name,
            reporter.first_name || ' ' || reporter.last_name AS reporter_name,
            reporter.email AS reporter_email,
            reviewer.email AS reviewed_by_email
     FROM opportunity_report r
     JOIN opportunity o ON o.id = r.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     JOIN "user" reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN "user" reviewer ON reviewer.id = r.reviewed_by_user_id
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

  res.json({
    reports: rows.map((row) => serializeReport(row)),
    items: rows.map((row) => serializeReport(row)),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.get("/reports/:id", requireAdmin, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const report = await loadReportRow(pool, reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found" });
  }

  const auditTrail = await loadAuditTrail(pool, reportId);
  res.json({ report: serializeReport(report, auditTrail) });
}));

router.post("/reports/:id/review", requireAdmin, catchAsync(async (req, res) => {
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
           updated_at = NOW(),
           reviewed_at = NOW(),
           reviewed_by_user_id = $2
       WHERE id = $1 AND status = 'open'`,
      [reportId, req.session.user.id]
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
      metadata: {
        previous_status: "open",
        next_status: "in_review",
      },
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
    if (["resolved", "dismissed"].includes(report.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    if (!["open", "in_review"].includes(report.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed" });
    }

    const { rowCount } = await client.query(
      `UPDATE opportunity_report
       SET status = $2,
           updated_at = NOW(),
           reviewed_at = NOW(),
           reviewed_by_user_id = $3,
           resolution_note = $4,
           archive_opportunity = $5
       WHERE id = $1
         AND status IN ('open', 'in_review')`,
      [reportId, nextStatus, req.session.user.id, note, archiveOpportunity]
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

    await updateOpportunityArchive(client, report.opportunity_id, archiveOpportunity, req.session.user.id);

    const updated = await loadReportRow(client, reportId);
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

router.post("/reports/:id/resolve", requireAdmin, catchAsync(async (req, res) => {
  return transitionReport(req, res, "resolved");
}));

router.post("/reports/:id/dismiss", requireAdmin, catchAsync(async (req, res) => {
  return transitionReport(req, res, "dismissed");
}));

module.exports = router;
