const express = require("express");
const pool = require("../db");
const { validateEvent, validateFieldLength, isValidEmail } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const { emit } = require("../lib/opportunity/notifications");
const {
  getOwnedOrganizationId,
  getOpportunityOwnerUserId,
  getOpportunityTags,
  parseId,
  resolveTagIds,
  toIso,
} = require("../lib/opportunity/shared");

const router = express.Router();

const requireOrganizer = requireRole("organizer");

const OPPORTUNITY_PUBLIC_STATUSES = ["submitted", "published", "closed"];
const OPPORTUNITY_EDITABLE_STATUSES = ["draft"];
const OPPORTUNITY_CLOSEABLE_STATUSES = ["draft", "submitted", "published"];

function toDbTimestamp(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.replace("T", " ");
}

function serializeOpportunity(row, tags = []) {
  const deadline = row.application_deadline || row.deadline;

  return {
    id: row.id,
    title: row.title,
    summary: row.summary || "",
    description: row.description || "",
    location: row.location || "",
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
    starts_at: toIso(row.start_date),
    ends_at: toIso(row.end_date),
    capacity: row.capacity,
    compensation: row.compensation || "",
    contact_email: row.contact_email || "",
    apply_url: row.apply_url || "",
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_website: row.organization_website,
    tags,
  };
}

function validateOpportunityPayload(body, { requireAll = false } = {}) {
  const errors = [];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const applicationDeadline = typeof body.application_deadline === "string" ? body.application_deadline.trim() : "";
  const startDate = typeof body.start_date === "string" ? body.start_date.trim() : "";
  const endDate = typeof body.end_date === "string" ? body.end_date.trim() : "";
  const compensation = typeof body.compensation === "string" ? body.compensation.trim() : "";
  const contactEmail = typeof body.contact_email === "string" ? body.contact_email.trim() : "";
  const applyUrl = typeof body.apply_url === "string" ? body.apply_url.trim() : "";
  const capacity = body.capacity;

  const required = (value, label, max = 255) => {
    const error = validateFieldLength(value, label, max, true);
    if (error) errors.push(error);
  };

  if (requireAll) {
    required(title, "Title", 255);
    required(description, "Description", 5000);
    required(location, "Location", 255);
    required(applicationDeadline, "Application deadline", 40);
    required(startDate, "Start date", 40);
    required(endDate, "End date", 40);
  } else {
    if (body.title != null) required(title, "Title", 255);
    if (body.description != null) required(description, "Description", 5000);
    if (body.location != null) required(location, "Location", 255);
    if (body.application_deadline != null) required(applicationDeadline, "Application deadline", 40);
    if (body.start_date != null) required(startDate, "Start date", 40);
    if (body.end_date != null) required(endDate, "End date", 40);
  }

  if (summary && summary.length > 180) errors.push("Summary must be 180 characters or fewer");
  if (compensation && compensation.length > 255) errors.push("Compensation must be 255 characters or fewer");
  if (contactEmail && !isValidEmail(contactEmail)) errors.push("Invalid email format");
  if (applyUrl && !/^https?:\/\//i.test(applyUrl)) errors.push("Application link must start with http:// or https://");

  const parsedApplicationDeadline = applicationDeadline ? new Date(applicationDeadline) : null;
  const parsedStartDate = startDate ? new Date(startDate) : null;
  const parsedEndDate = endDate ? new Date(endDate) : null;

  if (applicationDeadline && Number.isNaN(parsedApplicationDeadline.getTime())) {
    errors.push("Application deadline is invalid");
  }
  if (startDate && Number.isNaN(parsedStartDate.getTime())) {
    errors.push("Start date is invalid");
  }
  if (endDate && Number.isNaN(parsedEndDate.getTime())) {
    errors.push("End date is invalid");
  }

  if (capacity != null && capacity !== "") {
    const parsedCapacity = Number(capacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      errors.push("Capacity must be at least 1");
    }
  }

  if (parsedApplicationDeadline && parsedStartDate && !Number.isNaN(parsedApplicationDeadline.getTime()) && !Number.isNaN(parsedStartDate.getTime()) && parsedApplicationDeadline > parsedStartDate) {
    errors.push("Start date must be after the application deadline");
  }

  if (parsedStartDate && parsedEndDate && !Number.isNaN(parsedStartDate.getTime()) && !Number.isNaN(parsedEndDate.getTime()) && parsedStartDate > parsedEndDate) {
    errors.push("End date must be after the start date");
  }

  return errors;
}

async function getOwnedOpportunity(client, opportunityId, userId, lockForUpdate = false) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE o.id = $1 AND op.user_id = $2
     ${lockForUpdate ? "FOR UPDATE" : ""}`,
    [opportunityId, userId]
  );

  return rows[0] || null;
}

async function upsertOpportunityTags(client, opportunityId, tagValues) {
  const db = client || pool;
  await db.query("DELETE FROM opportunity_tag WHERE opportunity_id = $1", [opportunityId]);

  const tagIds = await resolveTagIds(db, tagValues);
  for (const tagId of tagIds) {
    await db.query(
      "INSERT INTO opportunity_tag (opportunity_id, tag_id) VALUES ($1, $2)",
      [opportunityId, tagId]
    );
  }

  return tagIds;
}

async function loadOpportunityApplicants(client, opportunityId, userId) {
  const db = client || pool;
  const opportunity = await getOwnedOpportunity(db, opportunityId, userId);
  if (!opportunity) {
    return null;
  }

  const { rows } = await db.query(
    `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at,
            a.applicant_user_id,
            u.first_name, u.last_name, u.email
     FROM application a
     JOIN "user" u ON u.id = a.applicant_user_id
     WHERE a.opportunity_id = $1
     ORDER BY a.created_at ASC, a.id ASC`,
    [opportunityId]
  );

  const historyRows = rows.length
    ? await db.query(
        `SELECT id, application_id, action, from_status, to_status, actor_user_id, note, created_at
         FROM application_history
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC`,
        [rows.map((row) => row.id)]
      )
    : { rows: [] };

  const historyByApplication = new Map();
  for (const row of historyRows.rows) {
    if (!historyByApplication.has(row.application_id)) {
      historyByApplication.set(row.application_id, []);
    }
    historyByApplication.get(row.application_id).push({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      status: row.to_status,
      actor_user_id: row.actor_user_id,
      note: row.note || "",
      created_at: toIso(row.created_at),
      at: toIso(row.created_at),
    });
  }

  return {
    opportunity,
    applicants: rows.map((row) => ({
      id: row.id,
      status: row.status,
      cover_note: row.cover_note,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      applied_at: toIso(row.created_at),
      name: `${row.first_name} ${row.last_name}`,
      full_name: `${row.first_name} ${row.last_name}`,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      history: historyByApplication.get(row.id) || [],
    })),
  };
}


// /api/organizer/events GET method
router.get("/events", requireOrganizer, catchAsync(async (req, res) => {

    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.description, e.location,
            e.start_datetime, e.end_datetime, e.capacity,
            e.registration_type, e.external_url, e.status, e.created_at
            FROM event e
            JOIN organizer_profile op ON op.organization_id = e.organization_id
            WHERE op.user_id = $1
            ORDER BY e.start_datetime DESC`,
            [req.session.user.id]
    );

    res.json({events});
}));

