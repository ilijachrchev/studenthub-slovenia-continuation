const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireAuth, requireRole } = require("../middleware/auth");
const { emit } = require("../lib/opportunity/notifications");
const { recordModerationAudit } = require("../lib/moderation/audit");

const router = express.Router();

const requireStudent = requireRole("student");
const requireOrganizer = requireRole("organizer");

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reports, please try again later" },
});

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

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

function normalizeSearch(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildOpportunityShape(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    deadline: toIso(row.deadline),
    status: row.status,
    created_at: toIso(row.created_at),
    published_at: toIso(row.published_at),
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_description: row.organization_description,
    organization_website: row.organization_website,
    organization_contact_email: row.organization_contact_email,
    tags: [],
    score: 0,
    bookmarked: Boolean(row.bookmarked),
    applicationStatus: row.application_status || "not_applied",
    application: row.application_id
      ? {
          id: row.application_id,
          status: row.application_status,
          cover_note: row.cover_note,
          created_at: toIso(row.application_created_at),
          updated_at: toIso(row.application_updated_at),
        }
      : null,
  };
}

async function loadOpportunityWithOrg(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT o.id, o.organization_id, o.title, o.description, o.location, o.status,
            o.deadline, o.created_at, o.published_at,
            org.name AS organization_name,
            org.description AS organization_description,
            org.website AS organization_website,
            org.contact_email AS organization_contact_email
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved'`,
    [opportunityId]
  );

  return rows[0] || null;
}

async function getOpportunityOwnerUserId(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT op.user_id
     FROM opportunity o
     JOIN organizer_profile op ON op.organization_id = o.organization_id
     WHERE o.id = $1 AND op.role_in_org = 'owner'
     ORDER BY op.user_id ASC
     LIMIT 1`,
    [opportunityId]
  );

  return rows[0] ? rows[0].user_id : null;
}

async function fetchBookmarkIds(userId) {
  const { rows } = await pool.query(
    "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1 ORDER BY id ASC",
    [userId]
  );

  return rows.map((row) => row.opportunity_id);
}

async function fetchApplicationStatuses(userId, opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map((_, index) => `$${index + 2}`);
  const { rows } = await pool.query(
    `SELECT id, opportunity_id, status, cover_note, created_at, updated_at
     FROM application
     WHERE applicant_user_id = $1
       AND opportunity_id IN (${placeholders.join(", ")})`,
    [userId, ...opportunityIds]
  );

  return new Map(rows.map((row) => [String(row.opportunity_id), row]));
}

async function loadOpportunityList(req, res) {
  const page = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit);
  const search = normalizeSearch(req.query.search || req.query.q);

  const clauses = [
    "o.status = 'published'",
    "org.status = 'approved'",
  ];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(o.title ILIKE $${values.length} OR COALESCE(o.description, '') ILIKE $${values.length})`);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     ${whereSql}`,
    values
  );

  const total = countRows[0]?.total || 0;

  const listValues = values.slice();
  listValues.push(limit);
  listValues.push((page - 1) * limit);

  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status,
            o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description,
            org.website AS organization_website,
            org.contact_email AS organization_contact_email
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     ${whereSql}
     ORDER BY o.published_at DESC NULLS LAST, o.created_at DESC, o.id DESC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues
  );

  const opportunityIds = rows.map((row) => row.id);
  const bookmarkIds = req.session.user ? await fetchBookmarkIds(req.session.user.id) : [];
  const applications = req.session.user && req.session.user.role === "student"
    ? await fetchApplicationStatuses(req.session.user.id, opportunityIds)
    : new Map();

  const opportunities = rows.map((row) => {
    const bookmarkKey = String(row.id);
    const application = applications.get(bookmarkKey) || null;
    return buildOpportunityShape({
      ...row,
      bookmarked: bookmarkIds.some((id) => String(id) === bookmarkKey),
      application_id: application?.id,
      application_status: application?.status,
      cover_note: application?.cover_note,
      application_created_at: application?.created_at,
      application_updated_at: application?.updated_at,
    });
  });

  res.json({
    opportunities,
    items: opportunities,
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
}

router.get("/", catchAsync(loadOpportunityList));

router.get("/saved/ids", catchAsync(async (req, res) => {
  if (!req.session.user) {
    return res.json({ ids: [] });
  }

  const ids = await fetchBookmarkIds(req.session.user.id);
  res.json({ ids });
}));

router.get("/saved", requireAuth, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status,
            o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description,
            org.website AS organization_website,
            org.contact_email AS organization_contact_email,
            ob.id AS bookmark_id
     FROM opportunity_bookmark ob
     JOIN opportunity o ON o.id = ob.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE ob.user_id = $1
     ORDER BY ob.id DESC`,
    [req.session.user.id]
  );

  const opportunities = rows.map((row) => buildOpportunityShape({
    ...row,
    bookmarked: true,
  }));

  res.json({ opportunities, items: opportunities });
}));

