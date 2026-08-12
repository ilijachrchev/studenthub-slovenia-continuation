const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { validateOpportunity } = require("../middleware/validateOpportunity");
const { OPPORTUNITY_TRANSITIONS, assertTransition } = require("../domain/opportunityState");

const router = express.Router();
const requireOrganizer = requireRole("organizer");

function placeHolders(n) {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`);
}

function toInt(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseBooleanQuery(value) {
  if (value == null || value === "") {
    return null;
  }
  if (value === true || value === "true" || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === "0") {
    return false;
  }
  return undefined;
}

function normalizeTimestamp(value) {
  if (value == null || value === "") {
    return null;
  }
  return String(value).replace("T", " ");
}

function normalizeText(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text.length ? text : null;
}

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function mapOpportunityRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    location: row.location,
    is_remote: row.is_remote,
    application_mode: row.application_mode,
    external_url: row.external_url,
    compensation: row.compensation,
    capacity: row.capacity,
    application_deadline: row.application_deadline,
    starts_at: row.starts_at,
    published_at: row.published_at,
    status: row.status,
    category_id: row.category_id,
    category_name: row.category_name,
    category_slug: row.category_slug,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_description: row.organization_description,
    organization_logo: row.organization_logo,
    organization_website: row.organization_website,
    organization_contact_email: row.organization_contact_email,
  };
}

async function loadTagsForOpportunityIds(ids) {
  if (!ids.length) {
    return {};
  }

  const placeholders = placeHolders(ids.length);
  const { rows: tagRows } = await pool.query(
    `SELECT ot.opportunity_id, t.id, t.name
     FROM opportunity_tag ot
     JOIN tag t ON t.id = ot.tag_id
     WHERE ot.opportunity_id IN (${placeholders.join(", ")})
     ORDER BY t.name ASC`,
    ids
  );

  const tagsByOpportunity = {};
  for (const row of tagRows) {
    if (!tagsByOpportunity[row.opportunity_id]) {
      tagsByOpportunity[row.opportunity_id] = [];
    }
    tagsByOpportunity[row.opportunity_id].push({ id: row.id, name: row.name });
  }

  return tagsByOpportunity;
}

function buildDiscoveryFilters(query) {
  const clauses = [
    "op.status = 'published'",
    "org.status = 'approved'",
  ];
  const values = [];
  let idx = 1;

  const category = normalizeText(query.category);
  if (category) {
    clauses.push(`cat.slug = $${idx}`);
    values.push(category);
    idx += 1;
  }

  const organizationId = toInt(query.org);
  if (organizationId != null) {
    clauses.push(`op.organization_id = $${idx}`);
    values.push(organizationId);
    idx += 1;
  }

  const remote = parseBooleanQuery(query.remote);
  if (remote === undefined) {
    throw Object.assign(new Error("Remote must be true or false"), { status: 400 });
  }
  if (remote != null) {
    clauses.push(`op.is_remote = $${idx}`);
    values.push(remote);
    idx += 1;
  }

  const deadlineBefore = normalizeText(query.deadline_before);
  if (deadlineBefore) {
    if (!isValidDateString(deadlineBefore)) {
      throw Object.assign(new Error("deadline_before must be a valid date"), { status: 400 });
    }
    clauses.push(`op.application_deadline <= $${idx}`);
    values.push(deadlineBefore);
    idx += 1;
  }

  const q = normalizeText(query.q);
  if (q) {
    clauses.push(`(op.title ILIKE $${idx} OR COALESCE(op.description, '') ILIKE $${idx})`);
    values.push(`%${q}%`);
    idx += 1;
  }

  const tag = normalizeText(query.tag);
  if (tag) {
    if (/^\d+$/.test(tag)) {
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM opportunity_tag otf
          JOIN tag tf ON tf.id = otf.tag_id
          WHERE otf.opportunity_id = op.id
            AND tf.id = $${idx}
        )`
      );
      values.push(Number(tag));
      idx += 1;
    } else {
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM opportunity_tag otf
          JOIN tag tf ON tf.id = otf.tag_id
          WHERE otf.opportunity_id = op.id
            AND tf.name ILIKE $${idx}
        )`
      );
      values.push(`%${tag}%`);
      idx += 1;
    }
  }

  return { whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

async function findOwnedOrganizationId(userId, client = pool) {
  const { rows } = await client.query(
    `SELECT org.id
     FROM organization org
     JOIN organizer_profile opf
       ON opf.organization_id = org.id
      AND opf.role_in_org = 'owner'
     WHERE opf.user_id = $1
       AND org.status = 'approved'
     ORDER BY org.id ASC
     LIMIT 1`,
    [userId]
  );

  return rows.length ? rows[0].id : null;
}

async function findOwnedOpportunity(opportunityId, userId, client = pool, lockForUpdate = false) {
  const { rows } = await client.query(
    `SELECT op.id, op.status, op.organization_id
     FROM opportunity op
     JOIN organization org ON org.id = op.organization_id
     JOIN organizer_profile opf
       ON opf.organization_id = org.id
      AND opf.role_in_org = 'owner'
     WHERE op.id = $1
       AND opf.user_id = $2
     ${lockForUpdate ? "FOR UPDATE" : ""}`,
    [opportunityId, userId]
  );

  return rows.length ? rows[0] : null;
}

async function upsertOpportunityTags(client, opportunityId, tagIds) {
  if (!tagIds || !tagIds.length) {
    return;
  }

  const uniqueTagIds = Array.from(new Set(tagIds.map((tagId) => Number(tagId))));
  const placeholders = placeHolders(uniqueTagIds.length);
  const { rows: existingTags } = await client.query(
    `SELECT id FROM tag WHERE id IN (${placeholders.join(", ")})`,
    uniqueTagIds
  );

  if (existingTags.length !== uniqueTagIds.length) {
    throw Object.assign(new Error("One or more tags were not found"), { status: 400 });
  }

  for (const tagId of uniqueTagIds) {
    await client.query(
      "INSERT INTO opportunity_tag (opportunity_id, tag_id) VALUES ($1, $2)",
      [opportunityId, tagId]
    );
  }
}

async function loadPublicOpportunityList(baseQuery, page, limit) {
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM opportunity op
    JOIN organization org ON org.id = op.organization_id
    LEFT JOIN opportunity_category cat ON cat.id = op.category_id
    ${baseQuery.whereSql}
  `;

  const listSql = `
    SELECT op.id, op.title, op.description, op.type, op.location,
           op.is_remote, op.application_mode, op.external_url, op.compensation,
           op.capacity, op.application_deadline, op.starts_at, op.published_at,
           op.status,
           cat.id AS category_id, cat.name AS category_name, cat.slug AS category_slug,
           org.id AS organization_id, org.name AS organization_name,
           org.description AS organization_description, org.logo AS organization_logo,
           org.website AS organization_website, org.contact_email AS organization_contact_email
    FROM opportunity op
    JOIN organization org ON org.id = op.organization_id
    LEFT JOIN opportunity_category cat ON cat.id = op.category_id
    ${baseQuery.whereSql}
    ORDER BY op.published_at DESC, op.id DESC
    LIMIT $${baseQuery.values.length + 1}
    OFFSET $${baseQuery.values.length + 2}
  `;

  const countValues = baseQuery.values.slice();
  const { rows: countRows } = await pool.query(countSql, countValues);
  const total = Number(countRows[0]?.total || 0);

  const listValues = baseQuery.values.concat([limit, (page - 1) * limit]);
  const { rows: items } = await pool.query(listSql, listValues);
  const tagsByOpportunity = await loadTagsForOpportunityIds(items.map((item) => item.id));

  return {
    total,
    items: items.map((item) => ({
      ...mapOpportunityRow(item),
      tags: tagsByOpportunity[item.id] || [],
    })),
  };
}

