const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const {
  emitApplicationReceived,
  emitApplicationStatusChanged,
  getOpportunityForApplicant,
  getOpportunityOwner,
  loadApplicationAccess,
  parseId,
  toIso,
} = require("../lib/opportunity/lifecycle");
const {
  buildRecommendationContext,
  buildRecommendationPayload,
  scoreOpportunity,
  tokenizeText,
} = require("../lib/opportunity/recommendations");

const router = express.Router();

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

function toOpportunity(row, extras = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    deadline: toIso(row.deadline),
    created_at: toIso(row.created_at),
    published_at: toIso(row.published_at),
    status: row.status,
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

function buildVisibilityFilters(search, deadline, values, filters) {
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

  return { values, filters };
}

async function loadStudentState(client, userId, opportunityIds) {
  if (!userId || opportunityIds.length === 0) {
    return { bookmarks: new Set(), applications: new Map(), histories: new Map() };
  }

  const { rows: bookmarkRows } = await client.query(
    "SELECT event_id AS opportunity_id FROM bookmark WHERE user_id = $1",
    [userId]
  );

  const { rows: applicationRows } = await client.query(
    `SELECT a.id, a.opportunity_id, a.status, a.cover_note, a.created_at, a.updated_at,
            o.title, o.description, o.location, o.organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1 AND a.opportunity_id = ANY($2::int[])
     ORDER BY a.created_at DESC, a.id DESC`,
    [userId, opportunityIds]
  );

  const applicationIds = applicationRows.map((row) => row.id);
  const { rows: historyRows } = await client.query(
    `SELECT application_id, id, action, from_status, to_status, actor_user_id, created_at
     FROM application_history
     WHERE application_id = ANY($1::int[])
     ORDER BY created_at ASC, id ASC`,
    [applicationIds]
  );

  const historyByApplication = new Map();
  for (const row of historyRows) {
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

  const applicationByOpportunity = new Map();
  for (const row of applicationRows) {
    applicationByOpportunity.set(row.opportunity_id, {
      id: row.id,
      status: row.status,
      cover_note: row.cover_note,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      history: historyByApplication.get(row.id) || [],
      opportunity: toOpportunity(row),
    });
  }

  return {
    bookmarks: new Set(bookmarkRows.map((row) => row.opportunity_id)),
    applications: applicationByOpportunity,
  };
}

async function loadRecommendationContext(client, userId) {
  if (!userId) {
    return buildRecommendationContext([], []);
  }

  const { rows: historyRows } = await client.query(
    `SELECT a.opportunity_id, o.title, o.description, o.location, o.organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [userId]
  );

  const { rows: bookmarkRows } = await client.query(
    `SELECT b.event_id AS opportunity_id, o.title, o.description, o.location, o.organization_id, org.name AS organization_name
     FROM bookmark b
     JOIN opportunity o ON o.id = b.event_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
     ORDER BY b."saved_At" DESC, b.id DESC`,
    [userId]
  );

  return buildRecommendationContext(historyRows, bookmarkRows);
}

async function loadVisibleOpportunities(client, userId, query = {}) {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 20);
  const offset = (page - 1) * limit;
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const deadline = typeof query.deadline === "string" ? query.deadline.trim().toLowerCase() : "";

  const filters = ["o.status = 'published'", "org.status = 'approved'"];
  const values = [];
  buildVisibilityFilters(search, deadline, values, filters);

  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE ${filters.join(" AND ")}`,
    values
  );

  const opportunitySql = `
    SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
           org.id AS organization_id, org.name AS organization_name,
           org.description AS organization_description, org.website AS organization_website
    FROM opportunity o
    JOIN organization org ON org.id = o.organization_id
    WHERE ${filters.join(" AND ")}
    ORDER BY o.deadline ASC, o.published_at DESC NULLS LAST, o.id ASC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  const { rows } = await client.query(opportunitySql, [...values, limit, offset]);
  const opportunityIds = rows.map((row) => row.id);

  const recommendationContext = userId ? await loadRecommendationContext(client, userId) : buildRecommendationContext([], []);
  const studentState = userId ? await loadStudentState(client, userId, opportunityIds) : { bookmarks: new Set(), applications: new Map() };

  const opportunities = rows.map((row) => {
    const scored = userId
      ? scoreOpportunity({
          ...row,
          title: row.title,
          description: row.description,
          location: row.location,
          organization_name: row.organization_name,
          deadline: row.deadline,
          published_at: row.published_at,
        }, recommendationContext)
      : { score: 0, reason: "Published opportunity" };

    const application = studentState.applications.get(row.id) || null;
    return toOpportunity(row, {
      bookmarked: studentState.bookmarks ? studentState.bookmarks.has(row.id) : false,
      has_applied: Boolean(application),
      application_status: application?.status || "",
      application,
      primary_reason: scored.reason,
      reason: scored.reason,
    });
  });

  return {
    items: opportunities,
    opportunities,
    page,
    limit,
    total: countRows[0]?.total || 0,
    hasMore: offset + opportunities.length < (countRows[0]?.total || 0),
  };
}

router.get("/saved/ids", catchAsync(async (req, res) => {
  if (!req.session.user || req.session.user.role !== "student") {
    return res.json({ ids: [] });
  }

  const { rows } = await pool.query(
    "SELECT event_id FROM bookmark WHERE user_id = $1",
    [req.session.user.id]
  );

  res.json({ ids: rows.map((row) => row.event_id) });
}));

router.get("/saved", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM bookmark b
     JOIN opportunity o ON o.id = b.event_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
     ORDER BY b."saved_At" DESC, b.id DESC`,
    [req.session.user.id]
  );

  res.json({
    opportunities: rows.map((row) => toOpportunity(row, { bookmarked: true })),
    items: rows.map((row) => toOpportunity(row, { bookmarked: true })),
  });
}));