router.get("/applications", requireStudent, catchAsync(async (req, res) => {
  const { rows: applications } = await pool.query(
    `SELECT a.id AS application_id, a.status, a.cover_note, a.created_at, a.updated_at,
            o.id AS opportunity_id, o.title AS opportunity_title, o.description AS opportunity_description,
            o.location AS opportunity_location, o.status AS opportunity_status, o.deadline AS opportunity_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user.id]
  );

  const applicationIds = applications.map((row) => row.application_id);
  let historyByApplication = new Map();

  if (applicationIds.length > 0) {
    const placeholders = applicationIds.map((_, index) => `$${index + 1}`);
    const { rows: historyRows } = await pool.query(
      `SELECT id, application_id, action, from_status, to_status, actor_user_id, created_at
       FROM application_history
       WHERE application_id IN (${placeholders.join(", ")})
       ORDER BY created_at ASC, id ASC`,
      applicationIds
    );

    historyByApplication = historyRows.reduce((map, row) => {
      const existing = map.get(String(row.application_id)) || [];
      existing.push({
        id: row.id,
        action: row.action,
        from_status: row.from_status,
        to_status: row.to_status,
        actor_user_id: row.actor_user_id,
        created_at: toIso(row.created_at),
      });
      map.set(String(row.application_id), existing);
      return map;
    }, new Map());
  }

  const items = applications.map((row) => ({
    id: row.application_id,
    status: row.status,
    cover_note: row.cover_note,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    history: historyByApplication.get(String(row.application_id)) || [],
    opportunity: {
      id: row.opportunity_id,
      title: row.opportunity_title,
      description: row.opportunity_description,
      location: row.opportunity_location,
      status: row.opportunity_status,
      deadline: toIso(row.opportunity_deadline),
      organization_id: row.organization_id,
      organization_name: row.organization_name,
    },
  }));

  res.json({ applications: items, items });
}));

router.get("/:id", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await loadOpportunityWithOrg(pool, opportunityId);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  let application = null;
  let bookmarked = false;
  if (req.session.user) {
    const { rows } = await pool.query(
      `SELECT id, status, cover_note, created_at, updated_at
       FROM application
       WHERE opportunity_id = $1 AND applicant_user_id = $2`,
      [opportunityId, req.session.user.id]
    );
    application = rows[0] || null;

    const { rows: bookmarkRows } = await pool.query(
      "SELECT id FROM bookmark WHERE event_id = $1 AND user_id = $2",
      [opportunityId, req.session.user.id]
    );
    bookmarked = bookmarkRows.length > 0;
  }

  res.json(buildOpportunityShape({
    ...opportunity,
    bookmarked,
    application_id: application?.id,
    application_status: application?.status,
    cover_note: application?.cover_note,
    application_created_at: application?.created_at,
    application_updated_at: application?.updated_at,
  }));
}));

router.get("/:id/related", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.json({ opportunities: [], items: [] });
  }

  const opportunity = await loadOpportunityWithOrg(pool, opportunityId);
  if (!opportunity) {
    return res.json({ opportunities: [], items: [] });
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status,
            o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description,
            org.website AS organization_website,
            org.contact_email AS organization_contact_email
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.organization_id = $1
       AND o.id <> $2
       AND o.status = 'published'
       AND org.status = 'approved'
     ORDER BY o.published_at DESC NULLS LAST, o.created_at DESC, o.id DESC
     LIMIT 3`,
    [opportunity.organization_id, opportunityId]
  );

  const opportunities = rows.map((row) => buildOpportunityShape(row));
  res.json({ opportunities, items: opportunities });
}));

router.post("/:id/bookmark", requireAuth, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await loadOpportunityWithOrg(pool, opportunityId);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  try {
    await pool.query(
      "INSERT INTO opportunity_bookmark (user_id, opportunity_id) VALUES ($1, $2)",
      [req.session.user.id, opportunityId]
    );
    res.status(201).json({ message: "Opportunity saved" });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Opportunity already saved" });
    }
    throw error;
  }
}));

router.delete("/:id/bookmark", requireAuth, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "No saved event to remove" });
  }

  const { rowCount } = await pool.query(
    "DELETE FROM opportunity_bookmark WHERE user_id = $1 AND opportunity_id = $2",
    [req.session.user.id, opportunityId]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "No saved opportunity to remove" });
  }

  res.json({ message: "Opportunity removed from saved" });
}));