// /api/opportunities GET method
router.get("/opportunities", catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  let filters;
  try {
    filters = buildDiscoveryFilters(req.query);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { total, items } = await loadPublicOpportunityList(filters, page, limit);
  res.json({ items, page, limit, total });
}));

// /api/opportunities/:id GET method
router.get("/opportunities/:id", catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT op.id, op.title, op.description, op.type, op.location,
            op.is_remote, op.application_mode, op.external_url, op.compensation,
            op.capacity, op.application_deadline, op.starts_at, op.published_at,
            op.status,
            cat.id AS category_id, cat.name AS category_name, cat.slug AS category_slug,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.logo AS organization_logo,
            org.website AS organization_website, org.contact_email AS organization_contact_email
     FROM opportunity op
     JOIN organization org ON org.id = op.organization_id AND org.status = 'approved'
     LEFT JOIN opportunity_category cat ON cat.id = op.category_id
     WHERE op.id = $1
       AND op.status = 'published'`,
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = mapOpportunityRow(rows[0]);
  const tagsByOpportunity = await loadTagsForOpportunityIds([opportunity.id]);
  opportunity.tags = tagsByOpportunity[opportunity.id] || [];

  res.json(opportunity);
}));

// /api/organizer/opportunities GET method
router.get("/organizer/opportunities", requireOrganizer, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT op.id, op.title, op.description, op.type, op.location,
            op.is_remote, op.application_mode, op.external_url, op.compensation,
            op.capacity, op.application_deadline, op.starts_at, op.published_at,
            op.status,
            cat.id AS category_id, cat.name AS category_name, cat.slug AS category_slug,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.logo AS organization_logo,
            org.website AS organization_website, org.contact_email AS organization_contact_email
     FROM opportunity op
     JOIN organization org ON org.id = op.organization_id
     JOIN organizer_profile opf
       ON opf.organization_id = org.id
      AND opf.role_in_org = 'owner'
     LEFT JOIN opportunity_category cat ON cat.id = op.category_id
     WHERE opf.user_id = $1
     ORDER BY op.published_at DESC, op.id DESC`,
    [req.session.user.id]
  );

  const tagsByOpportunity = await loadTagsForOpportunityIds(rows.map((row) => row.id));
  const items = rows.map((row) => ({
    ...mapOpportunityRow(row),
    tags: tagsByOpportunity[row.id] || [],
  }));

  res.json({ items });
}));