router.get("/", catchAsync(async (req, res) => {
  const studentUserId = req.session.user?.role === "student" ? req.session.user.id : null;
  const data = await loadVisibleOpportunities(pool, studentUserId, req.query);
  res.json(data);
}));

async function listStudentApplications(userId) {
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
    [userId]
  );

  const applicationIds = rows.map((row) => row.id);
  const { rows: historyRows } = applicationIds.length
    ? await pool.query(
        `SELECT application_id, id, action, from_status, to_status, actor_user_id, created_at
         FROM application_history
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC`,
        [applicationIds]
      )
    : { rows: [] };

  const historyByApplication = new Map();
  for (const row of historyRows) {
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
    opportunity_title: row.title,
    opportunity_name: row.title,
    title: row.title,
    organization_name: row.organization_name,
    status: row.status,
    cover_note: row.cover_note,
    deadline: toIso(row.deadline),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    history: historyByApplication.get(row.id) || [],
    opportunity: toOpportunity({
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

  return applications;
}

router.get(["/mine", "/applications"], requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const applications = await listStudentApplications(req.session.user.id);
  res.json({ applications, items: applications });
}));

router.get("/applications/:id/history", requireAuth, catchAsync(async (req, res) => {
  const applicationId = parseId(req.params.id);
  if (!applicationId) {
    return res.status(404).json({ error: "Application not found" });
  }

  const application = await loadApplicationAccess(pool, applicationId);
  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }

  const ownerUserId = await getOpportunityOwner(pool, application.opportunity_id);
  const role = req.session.user.role;
  const isApplicant = application.applicant_user_id === req.session.user.id;
  const isOwner = ownerUserId === req.session.user.id;
  const isAdmin = role === "admin";

  if (!isApplicant && !isOwner && !isAdmin) {
    return res.status(404).json({ error: "Application not found" });
  }

  const { rows } = await pool.query(
    `SELECT id, application_id, action, from_status, to_status, actor_user_id, created_at
     FROM application_history
     WHERE application_id = $1
     ORDER BY created_at ASC, id ASC`,
    [applicationId]
  );

  res.json({
    applicationId,
    history: rows.map((row) => ({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      created_at: toIso(row.created_at),
    })),
  });
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
      const score = tokenizeText([row.title, row.description, row.location, row.organization_name].join(" "))
        .filter((token) => tokens.includes(token)).length;
      return { row, score };
    })
    .sort((left, right) => right.score - left.score || new Date(left.row.deadline) - new Date(right.row.deadline) || left.row.id - right.row.id)
    .slice(0, 3)
    .map(({ row }) => toOpportunity(row));

  res.json({ opportunities: scored, items: scored });
}));

router.post("/:id/bookmark", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await getOpportunityForApplicant(pool, opportunityId);
  if (!opportunity) {
    const { rows } = await pool.query(
      `SELECT o.id
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       WHERE o.id = $1`,
      [opportunityId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Opportunity not found" });
    }
  }

  const { rows: existing } = await pool.query(
    "SELECT id FROM bookmark WHERE user_id = $1 AND event_id = $2",
    [req.session.user.id, opportunityId]
  );
  if (existing.length > 0) {
    return res.status(409).json({ error: "Event already saved" });
  }

  await pool.query(
    "INSERT INTO bookmark (user_id, event_id) VALUES ($1, $2)",
    [req.session.user.id, opportunityId]
  );

  res.status(201).json({ message: "Event saved" });
}));

router.delete("/:id/bookmark", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rowCount } = await pool.query(
    "DELETE FROM bookmark WHERE user_id = $1 AND event_id = $2",
    [req.session.user.id, req.params.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "No saved event to remove" });
  }

  res.json({ message: "Event removed from saved" });
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

    const opportunity = await getOpportunityForApplicant(client, opportunityId);
    if (!opportunity) {
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
      await emitApplicationReceived(client, {
        ownerUserId,
        applicationId: application.id,
        opportunityId,
        applicantUserId: req.session.user.id,
        opportunityTitle: opportunity.title,
      });
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

    throw error;
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
      `SELECT a.id, a.status, a.opportunity_id, a.applicant_user_id,
              o.title, o.organization_id
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
      await emitApplicationStatusChanged(client, {
        recipientUserId: ownerUserId,
        applicationId: application.id,
        opportunityId,
        fromStatus: from,
        toStatus: "withdrawn",
        actorUserId: req.session.user.id,
        actorRole: "student",
      });
    }

    await client.query("COMMIT");
    res.json({ message: "Application withdrawn", applicationId: application.id, status: "withdrawn" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  let application = null;
  let bookmarked = false;

  if (req.session.user && req.session.user.role === "student") {
    const [applicationResult, bookmarkResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at
         FROM application a
         WHERE a.opportunity_id = $1 AND a.applicant_user_id = $2`,
        [opportunityId, req.session.user.id]
      ),
      pool.query(
        "SELECT id FROM bookmark WHERE user_id = $1 AND event_id = $2",
        [req.session.user.id, opportunityId]
      ),
    ]);

    application = applicationResult.rows[0]
      ? {
          ...applicationResult.rows[0],
          created_at: toIso(applicationResult.rows[0].created_at),
          updated_at: toIso(applicationResult.rows[0].updated_at),
        }
      : null;
    bookmarked = bookmarkResult.rows.length > 0;
  }

  res.json({
    opportunity: toOpportunity(opportunity, {
      bookmarked,
      has_applied: Boolean(application),
      application_status: application?.status || "",
      application,
      primary_reason: "Published opportunity",
      reason: "Published opportunity",
    }),
  });
}));

module.exports = router;
