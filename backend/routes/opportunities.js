const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const { emit } = require("../lib/opportunity/notifications");
const { recordEvent } = require("../lib/opportunity/analytics");
const {
  buildRecommendationContext,
  scoreOpportunity,
  tokenizeText,
} = require("../lib/opportunity/recommendations");

const router = express.Router();

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : fallback;
}

function placeholders(count) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function normalizeOpportunity(row, extras = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    status: row.status,
    deadline: toIso(row.deadline),
    created_at: toIso(row.created_at),
    published_at: toIso(row.published_at),
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_description: row.organization_description || null,
    organization_website: row.organization_website || null,
    bookmarked: Boolean(extras.bookmarked),
    has_applied: Boolean(extras.has_applied),
    application_status: extras.application_status || "",
    application: extras.application || null,
    primary_reason: extras.primary_reason || "",
    reason: extras.reason || "",
    tags: [],
  };
}

async function getOpportunityOwner(client, opportunityId) {
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

async function loadStudentState(client, userId, opportunityIds) {
  if (!userId || opportunityIds.length === 0) {
    return {
      bookmarks: new Set(),
      applications: new Map(),
      historyRows: [],
      bookmarkRows: [],
    };
  }

  const [bookmarkResult, applicationResult] = await Promise.all([
    client.query(
      "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1",
      [userId]
    ),
    client.query(
      `SELECT a.id, a.opportunity_id, a.status, a.cover_note, a.created_at, a.updated_at,
              o.title, o.description, o.location, o.status AS opportunity_status,
              o.deadline, o.created_at AS opportunity_created_at, o.published_at,
              o.organization_id, org.name AS organization_name,
              org.description AS organization_description, org.website AS organization_website
       FROM application a
       JOIN opportunity o ON o.id = a.opportunity_id
       JOIN organization org ON org.id = o.organization_id
       WHERE a.applicant_user_id = $1 AND a.opportunity_id = ANY($2::int[])
       ORDER BY a.created_at DESC, a.id DESC`,
      [userId, opportunityIds]
    ),
  ]);

  const applicationIds = applicationResult.rows.map((row) => row.id);
  const historyResult = applicationIds.length
    ? await client.query(
        `SELECT application_id, id, action, from_status, to_status, actor_user_id, created_at
         FROM application_history
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC`,
        [applicationIds]
      )
    : { rows: [] };

  const historyByApplication = new Map();
  for (const row of historyResult.rows) {
    if (!historyByApplication.has(row.application_id)) {
      historyByApplication.set(row.application_id, []);
    }
    historyByApplication.get(row.application_id).push({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      created_at: toIso(row.created_at),
    });
  }

  const applications = new Map();
  for (const row of applicationResult.rows) {
    applications.set(row.opportunity_id, {
      id: row.id,
      status: row.status,
      cover_note: row.cover_note,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      history: historyByApplication.get(row.id) || [],
      opportunity: normalizeOpportunity({
        id: row.opportunity_id,
        title: row.title,
        description: row.description,
        location: row.location,
        status: row.opportunity_status,
        deadline: row.deadline,
        created_at: row.opportunity_created_at,
        published_at: row.published_at,
        organization_id: row.organization_id,
        organization_name: row.organization_name,
        organization_description: row.organization_description,
        organization_website: row.organization_website,
      }),
    });
  }

  return {
    bookmarks: new Set(bookmarkResult.rows.map((row) => row.opportunity_id)),
    applications,
    historyRows: historyResult.rows,
    bookmarkRows: bookmarkResult.rows,
  };
}

async function loadRecommendationContext(client, userId) {
  if (!userId) {
    return buildRecommendationContext([], []);
  }

  const [historyResult, bookmarkResult] = await Promise.all([
    client.query(
      `SELECT a.opportunity_id, o.organization_id, o.title, o.description, o.location,
              org.name AS organization_name
       FROM application a
       JOIN opportunity o ON o.id = a.opportunity_id
       JOIN organization org ON org.id = o.organization_id
       WHERE a.applicant_user_id = $1
       ORDER BY a.created_at DESC, a.id DESC`,
      [userId]
    ),
    client.query(
      `SELECT b.opportunity_id, o.organization_id, o.title, o.description, o.location,
              org.name AS organization_name
       FROM opportunity_bookmark b
       JOIN opportunity o ON o.id = b.opportunity_id
       JOIN organization org ON org.id = o.organization_id
       WHERE b.user_id = $1
       ORDER BY b.saved_at DESC, b.id DESC`,
      [userId]
    ),
  ]);

  return buildRecommendationContext(historyResult.rows, bookmarkResult.rows);
}

async function listVisibleOpportunities(client, userId, query = {}) {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 20);
  const offset = (page - 1) * limit;
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const deadline = typeof query.deadline === "string" ? query.deadline.trim().toLowerCase() : "";

  const filters = ["o.status = 'published'", "org.status = 'approved'"];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      o.title ILIKE $${values.length}
      OR o.description ILIKE $${values.length}
      OR o.location ILIKE $${values.length}
      OR org.name ILIKE $${values.length}
    )`);
  }

  if (deadline === "upcoming") {
    filters.push("o.deadline >= NOW()");
  } else if (deadline === "past") {
    filters.push("o.deadline < NOW()");
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const [countResult, rowsResult] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::int AS total
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       ${whereSql}`,
      values
    ),
    client.query(
      `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
              org.id AS organization_id, org.name AS organization_name,
              org.description AS organization_description, org.website AS organization_website
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       ${whereSql}
       ORDER BY o.deadline ASC, o.published_at DESC NULLS LAST, o.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
  ]);

  const opportunityIds = rowsResult.rows.map((row) => row.id);
  const studentState = userId
    ? await loadStudentState(client, userId, opportunityIds)
    : { bookmarks: new Set(), applications: new Map(), historyRows: [], bookmarkRows: [] };
  const recommendationContext = userId
    ? await loadRecommendationContext(client, userId)
    : buildRecommendationContext([], []);

  const opportunities = rowsResult.rows.map((row) => {
    const scoreInfo = userId
      ? scoreOpportunity(row, recommendationContext)
      : { score: 0, reason: "Published opportunity", reasons: [] };

    const application = studentState.applications.get(row.id) || null;
    return normalizeOpportunity(row, {
      bookmarked: studentState.bookmarks.has(row.id),
      has_applied: Boolean(application),
      application_status: application?.status || "",
      application,
      primary_reason: scoreInfo.reason,
      reason: scoreInfo.reason,
    });
  });

  return {
    opportunities,
    items: opportunities,
    page,
    limit,
    total: countResult.rows[0]?.total || 0,
    hasMore: offset + opportunities.length < (countResult.rows[0]?.total || 0),
  };
}

router.get("/saved/ids", catchAsync(async (req, res) => {
  if (!req.session.user || req.session.user.role !== "student") {
    return res.json({ ids: [] });
  }

  const { rows } = await pool.query(
    "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1",
    [req.session.user.id]
  );

  res.json({ ids: rows.map((row) => row.opportunity_id) });
}));

router.get("/saved", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity_bookmark b
     JOIN opportunity o ON o.id = b.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
     ORDER BY b.saved_at DESC, b.id DESC`,
    [req.session.user.id]
  );

  const opportunities = rows.map((row) => normalizeOpportunity(row, { bookmarked: true }));
  res.json({ opportunities, items: opportunities });
}));

