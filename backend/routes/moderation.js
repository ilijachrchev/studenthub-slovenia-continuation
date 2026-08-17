const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireAuth, requireModerator, requireModerationAdmin } = require("../middleware/auth");
const { recordModerationAudit, loadAuditTrailForReport } = require("../lib/moderation/audit");
const rules = require("../lib/moderation/reportRules");

const router = express.Router();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, parsed));
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function serializeReportSummary(row) {
  return {
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    opportunity_title: row.opportunity_title,
    opportunity_status: row.opportunity_status,
    organization_name: row.organization_name,
    category: row.category,
    severity: row.severity,
    status: row.status,
    assigned_moderator_user_id: row.assigned_moderator_user_id,
    assigned_moderator_email: row.assigned_moderator_email,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function serializeReportDetail(row, auditTrail = []) {
  return {
    ...serializeReportSummary(row),
    reporter_user_id: row.reporter_user_id,
    reporter_name: row.reporter_name,
    reporter_email: row.reporter_email,
    reason: row.reason,
    assigned_at: toIso(row.assigned_at),
    resolved_by_user_id: row.resolved_by_user_id,
    resolved_by_email: row.resolved_by_email,
    resolved_at: toIso(row.resolved_at),
    resolution_action: row.resolution_action,
    resolution_note: row.resolution_note,
    audit_trail: auditTrail.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor_user_id: entry.actor_user_id,
      created_at: toIso(entry.created_at),
      metadata: entry.metadata,
    })),
  };
}

// Fields shown to the reporter about their own submission — deliberately
// excludes moderator identity, internal notes and other reporters' data.
function serializeReportForReporter(row) {
  return {
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    opportunity_title: row.opportunity_title,
    category: row.category,
    status: row.status,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    resolution_action: ["resolved", "dismissed"].includes(row.status) ? row.resolution_action : null,
  };
}

const REPORT_DETAIL_QUERY = `
  SELECT r.id, r.target_type, r.target_id, r.reporter_user_id, r.category, r.severity,
         r.reason, r.status, r.assigned_moderator_user_id, r.assigned_at,
         r.resolved_by_user_id, r.resolved_at, r.resolution_action, r.resolution_note,
         r.created_at, r.updated_at,
         o.title AS opportunity_title, o.status AS opportunity_status,
         org.name AS organization_name,
         reporter.first_name || ' ' || reporter.last_name AS reporter_name,
         reporter.email AS reporter_email,
         assignee.email AS assigned_moderator_email,
         resolver.email AS resolved_by_email
  FROM moderation_report r
  JOIN opportunity o ON o.id = r.target_id AND r.target_type = 'opportunity'
  JOIN organization org ON org.id = o.organization_id
  JOIN "user" reporter ON reporter.id = r.reporter_user_id
  LEFT JOIN "user" assignee ON assignee.id = r.assigned_moderator_user_id
  LEFT JOIN "user" resolver ON resolver.id = r.resolved_by_user_id
`;

async function loadReportRow(client, reportId) {
  const { rows } = await client.query(`${REPORT_DETAIL_QUERY} WHERE r.id = $1`, [reportId]);
  return rows[0] || null;
}