// /api/opportunities POST method
router.post("/opportunities", requireOrganizer, catchAsync(async (req, res) => {
  const validationErrors = validateOpportunity(req.body, { requireTags: true });
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors[0] });
  }

  const organizationId = await findOwnedOrganizationId(req.session.user.id);
  if (!organizationId) {
    return res.status(403).json({ error: "No approved organization found for this account" });
  }

  const tagIds = Array.from(new Set((req.body.tag_ids || []).map((tagId) => Number(tagId))));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: [created] } = await client.query(
      `INSERT INTO opportunity (
        organization_id, posted_by, category_id, title, description, type, location,
        is_remote, application_mode, external_url, compensation, capacity,
        application_deadline, starts_at, published_at, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, NULL, 'draft'
      )
      RETURNING id`,
      [
        organizationId,
        req.session.user.id,
        toInt(req.body.category_id),
        normalizeText(req.body.title),
        normalizeText(req.body.description),
        normalizeText(req.body.type),
        normalizeText(req.body.location),
        req.body.is_remote === true || req.body.is_remote === "true" || req.body.is_remote === "1",
        normalizeText(req.body.application_mode),
        normalizeText(req.body.external_url),
        normalizeText(req.body.compensation),
        toInt(req.body.capacity),
        normalizeTimestamp(req.body.application_deadline),
        normalizeTimestamp(req.body.starts_at),
      ]
    );

    await upsertOpportunityTags(client, created.id, tagIds);

    await client.query("COMMIT");
    res.status(201).json({ message: "Opportunity created", opportunityId: created.id, status: "draft" });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity creation failed");
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