router.get("/:id/applications", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const ownerUserId = await getOpportunityOwnerUserId(pool, opportunityId);
  if (ownerUserId !== req.session.user.id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at,
            a.applicant_user_id,
            u.first_name, u.last_name, u.email
     FROM application a
     JOIN "user" u ON u.id = a.applicant_user_id
     WHERE a.opportunity_id = $1
     ORDER BY a.created_at ASC, a.id ASC`,
    [opportunityId]
  );

  res.json({
    applications: rows.map((row) => ({
      id: row.id,
      status: row.status,
      cover_note: row.cover_note,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      applicant: {
        id: row.applicant_user_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
      },
    })),
  });
}));

router.post("/:id/apply", requireStudent, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const coverNote = typeof req.body.cover_note === "string" && req.body.cover_note.trim()
    ? req.body.cover_note.trim()
    : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const opportunity = await loadOpportunityWithOrg(client, opportunityId);
    if (!opportunity || new Date(opportunity.deadline) <= new Date()) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const ownerUserId = await getOpportunityOwnerUserId(client, opportunityId);
    if (ownerUserId === req.session.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You cannot apply to your own opportunity" });
    }

    const { rows: existing } = await client.query(
      `SELECT id, status
       FROM application
       WHERE opportunity_id = $1 AND applicant_user_id = $2
       FOR UPDATE`,
      [opportunityId, req.session.user.id]
    );

    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "You have already applied for this opportunity" });
    }

    const { rows: [application] } = await client.query(
      `INSERT INTO application (opportunity_id, applicant_user_id, cover_note, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, status, created_at, updated_at`,
      [opportunityId, req.session.user.id, coverNote]
    );

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [application.id, "application_created", null, "pending", req.session.user.id]
    );

    if (ownerUserId) {
      await emit(ownerUserId, "application.received", {
        applicationId: application.id,
        opportunityId,
        applicantUserId: req.session.user.id,
        opportunityTitle: opportunity.title,
      }, client);
    }

    await client.query("COMMIT");
    return res.status(201).json({
      message: "Application submitted",
      applicationId: application.id,
      status: application.status,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error && error.code === "23505") {
      return res.status(409).json({ error: "You have already applied for this opportunity" });
    }

    logger.error({ err: error }, "Opportunity application failed");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/:id/apply", requireStudent, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Application not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status
       FROM application
       WHERE opportunity_id = $1 AND applicant_user_id = $2
       FOR UPDATE`,
      [opportunityId, req.session.user.id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const application = rows[0];
    if (application.status === "withdrawn") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    const { rowCount } = await client.query(
      `UPDATE application
       SET status = 'withdrawn', updated_at = NOW()
       WHERE id = $1 AND status <> 'withdrawn'`,
      [application.id]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [application.id, "application_withdrawn", application.status, "withdrawn", req.session.user.id]
    );

    await client.query("COMMIT");
    res.json({ message: "Application withdrawn" });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Application withdrawal failed");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/:id/report", requireStudent, reportLimiter, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  const category = typeof req.body.category === "string" ? req.body.category.trim().toLowerCase() : "other";
  const allowedCategories = new Set(["other", "spam", "harassment", "inaccurate", "duplicate", "abuse"]);

  if (!reason) {
    return res.status(400).json({ error: "Reason is required" });
  }

  if (!allowedCategories.has(category)) {
    return res.status(400).json({ error: "Invalid report category" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const opportunity = await loadOpportunityWithOrg(client, opportunityId);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const ownerUserId = await getOpportunityOwnerUserId(client, opportunityId);
    if (ownerUserId === req.session.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You cannot report your own opportunity" });
    }

    const { rows: existingReports } = await client.query(
      `SELECT id
       FROM opportunity_report
       WHERE opportunity_id = $1
         AND reporter_user_id = $2
         AND status IN ('open', 'in_review')
       LIMIT 1`,
      [opportunityId, req.session.user.id]
    );

    if (existingReports.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "You have already reported this opportunity" });
    }

    const { rows: [report] } = await client.query(
      `INSERT INTO opportunity_report
        (opportunity_id, reporter_user_id, category, reason, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id, opportunity_id, reporter_user_id, category, reason, status, created_at, updated_at`,
      [opportunityId, req.session.user.id, category, reason]
    );

    await recordModerationAudit({
      actorUserId: req.session.user.id,
      action: "report_created",
      resourceType: "opportunity_report",
      resourceId: report.id,
      metadata: {
        opportunity_id: opportunityId,
        category,
        status: report.status,
      },
      client,
    });

    await client.query("COMMIT");
    res.status(201).json({ report });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({ error: "You have already reported this opportunity" });
    }

    logger.error({ err: error }, "Opportunity report failed");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

module.exports = router;
