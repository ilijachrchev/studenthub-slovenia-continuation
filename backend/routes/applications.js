const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const { emit } = require("../lib/opportunity/notifications");

const router = express.Router();

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

async function getOpportunityForApplicant(client, opportunityId, userId) {
  const { rows } = await client.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND o.deadline > NOW()`,
    [opportunityId]
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

router.post("/:id/apply", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
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

    const opportunity = await getOpportunityForApplicant(client, opportunityId, req.session.user.id);
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

    throw error;
  } finally {
    client.release();
  }
}));

router.get("/mine", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id AS application_id, a.status, a.cover_note, a.created_at, a.updated_at,
            o.id AS opportunity_id, o.title AS opportunity_title, o.description AS opportunity_description,
            o.location AS opportunity_location, o.status AS opportunity_status, o.deadline AS opportunity_deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC`,
    [req.session.user.id]
  );

  const items = rows.map((row) => ({
    id: row.application_id,
    status: row.status,
    cover_note: row.cover_note,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
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

router.get("/opportunities/:id/applications", requireAuth, requireRole("organizer"), catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows: ownerRows } = await pool.query(
    `SELECT o.id, o.title, o.status, org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id
     WHERE o.id = $1 AND op.user_id = $2 AND op.role_in_org = 'owner'`,
    [opportunityId, req.session.user.id]
  );

  if (ownerRows.length === 0) {
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
    opportunity: ownerRows[0],
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

    const { rows } = await client.query(
      `SELECT a.id, a.status, a.opportunity_id, a.applicant_user_id,
              o.organization_id
       FROM application a
       JOIN opportunity o ON o.id = a.opportunity_id
       WHERE a.id = $1
       FOR UPDATE`,
      [applicationId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const application = rows[0];
    const role = req.session.user.role;

    const ownerUserId = await getOpportunityOwner(client, application.opportunity_id);
    const isOwner = ownerUserId === req.session.user.id;
    const isApplicant = application.applicant_user_id === req.session.user.id;

    if (role === "organizer" && !isOwner) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    if (role === "student" && !isApplicant) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    try {
      assertTransition(from, to, role);
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    if (application.status !== from) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    const { rowCount } = await client.query(
      "UPDATE application SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3",
      [to, applicationId, from]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [applicationId, "status_transition", from, to, req.session.user.id]
    );

    const recipientUserId = role === "student" ? ownerUserId : application.applicant_user_id;
    if (recipientUserId) {
      await emit(recipientUserId, "application.status_changed", {
        applicationId,
        opportunityId: application.opportunity_id,
        fromStatus: from,
        toStatus: to,
        actorUserId: req.session.user.id,
        actorRole: role,
      }, client);
    }

    await client.query("COMMIT");
    return res.json({
      message: "Application status updated",
      applicationId,
      status: to,
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

  const { rows } = await pool.query(
    `SELECT a.id, a.opportunity_id, a.applicant_user_id,
            o.organization_id
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     WHERE a.id = $1`,
    [applicationId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Application not found" });
  }

  const application = rows[0];
  const ownerUserId = await pool.query(
    `SELECT op.user_id
     FROM organizer_profile op
     WHERE op.organization_id = $1 AND op.role_in_org = 'owner'
     ORDER BY op.user_id ASC
     LIMIT 1`,
    [application.organization_id]
  );

  const isApplicant = application.applicant_user_id === req.session.user.id;
  const isOwner = ownerUserId.rows[0] && ownerUserId.rows[0].user_id === req.session.user.id;

  if (!isApplicant && !isOwner) {
    return res.status(404).json({ error: "Application not found" });
  }

  const { rows: historyRows } = await pool.query(
    `SELECT id, application_id, action, from_status, to_status, actor_user_id, created_at
     FROM application_history
     WHERE application_id = $1
     ORDER BY created_at ASC, id ASC`,
    [applicationId]
  );

  res.json({
    applicationId,
    history: historyRows.map((row) => ({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      created_at: toIso(row.created_at),
    })),
  });
}));

module.exports = router;


