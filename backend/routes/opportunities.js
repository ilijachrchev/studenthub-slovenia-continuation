const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const requireStudent = requireRole("student");

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isOpenOpportunity(row) {
  if (!row) return false;
  const deadline = row.deadline ? new Date(row.deadline) : null;
  return row.status === "published" && deadline && !Number.isNaN(deadline.getTime()) && deadline >= new Date();
}

function mapOpportunityRow(row, currentUserId = null) {
  const application = row.application_id
    ? {
        id: row.application_id,
        status: row.application_status,
        appliedAt: toIso(row.application_created_at),
        updatedAt: toIso(row.application_updated_at),
        coverNote: row.application_cover_note || "",
      }
    : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    location: row.location || "",
    status: row.status,
    deadline: toIso(row.deadline),
    publishedAt: toIso(row.published_at),
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationWebsite: row.organization_website || "",
    organizationDescription: row.organization_description || "",
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      website: row.organization_website || "",
      description: row.organization_description || "",
    },
    bookmarked: Boolean(row.bookmark_id),
    applicationStatus: row.application_status || "",
    application,
    canApply: row.status === "published" && Boolean(currentUserId) && !application && isOpenOpportunity(row),
    applicationHistory: [],
  };
}

async function loadApplicationHistory(applicationId) {
  if (!applicationId) return [];

  const { rows } = await pool.query(
    `SELECT id, application_id, action, from_status, to_status, actor_user_id, created_at
     FROM application_history
     WHERE application_id = $1
     ORDER BY created_at ASC, id ASC`,
    [applicationId]
  );

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    from_status: row.from_status,
    to_status: row.to_status,
    actor_user_id: row.actor_user_id,
    created_at: toIso(row.created_at),
  }));
}

function applyOpportunityFilters(baseClauses, values, query) {
  const search = normalizeText(query.search);
  if (search) {
    values.push(`%${search}%`);
    baseClauses.push(
      `(op.title ILIKE $${values.length} OR COALESCE(op.description, '') ILIKE $${values.length} OR COALESCE(org.name, '') ILIKE $${values.length} OR COALESCE(op.location, '') ILIKE $${values.length})`
    );
  }

  const location = normalizeText(query.location);
  if (location) {
    values.push(`%${location}%`);
    baseClauses.push(`COALESCE(op.location, '') ILIKE $${values.length}`);
  }

  const organizer = normalizeText(query.organizer);
  if (organizer) {
    const organizerId = parseInteger(organizer);
    if (organizerId != null) {
      values.push(organizerId);
      baseClauses.push(`org.id = $${values.length}`);
    } else {
      values.push(`%${organizer}%`);
      baseClauses.push(`org.name ILIKE $${values.length}`);
    }
  }

  const deadline = normalizeText(query.deadline);
  if (deadline) {
    const normalized = new Date(deadline);
    if (Number.isNaN(normalized.getTime())) {
      const error = new Error("deadline must be a valid date");
      error.status = 400;
      throw error;
    }

    normalized.setHours(23, 59, 59, 999);
    values.push(normalized.toISOString());
    baseClauses.push(`op.deadline <= $${values.length}`);
  }

}

async function loadOpportunityList(query, userId = null, includePrivate = false) {
  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 12), 50);
  const offset = (page - 1) * limit;

  const baseClauses = [];
  const values = [];

  const availability = normalizeText(query.availability).toLowerCase();
  if (!includePrivate) {
    if (!availability || availability === "open") {
      baseClauses.push("op.status = 'published'");
      baseClauses.push("op.deadline >= NOW()");
    } else if (availability === "closed") {
      baseClauses.push("op.status = 'published'");
      baseClauses.push("op.deadline < NOW()");
    } else if (availability === "all") {
      baseClauses.push("op.status = 'published'");
    } else {
      const error = new Error("availability must be open, closed, or all");
      error.status = 400;
      throw error;
    }
  }

  if (includePrivate) {
    baseClauses.push("op.status = 'published'");
  }

  applyOpportunityFilters(baseClauses, values, query);

  const whereClause = baseClauses.length ? `WHERE ${baseClauses.join(" AND ")}` : "";

  const joinForUser =
    userId != null
      ? `
        LEFT JOIN opportunity_bookmark ob
          ON ob.opportunity_id = op.id AND ob.user_id = $${values.length + 1}
        LEFT JOIN application app
          ON app.opportunity_id = op.id AND app.applicant_user_id = $${values.length + 1}
      `
      : "";

  const listSql = `
    SELECT op.id, op.title, op.description, op.location, op.status, op.deadline, op.published_at,
           org.id AS organization_id, org.name AS organization_name,
           org.description AS organization_description, org.website AS organization_website,
           ob.id AS bookmark_id,
           app.id AS application_id, app.status AS application_status,
           app.cover_note AS application_cover_note, app.created_at AS application_created_at,
           app.updated_at AS application_updated_at
    FROM opportunity op
    JOIN organization org ON org.id = op.organization_id
    ${joinForUser}
    ${whereClause}
    ORDER BY op.deadline ASC, op.id ASC
    LIMIT $${values.length + (userId != null ? 2 : 1)}
    OFFSET $${values.length + (userId != null ? 3 : 2)}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM opportunity op
    JOIN organization org ON org.id = op.organization_id
    ${whereClause}
  `;

  const countValues = values.slice();
  const { rows: countRows } = await pool.query(countSql, countValues);

  const listValues = userId != null ? values.concat([userId, limit, offset]) : values.concat([limit, offset]);
  const { rows: items } = await pool.query(listSql, listValues);

  const opportunities = items.map((row) => mapOpportunityRow(row, userId));

  return {
    items: opportunities,
    opportunities,
    page,
    limit,
    total: Number(countRows[0]?.total || 0),
    hasMore: offset + opportunities.length < Number(countRows[0]?.total || 0),
  };
}