// /api/organizer/events POST method
router.post("/events", requireOrganizer, catchAsync(async (req, res) => {

    const { title, description, location, start_datetime, end_datetime,
            registration_type, capacity, external_url, tag_ids, target_faculty_ids, } = req.body;

    if (!title || !location || !start_datetime || !end_datetime) {
        return res.status(400).json({error: "Title, location, start and end datetime are required"});
    }

    const validationErrors = validateEvent(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({error: validationErrors[0]});
    }

    if (!Array.isArray(tag_ids) || tag_ids.length === 0) {
        return res.status(400).json({error: "Select at least one tag"});
    }
    if (!Array.isArray(target_faculty_ids) || target_faculty_ids.length === 0) {
        return res.status(400).json({error: "Select at least one target faculty"});
    }

    const regType = ["built_in", "external", "none"].includes(registration_type)
        ? registration_type
        : "built_in";

    if (regType === "external" && !external_url) {
        return res.status(400).json({error: "An external registration link is required"});
    }

    const { rows: orgs } = await pool.query(
        `SELECT o.id FROM organization o
        JOIN organizer_profile op ON op.organization_id = o.id
        WHERE op.user_id = $1 AND o.status = 'approved'`,
        [req.session.user.id]
    );

    if (orgs.length === 0) {
        return res.status(403).json({ error: "No approved organization found for this account"});
    }

    const organizationId = orgs[0].id;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { rows: [event] } = await client.query(
            `INSERT INTO event
                (organization_id, title, description, location,
                start_datetime, end_datetime, capacity, registration_type, external_url, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
                RETURNING id`,
                [
                    organizationId, title,
                    description || null,
                    location,
                    start_datetime.replace("T", " "),
                    end_datetime.replace("T", " "),
                    regType === "built_in" ? (capacity || null) : null,
                    regType,
                    regType === "external" ? external_url : null,
                ]
        );

        const eventId = event.id;

        for (const tagId of tag_ids) {
            await client.query(
                "INSERT INTO event_tag (event_id, tag_id) VALUES ($1, $2)",
                [eventId, tagId]
            );
        }

        for (const facultyId of target_faculty_ids) {
            await client.query(
                "INSERT INTO event_target (event_id, faculty_id) VALUES ($1, $2)",
                [eventId, facultyId]
            );
        }

        await client.query("COMMIT");
        res.status(201).json({ message: "Event created", eventId});
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ err: error }, "Event creation failed");
        res.status(500).json({error: "Internal server error"});
    } finally {
        client.release();
    }
}));