async function getOpportunityOwnerUserId(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT op.user_id
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE o.id = $1
     ORDER BY op.user_id ASC
     LIMIT 1`,
    [opportunityId]
  );
  return rows[0] ? rows[0].user_id : null;
}

const DEFAULT_REPORTS_PER_HOUR_LIMIT = 10;

// Read at call time (not module load) so it can be tuned via env without a
// restart, and so tests can exercise the limit deterministically.
function getReportsPerHourLimit() {
  const parsed = Number.parseInt(process.env.MODERATION_REPORTS_PER_HOUR_LIMIT, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REPORTS_PER_HOUR_LIMIT;
}

async function reporterExceedsRateLimit(client, reporterUserId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS recent_count
     FROM moderation_report
     WHERE reporter_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [reporterUserId]
  );
  return (rows[0]?.recent_count || 0) >= getReportsPerHourLimit();
}

// Coarse per-IP throttle in front of the DB-backed per-user limit above —
// defends against report spam from many freshly-registered accounts.
const reportCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // The IP-based layer is a coarse defense against many freshly-registered
  // accounts spamming from one network. It's disabled in tests, which run
  // many distinct users through a single loopback IP; the precise, DB-backed
  // per-user limit below still applies unconditionally.
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many reports submitted from this network. Try again later." },
});

// ---------------------------------------------------------------------------
// report intake (any authenticated user)
// ---------------------------------------------------------------------------

router.post("/reports", requireAuth, reportCreationLimiter, catchAsync(async (req, res) => {
  const targetType = typeof req.body.target_type === "string" ? req.body.target_type.trim() : "";
  const targetId = parseId(req.body.target_id);
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "other";
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

  if (!rules.isValidTargetType(targetType)) {
    return res.status(400).json({ error: "Unsupported report target type" });
  }
  if (!targetId) {
    return res.status(400).json({ error: "A valid target_id is required" });
  }
  if (!rules.isValidCategory(category)) {
    return res.status(400).json({ error: "Unsupported report category" });
  }
  if (!reason || reason.length < 10) {
    return res.status(400).json({ error: "Please describe the issue in at least 10 characters" });
  }
  if (reason.length > 2000) {
    return res.status(400).json({ error: "Reason is too long (max 2000 characters)" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: opportunityRows } = await client.query(
      "SELECT id FROM opportunity WHERE id = $1 FOR SHARE",
      [targetId]
    );
    if (opportunityRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report target not found" });
    }

    const ownerUserId = await getOpportunityOwnerUserId(client, targetId);
    if (ownerUserId === req.session.user.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You cannot report your own listing" });
    }

    if (await reporterExceedsRateLimit(client, req.session.user.id)) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "Too many reports submitted recently. Try again later." });
    }

    const { rows: [report] } = await client.query(
      `INSERT INTO moderation_report (target_type, target_id, reporter_user_id, category, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, target_type, target_id, status, created_at`,
      [targetType, targetId, req.session.user.id, category, reason]
    );

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_created",
      targetType,
      targetId,
      reportId: report.id,
      metadata: { category },
      client,
    });

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Report submitted",
      reportId: report.id,
      status: report.status,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error && error.code === "23505") {
      return res.status(409).json({ error: "You already have an open report for this item" });
    }
    if (error && error.code === "23503") {
      return res.status(404).json({ error: "Report target not found" });
    }

    throw error;
  } finally {
    client.release();
  }
}));

router.get("/reports/mine", requireAuth, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.target_type, r.target_id, r.category, r.status, r.resolution_action,
            r.created_at, r.updated_at,
            o.title AS opportunity_title
     FROM moderation_report r
     LEFT JOIN opportunity o ON o.id = r.target_id AND r.target_type = 'opportunity'
     WHERE r.reporter_user_id = $1
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [req.session.user.id]
  );

  res.json({ reports: rows.map(serializeReportForReporter) });
}));

// ---------------------------------------------------------------------------
// moderation queue & report detail (moderator/admin only)
// ---------------------------------------------------------------------------

router.get("/queue", requireModerator, catchAsync(async (req, res) => {
  const page = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit);

  const filters = [];
  const values = [];

  const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
  if (status && status !== "all") {
    if (!rules.STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }
    values.push(status);
    filters.push(`r.status = $${values.length}`);
  } else if (!status) {
    // Default view: the actionable queue, not the full historical log.
    filters.push(`r.status IN ('open', 'under_review', 'escalated')`);
  }

  const severity = typeof req.query.severity === "string" ? req.query.severity.trim().toLowerCase() : "";
  if (severity) {
    if (!rules.SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: "Invalid severity filter" });
    }
    values.push(severity);
    filters.push(`r.severity = $${values.length}`);
  }

  const targetType = typeof req.query.target_type === "string" ? req.query.target_type.trim().toLowerCase() : "";
  if (targetType) {
    if (!rules.isValidTargetType(targetType)) {
      return res.status(400).json({ error: "Invalid target_type filter" });
    }
    values.push(targetType);
    filters.push(`r.target_type = $${values.length}`);
  }

  const assignedTo = req.query.assigned_to;
  if (assignedTo === "me") {
    values.push(req.session.user.id);
    filters.push(`r.assigned_moderator_user_id = $${values.length}`);
  } else if (assignedTo === "unassigned") {
    filters.push(`r.assigned_moderator_user_id IS NULL`);
  } else if (typeof assignedTo === "string" && assignedTo) {
    const assignedUserId = parseId(assignedTo);
    if (!assignedUserId) {
      return res.status(400).json({ error: "Invalid assigned_to filter" });
    }
    values.push(assignedUserId);
    filters.push(`r.assigned_moderator_user_id = $${values.length}`);
  }

  const dateFrom = req.query.date_from;
  if (typeof dateFrom === "string" && dateFrom) {
    const parsed = new Date(dateFrom);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "Invalid date_from" });
    }
    values.push(parsed.toISOString());
    filters.push(`r.created_at >= $${values.length}`);
  }

  const dateTo = req.query.date_to;
  if (typeof dateTo === "string" && dateTo) {
    const parsed = new Date(dateTo);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "Invalid date_to" });
    }
    values.push(parsed.toISOString());
    filters.push(`r.created_at <= $${values.length}`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM moderation_report r ${whereSql}`,
    values
  );
  const total = countRows[0]?.total || 0;

  const listValues = values.slice();
  listValues.push(limit);
  listValues.push((page - 1) * limit);

  const { rows } = await pool.query(
    `SELECT r.id, r.target_type, r.target_id, r.category, r.severity, r.status,
            r.assigned_moderator_user_id, r.created_at, r.updated_at,
            o.title AS opportunity_title, o.status AS opportunity_status,
            org.name AS organization_name,
            assignee.email AS assigned_moderator_email
     FROM moderation_report r
     JOIN opportunity o ON o.id = r.target_id AND r.target_type = 'opportunity'
     JOIN organization org ON org.id = o.organization_id
     LEFT JOIN "user" assignee ON assignee.id = r.assigned_moderator_user_id
     ${whereSql}
     ORDER BY
       CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       CASE r.status WHEN 'escalated' THEN 0 WHEN 'open' THEN 1 WHEN 'under_review' THEN 2 ELSE 3 END,
       r.created_at ASC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues
  );

  res.json({
    reports: rows.map(serializeReportSummary),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.get("/reports/:id", requireModerator, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const report = await loadReportRow(pool, reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found" });
  }

  const auditTrail = await loadAuditTrailForReport(pool, reportId);
  res.json({ report: serializeReportDetail(report, auditTrail) });
}));

router.get("/reports/:id/history", requireModerator, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const report = await loadReportRow(pool, reportId);
  if (!report) {
    return res.status(404).json({ error: "Report not found" });
  }

  const auditTrail = await loadAuditTrailForReport(pool, reportId);
  res.json({
    reportId,
    history: auditTrail.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor_user_id: entry.actor_user_id,
      created_at: toIso(entry.created_at),
      metadata: entry.metadata,
    })),
  });
}));

// ---------------------------------------------------------------------------
// assignment (claim / release / reassign)
// ---------------------------------------------------------------------------

router.post("/reports/:id/claim", requireModerator, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, assigned_moderator_user_id, target_type, target_id
       FROM moderation_report WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (!rules.canClaim(report)) {
      await client.query("ROLLBACK");
      // Distinguish "someone beat you to it" from other invalid states so
      // the UI can tell a moderator their claim lost a race, cleanly.
      const reason = report.assigned_moderator_user_id
        ? "Report is already assigned to another moderator"
        : "Report is not available to claim";
      return res.status(409).json({ error: reason });
    }

    // Conditional UPDATE re-checks the same predicate under the row lock —
    // belt-and-braces against a second request racing in between.
    const { rowCount } = await client.query(
      `UPDATE moderation_report
       SET status = 'under_review', assigned_moderator_user_id = $2, assigned_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'open' AND assigned_moderator_user_id IS NULL`,
      [reportId, req.session.user.id]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report is already assigned to another moderator" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_claimed",
      targetType: report.target_type,
      targetId: report.target_id,
      reportId,
      client,
    });

    const updated = await loadReportRow(client, reportId);
    await client.query("COMMIT");
    res.json({ report: serializeReportDetail(updated, []) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/reports/:id/release", requireModerator, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, assigned_moderator_user_id, target_type, target_id
       FROM moderation_report WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (!rules.canRelease(report, { kind: req.moderationActor.kind, userId: req.session.user.id })) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report cannot be released from its current state" });
    }

    const { rowCount } = await client.query(
      `UPDATE moderation_report
       SET status = 'open', assigned_moderator_user_id = NULL, assigned_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'under_review'`,
      [reportId]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report cannot be released from its current state" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_released",
      targetType: report.target_type,
      targetId: report.target_id,
      reportId,
      metadata: { previously_assigned_to: report.assigned_moderator_user_id },
      client,
    });

    await client.query("COMMIT");
    res.json({ message: "Report returned to the open queue" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/reports/:id/reassign", requireModerationAdmin, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  const targetModeratorUserId = parseId(req.body.moderator_user_id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }
  if (!targetModeratorUserId) {
    return res.status(400).json({ error: "moderator_user_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: targetRows } = await client.query(
      `SELECT 1 FROM admin WHERE user_id = $1
       UNION ALL
       SELECT 1 FROM moderator WHERE user_id = $1`,
      [targetModeratorUserId]
    );
    if (targetRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Target user is not a moderator or admin" });
    }

    const { rows } = await client.query(
      `SELECT id, status, target_type, target_id, assigned_moderator_user_id
       FROM moderation_report WHERE id = $1 FOR UPDATE`,
      [reportId]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (!["open", "under_review", "escalated"].includes(report.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report is already closed" });
    }

    await client.query(
      `UPDATE moderation_report
       SET assigned_moderator_user_id = $2, assigned_at = NOW(), status = 'under_review', updated_at = NOW()
       WHERE id = $1`,
      [reportId, targetModeratorUserId]
    );

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_reassigned",
      targetType: report.target_type,
      targetId: report.target_id,
      reportId,
      metadata: {
        previous_assignee: report.assigned_moderator_user_id,
        new_assignee: targetModeratorUserId,
      },
      client,
    });

    const updated = await loadReportRow(client, reportId);
    await client.query("COMMIT");
    res.json({ report: serializeReportDetail(updated, []) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------------------
// resolution (resolve / dismiss / escalate)
// ---------------------------------------------------------------------------

async function applyResolutionAction(client, { targetType, targetId, action, actorUserId }) {
  if (targetType !== "opportunity") return;

  if (action === "hide_content") {
    const { rowCount } = await client.query(
      "UPDATE opportunity SET status = 'hidden' WHERE id = $1 AND status <> 'hidden'",
      [targetId]
    );
    if (rowCount > 0) {
      await recordModerationAudit({
        actorUserId,
        action: "opportunity_hidden",
        targetType: "opportunity",
        targetId,
        client,
      });
    }
  } else if (action === "restore_content") {
    const { rowCount } = await client.query(
      "UPDATE opportunity SET status = 'published' WHERE id = $1 AND status = 'hidden'",
      [targetId]
    );
    if (rowCount > 0) {
      await recordModerationAudit({
        actorUserId,
        action: "opportunity_restored",
        targetType: "opportunity",
        targetId,
        client,
      });
    }
  }
}

async function closeReport(req, res, { nextStatus }) {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
  if (!note || note.length < 5) {
    return res.status(400).json({ error: "A resolution note of at least 5 characters is required" });
  }
  if (note.length > 2000) {
    return res.status(400).json({ error: "Note is too long (max 2000 characters)" });
  }

  let action = null;
  if (nextStatus === "resolved") {
    action = typeof req.body.action === "string" ? req.body.action.trim() : "";
    if (!rules.isValidResolutionAction(action)) {
      return res.status(400).json({ error: "A valid resolution action is required" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, target_type, target_id, assigned_moderator_user_id
       FROM moderation_report WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    const actor = { kind: req.moderationActor.kind, userId: req.session.user.id };

    if (!rules.canClose(report, actor)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report cannot be closed from its current state by this account" });
    }

    const { rowCount } = await client.query(
      `UPDATE moderation_report
       SET status = $2, resolved_by_user_id = $3, resolved_at = NOW(),
           resolution_action = $4, resolution_note = $5, updated_at = NOW()
       WHERE id = $1 AND status = $6`,
      [reportId, nextStatus, req.session.user.id, action, note, report.status]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed, please refresh" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: nextStatus === "resolved" ? "report_resolved" : "report_dismissed",
      targetType: report.target_type,
      targetId: report.target_id,
      reportId,
      metadata: { previous_status: report.status, resolution_action: action },
      client,
    });

    if (action) {
      await applyResolutionAction(client, {
        targetType: report.target_type,
        targetId: report.target_id,
        action,
        actorUserId: req.session.user.id,
      });
    }

    const updated = await loadReportRow(client, reportId);
    const auditTrail = await loadAuditTrailForReport(client, reportId);
    await client.query("COMMIT");
    res.json({ report: serializeReportDetail(updated, auditTrail) });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Moderation report close failed");
    throw error;
  } finally {
    client.release();
  }
}

router.post("/reports/:id/resolve", requireModerator, catchAsync((req, res) => closeReport(req, res, { nextStatus: "resolved" })));
router.post("/reports/:id/dismiss", requireModerator, catchAsync((req, res) => closeReport(req, res, { nextStatus: "dismissed" })));

router.post("/reports/:id/escalate", requireModerator, catchAsync(async (req, res) => {
  const reportId = parseId(req.params.id);
  if (!reportId) {
    return res.status(404).json({ error: "Report not found" });
  }

  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
  if (!note || note.length < 5) {
    return res.status(400).json({ error: "A note explaining the escalation is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, target_type, target_id FROM moderation_report WHERE id = $1 FOR UPDATE`,
      [reportId]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (!rules.canEscalate(report)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report cannot be escalated from its current state" });
    }

    const { rowCount } = await client.query(
      `UPDATE moderation_report
       SET status = 'escalated', severity = 'critical', updated_at = NOW()
       WHERE id = $1 AND status = $2`,
      [reportId, report.status]
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Report status has changed, please refresh" });
    }

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_escalated",
      targetType: report.target_type,
      targetId: report.target_id,
      reportId,
      metadata: { previous_status: report.status, note },
      client,
    });

    const updated = await loadReportRow(client, reportId);
    await client.query("COMMIT");
    res.json({ report: serializeReportDetail(updated, []) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------------------
// direct content actions (admin only, outside the report workflow)
// ---------------------------------------------------------------------------

router.post("/opportunities/:id/hide", requireModerationAdmin, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (!reason || reason.length < 5) {
    return res.status(400).json({ error: "A reason of at least 5 characters is required" });
  }

  const { rowCount } = await pool.query(
    "UPDATE opportunity SET status = 'hidden' WHERE id = $1 AND status <> 'hidden'",
    [opportunityId]
  );
  if (rowCount === 0) {
    return res.status(404).json({ error: "Opportunity not found or already hidden" });
  }

  await recordModerationAudit({
    actorUserId: req.session.user.id,
    action: "opportunity_hidden",
    targetType: "opportunity",
    targetId: opportunityId,
    metadata: { reason, direct_action: true },
  });

  res.json({ message: "Opportunity hidden" });
}));

router.post("/opportunities/:id/restore", requireModerationAdmin, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rowCount } = await pool.query(
    "UPDATE opportunity SET status = 'published' WHERE id = $1 AND status = 'hidden'",
    [opportunityId]
  );
  if (rowCount === 0) {
    return res.status(404).json({ error: "Opportunity not found or not currently hidden" });
  }

  await recordModerationAudit({
    actorUserId: req.session.user.id,
    action: "opportunity_restored",
    targetType: "opportunity",
    targetId: opportunityId,
    metadata: { direct_action: true },
  });

  res.json({ message: "Opportunity restored" });
}));

module.exports = router;