async function loadOpportunityDetail(opportunityId, userId = null) {
  const { rows } = await pool.query(
    `SELECT op.id, op.title, op.description, op.location, op.status, op.deadline, op.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website,
            owner.user_id AS owner_user_id,
            ob.id AS bookmark_id,
            app.id AS application_id, app.status AS application_status,
            app.cover_note AS application_cover_note, app.created_at AS application_created_at,
            app.updated_at AS application_updated_at
     FROM opportunity op
     JOIN organization org ON org.id = op.organization_id
     LEFT JOIN organizer_profile owner
       ON owner.organization_id = org.id AND owner.role_in_org = 'owner'
     ${userId != null ? `
     LEFT JOIN opportunity_bookmark ob
       ON ob.opportunity_id = op.id AND ob.user_id = $2
     LEFT JOIN application app
       ON app.opportunity_id = op.id AND app.applicant_user_id = $2
     ` : ""}
     WHERE op.id = $1`,
    userId != null ? [opportunityId, userId] : [opportunityId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  const currentUserIsOwner = userId != null && row.owner_user_id === userId;
  const currentUserHasApplication = Boolean(row.application_id);
  const currentUserHasBookmark = Boolean(row.bookmark_id);
  const visibleToCurrentUser =
    row.status === "published" ||
    currentUserIsOwner ||
    currentUserHasApplication ||
    currentUserHasBookmark;

  if (!visibleToCurrentUser) {
    return null;
  }

  const opportunity = mapOpportunityRow(row, userId);
  if (opportunity.application) {
    opportunity.applicationHistory = await loadApplicationHistory(opportunity.application.id);
    opportunity.application.history = opportunity.applicationHistory;
  }

  return opportunity;
}

router.get("/", catchAsync(async (req, res) => {
  const userId = req.session.user ? req.session.user.id : null;
  const list = await loadOpportunityList(req.query, userId);
  res.json(list);
}));

router.get("/saved/ids", catchAsync(async (req, res) => {
  if (!req.session.user || req.session.user.role !== "student") {
    return res.json({ ids: [], savedIds: [] });
  }

  const { rows } = await pool.query(
    "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1 ORDER BY created_at DESC, opportunity_id DESC",
    [req.session.user.id]
  );

  const ids = rows.map((row) => row.opportunity_id);
  res.json({ ids, savedIds: ids });
}));

router.get("/saved", requireAuth, requireStudent, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT op.id, op.title, op.description, op.location, op.status, op.deadline, op.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website,
            ob.id AS bookmark_id
     FROM opportunity_bookmark ob
     JOIN opportunity op ON op.id = ob.opportunity_id
     JOIN organization org ON org.id = op.organization_id
     WHERE ob.user_id = $1
     ORDER BY ob.created_at DESC, op.deadline ASC, op.id DESC`,
    [req.session.user.id]
  );

  const items = rows.map((row) => mapOpportunityRow(row, req.session.user.id));
  res.json({ items, opportunities: items });
}));

router.get("/:id", catchAsync(async (req, res) => {
  const opportunityId = parseInteger(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const userId = req.session.user ? req.session.user.id : null;
  const opportunity = await loadOpportunityDetail(opportunityId, userId);

  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  res.json({ opportunity });
}));

router.get("/:id/related", catchAsync(async (req, res) => {
  const opportunityId = parseInteger(req.params.id);
  if (!opportunityId) {
    return res.json({ items: [], opportunities: [] });
  }

  const userId = req.session.user ? req.session.user.id : null;
  const current = await loadOpportunityDetail(opportunityId, userId);
  if (!current) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    `SELECT op.id, op.title, op.description, op.location, op.status, op.deadline, op.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity op
     JOIN organization org ON org.id = op.organization_id
     WHERE op.id <> $1
       AND op.organization_id = $2
       AND op.status = 'published'
       AND op.deadline >= NOW()
     ORDER BY op.deadline ASC, op.id ASC
     LIMIT 3`,
    [opportunityId, current.organizationId]
  );

  const items = rows.map((row) => mapOpportunityRow(row, userId));
  res.json({ items, opportunities: items });
}));

router.post("/:id/bookmark", requireAuth, requireStudent, catchAsync(async (req, res) => {
  const opportunityId = parseInteger(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await loadOpportunityDetail(opportunityId, req.session.user.id);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rowCount } = await pool.query(
    `INSERT INTO opportunity_bookmark (user_id, opportunity_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, opportunity_id) DO NOTHING`,
    [req.session.user.id, opportunityId]
  );

  if (rowCount === 0) {
    return res.status(409).json({ error: "Opportunity already saved" });
  }

  res.status(201).json({ message: "Opportunity saved" });
}));

router.delete("/:id/bookmark", requireAuth, requireStudent, catchAsync(async (req, res) => {
  const opportunityId = parseInteger(req.params.id);
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

  res.json({ message: "Opportunity removed from saved" });
}));

module.exports = router;
