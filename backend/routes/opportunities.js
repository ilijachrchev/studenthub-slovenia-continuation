const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");
const { emit } = require("../lib/opportunity/notifications");
const {
  getOpportunityOwnerUserId,
  getOpportunityTags,
  parseId,
  toIso,
} = require("../lib/opportunity/shared");

const applicationRoutes = require("./applications");

const router = express.Router();

const PUBLIC_STATUSES = ["submitted", "published", "closed"];

function normalizeRemote(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function isRemoteOpportunity(row) {
  const location = String(row.location || "").toLowerCase();
  const applyUrl = String(row.apply_url || "").toLowerCase();
  return location.includes("online") || location.includes("remote") || applyUrl.includes("remote");
}

function serializeOpportunity(row, { tags = [], bookmarked = false, application = null } = {}) {
  const deadline = row.application_deadline || row.deadline;

  return {
    id: row.id,
    title: row.title,
    summary: row.summary || "",
    description: row.description || "",
    location: row.location || "Online",
    status: row.status,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at || row.created_at),
    published_at: toIso(row.published_at),
    closed_at: toIso(row.closed_at),
    archived_at: toIso(row.archived_at),
    deadline: toIso(deadline),
    application_deadline: toIso(deadline),
    start_date: toIso(row.start_date),
    end_date: toIso(row.end_date),
    capacity: row.capacity,
    compensation: row.compensation || "",
    contact_email: row.contact_email || "",
    apply_url: row.apply_url || "",
    remote: isRemoteOpportunity(row),
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_website: row.organization_website,
    bookmarked,
    tags,
    application,
    application_status: application?.status || row.application_status || "",
  };
}

