const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const { emit } = require("../lib/opportunity/notifications");
const {
  getOpportunityOwnerUserId,
  parseId,
  toIso,
} = require("../lib/opportunity/shared");

const router = express.Router();

const VISIBLE_OPPORTUNITY_STATUSES = ["submitted", "published"];

function serializeHistory(rows) {
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    status: row.to_status,
    from_status: row.from_status,
    to_status: row.to_status,
    actor_user_id: row.actor_user_id,
    note: row.note || "",
    at: toIso(row.created_at),
    created_at: toIso(row.created_at),
  }));
}

function serializeApplication(row, history = []) {
  return {
    id: row.id,
    status: row.status,
    cover_note: row.cover_note,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    opportunity_id: row.opportunity_id,
    opportunityId: row.opportunity_id,
    title: row.opportunity_title,
    organization_name: row.organization_name,
    organizationName: row.organization_name,
    deadline: toIso(row.opportunity_deadline),
    history,
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
  };
}

async function loadApplicationForUser(client, applicationId, userId, lockForUpdate = false) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT a.id, a.opportunity_id, a.applicant_user_id, a.cover_note, a.status,
            a.created_at, a.updated_at,
            o.title AS opportunity_title, o.description AS opportunity_description,
            o.location AS opportunity_location, o.status AS opportunity_status,
            COALESCE(o.application_deadline, o.deadline) AS opportunity_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.id = $1
     ${lockForUpdate ? "FOR UPDATE" : ""}`,
    [applicationId]
  );

  if (rows.length === 0) {
    return null;
  }

  const application = rows[0];
  const ownerUserId = await getOpportunityOwnerUserId(db, application.opportunity_id);
  const isOwner = ownerUserId && ownerUserId === userId;
  const isApplicant = application.applicant_user_id === userId;

  return {
    application,
    ownerUserId,
    isOwner,
    isApplicant,
  };
}

async function loadApplicationHistory(client, applicationIds) {
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return new Map();
  }

  const db = client || pool;
  const { rows } = await db.query(
    `SELECT id, application_id, action, from_status, to_status, actor_user_id, note, created_at
     FROM application_history
     WHERE application_id = ANY($1::int[])
     ORDER BY created_at ASC, id ASC`,
    [applicationIds]
  );

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.application_id)) {
      grouped.set(row.application_id, []);
    }
    grouped.get(row.application_id).push({
      id: row.id,
      action: row.action,
      status: row.to_status,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      note: row.note || "",
      at: toIso(row.created_at),
      created_at: toIso(row.created_at),
    });
  }

  return grouped;
}

async function insertHistory(client, applicationId, action, fromStatus, toStatus, actorUserId, note = null) {
  const db = client || pool;
  await db.query(
    `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [applicationId, action, fromStatus, toStatus, actorUserId, note]
  );
}