// /api/opportunities/:id PUT method
router.put("/opportunities/:id", requireOrganizer, catchAsync(async (req, res) => {
  const validationErrors = validateOpportunity(req.body, { partial: true });
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors[0] });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const opportunity = await findOwnedOpportunity(req.params.id, req.session.user.id, client, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    if (opportunity.status !== "draft") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only draft opportunities can be edited" });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(req.body, "category_id")) {
      updates.push(`category_id = $${idx}`);
      values.push(toInt(req.body.category_id));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
      updates.push(`title = $${idx}`);
      values.push(normalizeText(req.body.title));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      updates.push(`description = $${idx}`);
      values.push(normalizeText(req.body.description));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "type")) {
      updates.push(`type = $${idx}`);
      values.push(normalizeText(req.body.type));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "location")) {
      updates.push(`location = $${idx}`);
      values.push(normalizeText(req.body.location));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "is_remote")) {
      updates.push(`is_remote = $${idx}`);
      values.push(req.body.is_remote === true || req.body.is_remote === "true" || req.body.is_remote === "1");
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "application_mode")) {
      updates.push(`application_mode = $${idx}`);
      values.push(normalizeText(req.body.application_mode));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "external_url")) {
      updates.push(`external_url = $${idx}`);
      values.push(normalizeText(req.body.external_url));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "compensation")) {
      updates.push(`compensation = $${idx}`);
      values.push(normalizeText(req.body.compensation));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "capacity")) {
      updates.push(`capacity = $${idx}`);
      values.push(toInt(req.body.capacity));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "application_deadline")) {
      updates.push(`application_deadline = $${idx}`);
      values.push(normalizeTimestamp(req.body.application_deadline));
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "starts_at")) {
      updates.push(`starts_at = $${idx}`);
      values.push(normalizeTimestamp(req.body.starts_at));
      idx += 1;
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await client.query(
        `UPDATE opportunity SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "tag_ids")) {
      if (!Array.isArray(req.body.tag_ids)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Tag ids must be an array" });
      }

      const tagIds = Array.from(new Set(req.body.tag_ids.map((tagId) => Number(tagId))));
      const invalidTag = tagIds.find((tagId) => !Number.isInteger(tagId) || tagId < 1);
      if (invalidTag != null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Tag ids must contain only positive integers" });
      }

      const placeholders = placeHolders(tagIds.length);
      const { rows: existingTags } = await client.query(
        `SELECT id FROM tag WHERE id IN (${placeholders.join(", ")})`,
        tagIds
      );
      if (existingTags.length !== tagIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "One or more tags were not found" });
      }

      await client.query("DELETE FROM opportunity_tag WHERE opportunity_id = $1", [req.params.id]);
      await upsertOpportunityTags(client, Number(req.params.id), tagIds);
    }

    await client.query("COMMIT");
    res.json({ message: "Opportunity updated" });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity update failed");
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

async function mutateOpportunityStatus(req, res, nextStatus) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const opportunity = await findOwnedOpportunity(req.params.id, req.session.user.id, client, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    assertTransition(OPPORTUNITY_TRANSITIONS, opportunity.status, nextStatus);

    await client.query(
      "UPDATE opportunity SET status = $1 WHERE id = $2",
      [nextStatus, req.params.id]
    );

    await client.query("COMMIT");
    return res.json({ message: `Opportunity ${nextStatus}` });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error({ err: error }, "Opportunity status mutation failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

// /api/opportunities/:id/submit POST method
router.post("/opportunities/:id/submit", requireOrganizer, catchAsync(async (req, res) => {
  return mutateOpportunityStatus(req, res, "submitted");
}));

// /api/opportunities/:id/close POST method
router.post("/opportunities/:id/close", requireOrganizer, catchAsync(async (req, res) => {
  return mutateOpportunityStatus(req, res, "closed");
}));

// /api/opportunities/:id/archive POST method
router.post("/opportunities/:id/archive", requireOrganizer, catchAsync(async (req, res) => {
  return mutateOpportunityStatus(req, res, "archived");
}));

module.exports = router;