router.get("/applications", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.opportunity_id, a.status, a.cover_note, a.created_at, a.updated_at,
            o.title, o.description, o.location, o.status AS opportunity_status, o.deadline,
            o.created_at AS opportunity_created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user.id]
  );

  const applicationIds = rows.map((row) => row.id);
  const historyResult = applicationIds.length
    ? await pool.query(
        `SELECT application_id, id, action, from_status, to_status, actor_user_id, created_at
         FROM application_history
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC`,
        [applicationIds]
      )
    : { rows: [] };

  const historyByApplication = new Map();
  for (const row of historyResult.rows) {
    if (!historyByApplication.has(row.application_id)) {
      historyByApplication.set(row.application_id, []);
    }
    historyByApplication.get(row.application_id).push({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      created_at: toIso(row.created_at),
    });
  }

  const applications = rows.map((row) => ({
    id: row.id,
    opportunity_id: row.opportunity_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    organizationName: row.organization_name,
    status: row.status,
    cover_note: row.cover_note,
    appliedAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deadline: toIso(row.deadline),
    history: historyByApplication.get(row.id) || [],
    opportunity: normalizeOpportunity({
      id: row.opportunity_id,
      title: row.title,
      description: row.description,
      location: row.location,
      status: row.opportunity_status,
      deadline: row.deadline,
      created_at: row.opportunity_created_at,
      published_at: row.published_at,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      organization_description: row.organization_description,
      organization_website: row.organization_website,
    }),
  }));

  res.json({ applications, items: applications });
}));