async function loadVisibleOpportunity(client, opportunityId) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT o.id, o.title, o.description, o.location, o.status,
            COALESCE(o.application_deadline, o.deadline) AS application_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1
       AND o.status = ANY($2::text[])`,
    [opportunityId, VISIBLE_OPPORTUNITY_STATUSES]
  );

  return rows[0] || null;
}

router.get("/applications", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.opportunity_id, a.cover_note, a.status, a.created_at, a.updated_at,
            o.title AS opportunity_title, o.description AS opportunity_description,
            o.location AS opportunity_location, o.status AS opportunity_status,
            COALESCE(o.application_deadline, o.deadline) AS opportunity_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user.id]
  );

  const historyByApplication = await loadApplicationHistory(pool, rows.map((row) => row.id));
  const applications = rows.map((row) =>
    serializeApplication(row, historyByApplication.get(row.id) || [])
  );

  res.json({ applications, items: applications });
}));

router.get("/mine", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.opportunity_id, a.cover_note, a.status, a.created_at, a.updated_at,
            o.title AS opportunity_title, o.description AS opportunity_description,
            o.location AS opportunity_location, o.status AS opportunity_status,
            COALESCE(o.application_deadline, o.deadline) AS opportunity_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [req.session.user.id]
  );

  const historyByApplication = await loadApplicationHistory(pool, rows.map((row) => row.id));
  const applications = rows.map((row) =>
    serializeApplication(row, historyByApplication.get(row.id) || [])
  );

  res.json({ applications, items: applications });
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

    const { rows: opportunityRows } = await client.query(
      `SELECT o.id, o.title, o.status, COALESCE(o.application_deadline, o.deadline) AS application_deadline
       FROM opportunity o
       WHERE o.id = $1
       FOR UPDATE`,
      [opportunityId]
    );

    const opportunity = opportunityRows[0];
    if (!opportunity || !VISIBLE_OPPORTUNITY_STATUSES.includes(opportunity.status)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    if (opportunity.application_deadline && new Date(opportunity.application_deadline) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "The application deadline has passed" });
    }

    const { rows: existingRows } = await client.query(
      "SELECT id FROM application WHERE opportunity_id = $1 AND applicant_user_id = $2",
      [opportunityId, req.session.user.id]
    );

    if (existingRows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "You have already applied for this opportunity" });
    }

    const { rows: insertedRows } = await client.query(
      `INSERT INTO application (opportunity_id, applicant_user_id, cover_note, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, opportunity_id, applicant_user_id, cover_note, status, created_at, updated_at`,
      [opportunityId, req.session.user.id, coverNote]
    );

    const application = insertedRows[0];
    await insertHistory(
      client,
      application.id,
      "application_created",
      null,
      "pending",
      req.session.user.id,
      coverNote
    );

    const ownerUserId = await getOpportunityOwnerUserId(client, opportunityId);
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
      application: {
        id: application.id,
        status: application.status,
        cover_note: application.cover_note,
        created_at: toIso(application.created_at),
        updated_at: toIso(application.updated_at),
      },
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
    return res.status(404).json({ error: "Application not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT a.id, a.opportunity_id, a.applicant_user_id, a.status, a.created_at, a.updated_at
       FROM application a
       WHERE a.opportunity_id = $1 AND a.applicant_user_id = $2
       FOR UPDATE`,
      [opportunityId, req.session.user.id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const application = rows[0];
    const ownerUserId = await getOpportunityOwnerUserId(client, opportunityId);
    let transition;
    try {
      transition = assertTransition(application.status, "withdrawn", "student");
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    const { rowCount } = await client.query(
      `UPDATE application
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status = $3`,
      [transition.to, application.id, transition.from]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await insertHistory(
      client,
      application.id,
      "status_transition",
      transition.from,
      transition.to,
      req.session.user.id
    );

    if (ownerUserId) {
      await emit(ownerUserId, "application.status_changed", {
        applicationId: application.id,
        opportunityId: application.opportunity_id,
        fromStatus: transition.from,
        toStatus: transition.to,
        actorUserId: req.session.user.id,
        actorRole: "student",
      }, client);
    }

    await client.query("COMMIT");
    return res.json({
      message: "Application withdrawn",
      applicationId: application.id,
      status: transition.to,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/:id/transition", requireAuth, catchAsync(async (req, res) => {
  const applicationId = parseId(req.params.id);
  if (!applicationId) {
    return res.status(404).json({ error: "Application not found" });
  }

  const from = normalizeStatus(req.body.from_status || req.body.from || req.body.current_status);
  const to = normalizeStatus(req.body.to_status || req.body.to || req.body.next_status);

  if (!from || !to) {
    return res.status(400).json({ error: "Both from and to statuses are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lookup = await loadApplicationForUser(client, applicationId, req.session.user.id, true);
    if (!lookup) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const { application, ownerUserId, isOwner, isApplicant } = lookup;
    const role = req.session.user.role;

    if (role === "organizer" && !isOwner) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    if (role === "student" && !isApplicant) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    if (role !== "organizer" && role !== "student" && role !== "admin") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unsupported role for application transitions" });
    }

    let transition;
    try {
      transition = assertTransition(from, to, role);
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    if (application.status !== transition.from) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
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

    const note = typeof req.body.note === "string" && req.body.note.trim()
      ? req.body.note.trim()
      : null;

    await insertHistory(
      client,
      applicationId,
      "status_transition",
      transition.from,
      transition.to,
      req.session.user.id,
      note
    );

    const recipientUserId = role === "student" ? ownerUserId : application.applicant_user_id;
    if (recipientUserId) {
      await emit(recipientUserId, "application.status_changed", {
        applicationId,
        opportunityId: application.opportunity_id,
        fromStatus: transition.from,
        toStatus: transition.to,
        actorUserId: req.session.user.id,
        actorRole: role,
      }, client);
    }

    await client.query("COMMIT");
    return res.json({
      message: "Application status updated",
      applicationId,
      status: transition.to,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/:id/history", requireAuth, catchAsync(async (req, res) => {
  const applicationId = parseId(req.params.id);
  if (!applicationId) {
    return res.status(404).json({ error: "Application not found" });
  }

  const lookup = await loadApplicationForUser(pool, applicationId, req.session.user.id);
  if (!lookup || (!lookup.isApplicant && !lookup.isOwner && req.session.user.role !== "admin")) {
    return res.status(404).json({ error: "Application not found" });
  }

  const { rows } = await pool.query(
    `SELECT id, application_id, action, from_status, to_status, actor_user_id, note, created_at
     FROM application_history
     WHERE application_id = $1
     ORDER BY created_at ASC, id ASC`,
    [applicationId]
  );

  res.json({
    applicationId,
    history: serializeHistory(rows),
  });
}));

module.exports = router;