async function loadOpportunityDetails(client, opportunityId, userId = null) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1
       AND o.status = ANY($2::text[])`,
    [opportunityId, PUBLIC_STATUSES]
  );

  if (rows.length === 0) {
    return null;
  }

  const opportunity = rows[0];
  const tagsByOpportunity = await getOpportunityTags(db, [opportunityId]);
  const tags = tagsByOpportunity.get(opportunityId) || [];

  let bookmarked = false;
  let application = null;

  if (userId) {
    const { rows: bookmarkRows } = await db.query(
      "SELECT 1 FROM opportunity_bookmark WHERE user_id = $1 AND opportunity_id = $2",
      [userId, opportunityId]
    );
    bookmarked = bookmarkRows.length > 0;

    const { rows: applicationRows } = await db.query(
      `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at
       FROM application a
       WHERE a.opportunity_id = $1 AND a.applicant_user_id = $2
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1`,
      [opportunityId, userId]
    );

    if (applicationRows.length > 0) {
      application = {
        id: applicationRows[0].id,
        status: applicationRows[0].status,
        cover_note: applicationRows[0].cover_note,
        created_at: toIso(applicationRows[0].created_at),
        updated_at: toIso(applicationRows[0].updated_at),
      };
    }
  }

  return serializeOpportunity(opportunity, { tags, bookmarked, application });
}

async function loadRelatedOpportunities(client, opportunityId) {
  const db = client || pool;
  const { rows: rootRows } = await db.query(
    `SELECT o.id, o.organization_id
     FROM opportunity o
     WHERE o.id = $1 AND o.status = ANY($2::text[])`,
    [opportunityId, PUBLIC_STATUSES]
  );

  if (rootRows.length === 0) {
    return [];
  }

  const root = rootRows[0];
  const { rows: relatedRows } = await db.query(
    `SELECT DISTINCT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     LEFT JOIN opportunity_tag ot ON ot.opportunity_id = o.id
     WHERE o.id <> $1
       AND o.status = ANY($2::text[])
       AND (
         o.organization_id = $3
         OR ot.tag_id IN (
           SELECT tag_id
           FROM opportunity_tag
           WHERE opportunity_id = $1
         )
       )
     ORDER BY o.updated_at DESC, o.created_at DESC
     LIMIT 6`,
    [opportunityId, PUBLIC_STATUSES, root.organization_id]
  );

  const tagsByOpportunity = await getOpportunityTags(db, relatedRows.map((row) => row.id));
  return relatedRows.map((row) =>
    serializeOpportunity(row, { tags: tagsByOpportunity.get(row.id) || [] })
  );
}

function parseOpportunityFilters(query) {
  const filters = [];
  const values = [];
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const deadline = typeof query.deadline === "string" ? query.deadline.trim() : "";
  const remote = normalizeRemote(query.remote);
  const tag = typeof query.tag === "string" ? query.tag.trim() : "";

  filters.push(`o.status = ANY($${values.push(PUBLIC_STATUSES)}::text[])`);

  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    filters.push(
      `(o.title ILIKE $${index} OR COALESCE(o.summary, '') ILIKE $${index} OR COALESCE(o.description, '') ILIKE $${index} OR COALESCE(o.location, '') ILIKE $${index})`
    );
  }

  if (remote === true) {
    filters.push(
      `(LOWER(COALESCE(o.location, '')) LIKE '%online%' OR LOWER(COALESCE(o.location, '')) LIKE '%remote%' OR LOWER(COALESCE(o.apply_url, '')) LIKE '%remote%')`
    );
  } else if (remote === false) {
    filters.push(
      `NOT (LOWER(COALESCE(o.location, '')) LIKE '%online%' OR LOWER(COALESCE(o.location, '')) LIKE '%remote%' OR LOWER(COALESCE(o.apply_url, '')) LIKE '%remote%')`
    );
  }

  if (deadline) {
    values.push(deadline);
    filters.push(`DATE(COALESCE(o.application_deadline, o.deadline)) <= DATE($${values.length})`);
  }

  if (tag) {
    values.push(tag);
    const index = values.length;
    if (/^\d+$/.test(tag)) {
      filters.push(
        `EXISTS (
          SELECT 1
          FROM opportunity_tag ot
          WHERE ot.opportunity_id = o.id
            AND ot.tag_id = $${index}::int
        )`
      );
    } else {
      filters.push(
        `EXISTS (
          SELECT 1
          FROM opportunity_tag ot
          JOIN tag t ON t.id = ot.tag_id
          WHERE ot.opportunity_id = o.id
            AND LOWER(t.name) = LOWER($${index})
        )`
      );
    }
  }

  return { filters, values };
}

router.get("/", catchAsync(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const { filters, values } = parseOpportunityFilters(req.query);
  const whereClause = filters.join(" AND ");

  const countQuery = `SELECT COUNT(*)::int AS total FROM opportunity o WHERE ${whereClause}`;
  const { rows: countRows } = await pool.query(countQuery, values);

  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE ${whereClause}
     ORDER BY COALESCE(o.application_deadline, o.deadline) ASC, o.id ASC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  const opportunityIds = rows.map((row) => row.id);
  const tagsByOpportunity = await getOpportunityTags(pool, opportunityIds);

  let bookmarkedIds = new Set();
  let applicationByOpportunity = new Map();
  if (req.session.user) {
    const userId = req.session.user.id;
    if (opportunityIds.length > 0) {
      const { rows: bookmarkRows } = await pool.query(
        "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1 AND opportunity_id = ANY($2::int[])",
        [userId, opportunityIds]
      );
      bookmarkedIds = new Set(bookmarkRows.map((row) => row.opportunity_id));

      const { rows: applicationRows } = await pool.query(
        `SELECT a.id, a.opportunity_id, a.status, a.cover_note, a.created_at, a.updated_at
         FROM application a
         WHERE a.applicant_user_id = $1
           AND a.opportunity_id = ANY($2::int[])
         ORDER BY a.created_at DESC, a.id DESC`,
        [userId, opportunityIds]
      );

      for (const row of applicationRows) {
        if (!applicationByOpportunity.has(row.opportunity_id)) {
          applicationByOpportunity.set(row.opportunity_id, {
            id: row.id,
            status: row.status,
            cover_note: row.cover_note,
            created_at: toIso(row.created_at),
            updated_at: toIso(row.updated_at),
          });
        }
      }
    }
  }

  const opportunities = rows.map((row) =>
    serializeOpportunity(row, {
      tags: tagsByOpportunity.get(row.id) || [],
      bookmarked: bookmarkedIds.has(row.id),
      application: applicationByOpportunity.get(row.id) || null,
    })
  );

  res.json({
    opportunities,
    items: opportunities,
    page,
    limit,
    total: countRows[0].total,
    hasMore: offset + opportunities.length < countRows[0].total,
  });
}));

router.get("/saved/ids", catchAsync(async (req, res) => {
  if (!req.session.user) {
    return res.json({ ids: [] });
  }

  const { rows } = await pool.query(
    "SELECT opportunity_id FROM opportunity_bookmark WHERE user_id = $1 ORDER BY saved_at DESC, id DESC",
    [req.session.user.id]
  );

  res.json({ ids: rows.map((row) => row.opportunity_id) });
}));

router.get("/saved", requireAuth, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity_bookmark b
     JOIN opportunity o ON o.id = b.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
       AND o.status = ANY($2::text[])
     ORDER BY b.saved_at DESC, b.id DESC`,
    [req.session.user.id, PUBLIC_STATUSES]
  );

  const tagsByOpportunity = await getOpportunityTags(pool, rows.map((row) => row.id));
  const opportunities = rows.map((row) =>
    serializeOpportunity(row, { tags: tagsByOpportunity.get(row.id) || [], bookmarked: true })
  );

  res.json({ opportunities, items: opportunities });
}));

router.get("/:id", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await loadOpportunityDetails(pool, opportunityId, req.session.user?.id || null);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  res.json({ opportunity });
}));

router.get("/:id/related", catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.json({ opportunities: [], items: [] });
  }

  const opportunities = await loadRelatedOpportunities(pool, opportunityId);
  res.json({ opportunities, items: opportunities });
}));

router.post("/:id/bookmark", requireAuth, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    "SELECT id FROM opportunity WHERE id = $1 AND status = ANY($2::text[])",
    [opportunityId, PUBLIC_STATUSES]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  try {
    await pool.query(
      `INSERT INTO opportunity_bookmark (user_id, opportunity_id)
       VALUES ($1, $2)`,
      [req.session.user.id, opportunityId]
    );
  } catch (error) {
    if (error && error.code === "23505") {
      return res.status(409).json({ error: "Opportunity already saved" });
    }
    throw error;
  }

  res.status(201).json({ message: "Opportunity saved" });
}));

router.delete("/:id/bookmark", requireAuth, catchAsync(async (req, res) => {
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

  res.json({ message: "Opportunity removed from saved" });
}));

router.use("/", applicationRoutes);

module.exports = router;