router.get("/mine", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.opportunity_id, a.status, a.cover_note, a.created_at, a.updated_at,
            o.title, o.description, o.location, o.status AS opportunity_status, o.deadline,
            o.created_at AS opportunity_created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user.id]
  );

  const applications = rows.map((row) => ({
    id: row.id,
    opportunity_id: row.opportunity_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    organizationName: row.organization_name,
    status: row.status,
    cover_note: row.cover_note,
    appliedAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deadline: toIso(row.deadline),
    opportunity: normalizeOpportunity({
      id: row.opportunity_id,
      title: row.title,
      description: row.description,
      location: row.location,
      status: row.opportunity_status,
      deadline: row.deadline,
      created_at: row.opportunity_created_at,
      published_at: row.published_at,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      organization_description: row.organization_description,
      organization_website: row.organization_website,
    }),
  }));

  res.json({ applications, items: applications });
}));

router.get("/", catchAsync(async (req, res) => {
  const userId = req.session.user?.role === "student" ? req.session.user.id : null;
  const data = await listVisibleOpportunities(pool, userId, req.query);
  res.json(data);
}));

router.get("/:id/related", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.json({ opportunities: [], items: [] });
  }

  const { rows: sourceRows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.deadline, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved'`,
    [opportunityId]
  );

  if (sourceRows.length === 0) {
    return res.json({ opportunities: [], items: [] });
  }

  const source = sourceRows[0];
  const tokens = tokenizeText([source.title, source.description, source.location, source.organization_name].join(" "));

  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.status = 'published'
       AND org.status = 'approved'
       AND o.id <> $1
     ORDER BY o.deadline ASC, o.published_at DESC NULLS LAST, o.id ASC
     LIMIT 20`,
    [opportunityId]
  );

  const scored = rows
    .map((row) => {
      const rowTokens = tokenizeText([row.title, row.description, row.location, row.organization_name].join(" "));
      const score = rowTokens.filter((token) => tokens.includes(token)).length;
      return { row, score };
    })
    .sort((left, right) => right.score - left.score || new Date(left.row.deadline) - new Date(right.row.deadline) || left.row.id - right.row.id)
    .slice(0, 3)
    .map(({ row }) => normalizeOpportunity(row));

  res.json({ opportunities: scored, items: scored });
}));

router.post("/:id/bookmark", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
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
    await pool.query(
      "INSERT INTO opportunity_bookmark (user_id, opportunity_id) VALUES ($1, $2)",
      [req.session.user.id, opportunityId]
    );

    await recordEvent("opportunity_saved", {
      userId: req.session.user.id,
      opportunityId,
    });

    return res.status(201).json({ message: "Opportunity saved" });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Opportunity already saved" });
    }

    throw error;
  }
}));

router.delete("/:id/bookmark", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rowCount } = await pool.query(
    "DELETE FROM opportunity_bookmark WHERE user_id = $1 AND opportunity_id = $2",
    [req.session.user.id, opportunityId]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "No saved opportunity to remove" });
  }

  await recordEvent("opportunity_unsaved", {
    userId: req.session.user.id,
    opportunityId,
  });

  res.json({ message: "Opportunity removed from saved" });
}));

router.get("/:id", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved'`,
    [opportunityId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = rows[0];
  let bookmarked = false;
  let application = null;

  if (req.session.user && req.session.user.role === "student") {
    const [bookmarkResult, applicationResult] = await Promise.all([
      pool.query(
        "SELECT id FROM opportunity_bookmark WHERE user_id = $1 AND opportunity_id = $2",
        [req.session.user.id, opportunityId]
      ),
      pool.query(
        `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at
         FROM application a
         WHERE a.applicant_user_id = $1 AND a.opportunity_id = $2`,
        [req.session.user.id, opportunityId]
      ),
    ]);

    bookmarked = bookmarkResult.rows.length > 0;
    application = applicationResult.rows[0]
      ? {
          ...applicationResult.rows[0],
          created_at: toIso(applicationResult.rows[0].created_at),
          updated_at: toIso(applicationResult.rows[0].updated_at),
        }
      : null;
  }

  const { rows: historyRows } = await pool.query(
    `SELECT a.opportunity_id, o.organization_id, o.title, o.description, o.location, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user?.id || null]
  );

  const { rows: bookmarkRows } = await pool.query(
    `SELECT b.opportunity_id, o.organization_id, o.title, o.description, o.location, org.name AS organization_name
     FROM opportunity_bookmark b
     JOIN opportunity o ON o.id = b.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
     ORDER BY b.saved_at DESC, b.id DESC`,
    [req.session.user?.id || null]
  );

  const scoreInfo = req.session.user?.role === "student"
    ? scoreOpportunity(opportunity, buildRecommendationContext(historyRows, bookmarkRows))
    : { score: 0, reason: "Published opportunity", reasons: [] };

  try {
    await recordEvent("opportunity_view", {
      userId: req.session.user?.id || null,
      opportunityId,
    });
  } catch (error) {
    logger.warn({ err: error, opportunityId }, "Opportunity view analytics skipped");
  }

  res.json({
    opportunity: normalizeOpportunity(opportunity, {
      bookmarked,
      has_applied: Boolean(application),
      application_status: application?.status || "",
      application,
      primary_reason: scoreInfo.reason,
      reason: scoreInfo.reason,
    }),
  });
}));

router.post("/:id/apply", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const coverNote = typeof req.body.cover_note === "string" && req.body.cover_note.trim()
    ? req.body.cover_note.trim()
    : typeof req.body.coverNote === "string" && req.body.coverNote.trim()
      ? req.body.coverNote.trim()
      : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT o.id, o.title, o.status, o.deadline, org.id AS organization_id, org.name AS organization_name
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved' AND o.deadline > NOW()`,
      [opportunityId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const { rows: [application] } = await client.query(
      `INSERT INTO application (opportunity_id, applicant_user_id, cover_note, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, opportunity_id, applicant_user_id, cover_note, status, created_at, updated_at`,
      [opportunityId, req.session.user.id, coverNote]
    );

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [application.id, "application_created", null, "pending", req.session.user.id]
    );

    const ownerUserId = await getOpportunityOwner(client, opportunityId);
    if (ownerUserId) {
      await emit(ownerUserId, "application.received", {
        applicationId: application.id,
        opportunityId,
        applicantUserId: req.session.user.id,
        opportunityTitle: rows[0].title,
      }, client);
    }

    await recordEvent("opportunity_applied", {
      userId: req.session.user.id,
      opportunityId,
    }, client);

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
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

router.delete("/:id/apply", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT a.id, a.status, a.opportunity_id, a.applicant_user_id, o.title
       FROM application a
       JOIN opportunity o ON o.id = a.opportunity_id
       WHERE a.opportunity_id = $1 AND a.applicant_user_id = $2
       FOR UPDATE`,
      [opportunityId, req.session.user.id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const application = rows[0];
    const from = normalizeStatus(application.status);
    try {
      assertTransition(from, "withdrawn", "student");
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    const { rowCount } = await client.query(
      "UPDATE application SET status = 'withdrawn', updated_at = NOW() WHERE id = $1 AND status = $2",
      [application.id, from]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [application.id, "status_transition", from, "withdrawn", req.session.user.id]
    );

    const ownerUserId = await getOpportunityOwner(client, opportunityId);
    if (ownerUserId) {
      await emit(ownerUserId, "application.status_changed", {
        applicationId: application.id,
        opportunityId,
        fromStatus: from,
        toStatus: "withdrawn",
        actorUserId: req.session.user.id,
        actorRole: "student",
      }, client);
    }

    await recordEvent("opportunity_withdrawn", {
      userId: req.session.user.id,
      opportunityId,
    }, client);

    await client.query("COMMIT");
    res.json({ message: "Application withdrawn", applicationId: application.id, status: "withdrawn" });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity withdrawal failed");
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