// /api/organizer/events/:id POST method
router.post("/events/:id/submit", requireOrganizer, catchAsync(async (req, res) => {

    const eventId = req.params.id;

    const { rows } = await pool.query(
        `SELECT e.id, e.status FROM event e
        JOIN organizer_profile op ON op.organization_id = e.organization_id
        WHERE e.id = $1 AND op.user_id = $2`,
        [eventId, req.session.user.id]
    );
    if (rows.length === 0) {
        return res.status(404).json({error: "Event not found"});
    }
    if (rows[0].status !== "draft") {
        return res.status(400).json({error: " Only draft events can be submitted"});
    }

    await pool.query("UPDATE event SET status = 'submitted' WHERE id = $1", [eventId]);

    res.json({message: "Event submitted for approval"});
}));

router.get("/opportunities", requireOrganizer, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.summary, o.description, o.location,
            o.status, o.deadline, o.application_deadline, o.start_date, o.end_date,
            o.capacity, o.compensation, o.contact_email, o.apply_url,
            o.created_at, o.updated_at, o.published_at, o.closed_at, o.archived_at,
            org.name AS organization_name, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE op.user_id = $1
     ORDER BY o.updated_at DESC, o.created_at DESC, o.id DESC`,
    [req.session.user.id]
  );

  const tagsByOpportunity = await getOpportunityTags(pool, rows.map((row) => row.id));
  const opportunities = rows.map((row) => serializeOpportunity(row, tagsByOpportunity.get(row.id) || []));

  res.json({ opportunities, items: opportunities });
}));

router.post("/opportunities", requireOrganizer, catchAsync(async (req, res) => {
  const errors = validateOpportunityPayload(req.body, { requireAll: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  const organizationId = await getOwnedOrganizationId(pool, req.session.user.id);
  if (!organizationId) {
    return res.status(403).json({ error: "No approved organization found for this account" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const title = req.body.title.trim();
    const summary = typeof req.body.summary === "string" ? req.body.summary.trim() : "";
    const description = req.body.description.trim();
    const location = req.body.location.trim();
    const applicationDeadline = toDbTimestamp(req.body.application_deadline.trim());
    const startDate = toDbTimestamp(req.body.start_date.trim());
    const endDate = toDbTimestamp(req.body.end_date.trim());
    const compensation = typeof req.body.compensation === "string" ? req.body.compensation.trim() : null;
    const contactEmail = typeof req.body.contact_email === "string" ? req.body.contact_email.trim() : null;
    const applyUrl = typeof req.body.apply_url === "string" ? req.body.apply_url.trim() : null;
    const capacity = req.body.capacity === "" || req.body.capacity == null ? null : Number(req.body.capacity);

    const { rows: insertedRows } = await client.query(
      `INSERT INTO opportunity
       (organization_id, title, summary, description, location, status, deadline,
        application_deadline, start_date, end_date, capacity, compensation, contact_email,
        apply_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING id`,
      [
        organizationId,
        title,
        summary || null,
        description,
        location,
        applicationDeadline,
        startDate,
        endDate,
        capacity,
        compensation || null,
        contactEmail || null,
        applyUrl || null,
      ]
    );

    const opportunityId = insertedRows[0].id;
    await upsertOpportunityTags(client, opportunityId, Array.isArray(req.body.tags) ? req.body.tags : []);

    await client.query("COMMIT");

    const opportunity = await getOwnedOpportunity(pool, opportunityId, req.session.user.id);
    const tagsByOpportunity = await getOpportunityTags(pool, [opportunityId]);
    res.status(201).json({
      message: "Opportunity created",
      opportunity: serializeOpportunity(opportunity, tagsByOpportunity.get(opportunityId) || []),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity creation failed");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

router.get("/opportunities/:id", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await getOwnedOpportunity(pool, opportunityId, req.session.user.id);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const tagsByOpportunity = await getOpportunityTags(pool, [opportunityId]);
  res.json({ opportunity: serializeOpportunity(opportunity, tagsByOpportunity.get(opportunityId) || []) });
}));

router.patch("/opportunities/:id", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const errors = validateOpportunityPayload(req.body, { requireAll: false });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await getOwnedOpportunity(client, opportunityId, req.session.user.id, true);
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    if (!OPPORTUNITY_EDITABLE_STATUSES.includes(current.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only draft opportunities can be edited" });
    }

    const title = req.body.title != null ? req.body.title.trim() : current.title;
    const summary = req.body.summary != null ? req.body.summary.trim() : current.summary;
    const description = req.body.description != null ? req.body.description.trim() : current.description;
    const location = req.body.location != null ? req.body.location.trim() : current.location;
    const applicationDeadline = req.body.application_deadline != null
      ? toDbTimestamp(req.body.application_deadline.trim())
      : current.application_deadline ? current.application_deadline : current.deadline;
    const startDate = req.body.start_date != null
      ? toDbTimestamp(req.body.start_date.trim())
      : current.start_date;
    const endDate = req.body.end_date != null
      ? toDbTimestamp(req.body.end_date.trim())
      : current.end_date;
    const capacity = req.body.capacity != null && req.body.capacity !== ""
      ? Number(req.body.capacity)
      : current.capacity;
    const compensation = req.body.compensation != null ? req.body.compensation.trim() : current.compensation;
    const contactEmail = req.body.contact_email != null ? req.body.contact_email.trim() : current.contact_email;
    const applyUrl = req.body.apply_url != null ? req.body.apply_url.trim() : current.apply_url;

    await client.query(
      `UPDATE opportunity
       SET title = $1,
           summary = $2,
           description = $3,
           location = $4,
           deadline = $5,
           application_deadline = $5,
           start_date = $6,
           end_date = $7,
           capacity = $8,
           compensation = $9,
           contact_email = $10,
           apply_url = $11,
           updated_at = NOW()
       WHERE id = $12`,
      [
        title,
        summary || null,
        description,
        location,
        applicationDeadline,
        startDate,
        endDate,
        capacity == null || Number.isNaN(capacity) ? null : capacity,
        compensation || null,
        contactEmail || null,
        applyUrl || null,
        opportunityId,
      ]
    );

    await upsertOpportunityTags(client, opportunityId, Array.isArray(req.body.tags) ? req.body.tags : []);

    await client.query("COMMIT");

    const opportunity = await getOwnedOpportunity(pool, opportunityId, req.session.user.id);
    const tagsByOpportunity = await getOpportunityTags(pool, [opportunityId]);
    res.json({
      message: "Opportunity updated",
      opportunity: serializeOpportunity(opportunity, tagsByOpportunity.get(opportunityId) || []),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity update failed");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

async function runOpportunityLifecycleAction(req, res, nextStatus, fieldName) {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await getOwnedOpportunity(client, opportunityId, req.session.user.id, true);
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    if (current.status === "archived") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Archived opportunities cannot be changed" });
    }

    if (fieldName === "submitted" && current.status !== "draft") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only draft opportunities can be submitted" });
    }

    if (fieldName === "closed" && !OPPORTUNITY_CLOSEABLE_STATUSES.includes(current.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Opportunity cannot be closed in its current state" });
    }

    const { rowCount } = await client.query(
      `UPDATE opportunity
       SET status = $1::character varying(50),
           published_at = CASE WHEN $1::character varying(50) IN ('submitted', 'published') AND published_at IS NULL THEN NOW() ELSE published_at END,
           closed_at = CASE WHEN $1::character varying(50) = 'closed' THEN NOW() ELSE closed_at END,
           archived_at = CASE WHEN $1::character varying(50) = 'archived' THEN NOW() ELSE archived_at END,
           updated_at = NOW()
       WHERE id = $2
         AND status = $3::character varying(50)`,
      [nextStatus, opportunityId, current.status]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Opportunity status has changed" });
    }

    await client.query("COMMIT");
    return res.json({ message: `Opportunity ${fieldName}`, status: nextStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Opportunity lifecycle action failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

router.post("/opportunities/:id/submit", requireOrganizer, (req, res, next) =>
  runOpportunityLifecycleAction(req, res, "submitted", "submitted").catch(next)
);

router.post("/opportunities/:id/close", requireOrganizer, (req, res, next) =>
  runOpportunityLifecycleAction(req, res, "closed", "closed").catch(next)
);

router.post("/opportunities/:id/archive", requireOrganizer, (req, res, next) =>
  runOpportunityLifecycleAction(req, res, "archived", "archived").catch(next)
);

router.get("/opportunities/:id/applicants", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const result = await loadOpportunityApplicants(pool, opportunityId, req.session.user.id);
  if (!result) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  res.json({
    opportunity: serializeOpportunity(result.opportunity, (await getOpportunityTags(pool, [opportunityId])).get(opportunityId) || []),
    applicants: result.applicants,
    items: result.applicants,
  });
}));

router.post("/opportunities/:id/applicants/:applicantId/transition", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  const applicationId = parseId(req.params.applicantId);
  if (!opportunityId || !applicationId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const nextStatus = normalizeStatus(req.body.status || req.body.next_status || req.body.to);
  const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null;
  if (!nextStatus) {
    return res.status(400).json({ error: "Transition status is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const opportunity = await getOwnedOpportunity(client, opportunityId, req.session.user.id, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const { rows } = await client.query(
      `SELECT a.id, a.status, a.opportunity_id, a.applicant_user_id, a.created_at, a.updated_at,
              u.first_name, u.last_name, u.email
       FROM application a
       JOIN "user" u ON u.id = a.applicant_user_id
       WHERE a.id = $1 AND a.opportunity_id = $2
       FOR UPDATE`,
      [applicationId, opportunityId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Applicant not found" });
    }

    const application = rows[0];
    if (application.status === nextStatus) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    let transition;
    try {
      transition = assertTransition(application.status, nextStatus, "organizer");
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    const { rowCount } = await client.query(
      `UPDATE application
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status = $3`,
      [transition.to, applicationId, transition.from]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [applicationId, "status_transition", transition.from, transition.to, req.session.user.id, note]
    );

    await emit(application.applicant_user_id, "application.status_changed", {
      applicationId,
      opportunityId,
      fromStatus: transition.from,
      toStatus: transition.to,
      actorUserId: req.session.user.id,
      actorRole: "organizer",
    }, client);

    await client.query("COMMIT");
    return res.json({
      message: "Applicant status updated",
      applicationId,
      status: transition.to,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Applicant transition failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}));

router.get("/opportunities/:id/analytics", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const opportunity = await getOwnedOpportunity(pool, opportunityId, req.session.user.id);
  if (!opportunity) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows: applicationRows } = await pool.query(
    `SELECT id, status, created_at
     FROM application
     WHERE opportunity_id = $1
     ORDER BY created_at ASC, id ASC`,
    [opportunityId]
  );

  const { rows: historyRows } = await pool.query(
    `SELECT action, to_status, created_at
     FROM application_history
     WHERE application_id IN (
       SELECT id FROM application WHERE opportunity_id = $1
     )
     ORDER BY created_at ASC, id ASC`,
    [opportunityId]
  );

  const applications = applicationRows.length;
  const reviews = applicationRows.filter((row) => ["under_review", "shortlisted"].includes(row.status)).length;
  const accepts = applicationRows.filter((row) => row.status === "accepted").length;
  const rejects = applicationRows.filter((row) => row.status === "rejected").length;
  const visits = Math.max(0, historyRows.length - applications);
  const views = 0;
  const conversion = applications > 0 ? accepts / applications : 0;

  const dayCounts = new Map();
  for (const row of historyRows) {
    const day = toIso(row.created_at).slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  res.json({
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      summary: opportunity.summary || "",
      description: opportunity.description || "",
      status: opportunity.status,
    },
    summary: {
      views,
      visits,
      applications,
      reviews,
      accepts,
      rejects,
      conversion,
    },
    funnel: [
      { stage: "views", count: views },
      { stage: "visits", count: visits },
      { stage: "applications", count: applications },
      { stage: "reviews", count: reviews },
      { stage: "accepts", count: accepts },
      { stage: "rejects", count: rejects },
    ],
    timeseries: [...dayCounts.entries()].map(([date, count]) => ({ date, count })),
  });
}));


module.exports = router;
