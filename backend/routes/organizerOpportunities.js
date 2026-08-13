const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireRole } = require("../middleware/auth");
const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");
const { emitApplicationStatusChanged, getOpportunityOwner, loadApplicationAccess, toIso } = require("../lib/opportunity/lifecycle");
const { loadOpportunityAnalytics } = require("../lib/opportunity/analytics");

const router = express.Router();
const requireOrganizer = requireRole("organizer");

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

router.get("/", requireOrganizer, catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE op.user_id = $1
     ORDER BY o.created_at DESC, o.id DESC`,
    [req.session.user.id]
  );

  const opportunities = rows.map((row) => ({
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
  }));

  res.json({ opportunities, items: opportunities });
}));

router.get("/:id/applicants", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows: ownerRows } = await pool.query(
    `SELECT o.id
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
     WHERE o.id = $1 AND op.user_id = $2`,
    [opportunityId, req.session.user.id]
  );
  if (ownerRows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.status, a.cover_note, a.created_at, a.updated_at, a.applicant_user_id,
            u.first_name, u.last_name, u.email
     FROM application a
     JOIN "user" u ON u.id = a.applicant_user_id
     WHERE a.opportunity_id = $1
     ORDER BY a.created_at ASC, a.id ASC`,
    [opportunityId]
  );

  const applicantIds = rows.map((row) => row.id);
  const historyByApplication = new Map();
  if (applicantIds.length > 0) {
    const { rows: historyRows } = await pool.query(
      `SELECT application_id, id, action, from_status, to_status, actor_user_id, created_at
       FROM application_history
       WHERE application_id = ANY($1::int[])
       ORDER BY created_at ASC, id ASC`,
      [applicantIds]
    );

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
  }

  res.json({
    applicants: rows.map((row) => ({
      id: row.id,
      status: row.status,
      cover_note: row.cover_note,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      applied_at: toIso(row.created_at),
      name: `${row.first_name} ${row.last_name}`,
      full_name: `${row.first_name} ${row.last_name}`,
      email: row.email,
      history: historyByApplication.get(row.id) || [],
    })),
  });
}));

router.post("/:id/applicants/:applicantId/transition", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  const applicationId = parseId(req.params.applicantId);

  if (!opportunityId || !applicationId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const nextStatus = normalizeStatus(req.body.status || req.body.to_status || req.body.next_status);
  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";

  if (!nextStatus) {
    return res.status(400).json({ error: "A target status is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: ownerRows } = await client.query(
      `SELECT o.id
       FROM opportunity o
       JOIN organization org ON org.id = o.organization_id
       JOIN organizer_profile op ON op.organization_id = org.id AND op.role_in_org = 'owner'
       WHERE o.id = $1 AND op.user_id = $2`,
      [opportunityId, req.session.user.id]
    );
    if (ownerRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const application = await loadApplicationAccess(client, applicationId);
    if (!application || application.opportunity_id !== opportunityId) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found" });
    }

    const from = normalizeStatus(application.status);
    try {
      assertTransition(from, nextStatus, "organizer");
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    const { rowCount } = await client.query(
      "UPDATE application SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3",
      [nextStatus, applicationId, from]
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application status has changed" });
    }

    await client.query(
      `INSERT INTO application_history (application_id, action, from_status, to_status, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [applicationId, note ? "status_transition" : "status_transition", from, nextStatus, req.session.user.id]
    );

    await emitApplicationStatusChanged(client, {
      recipientUserId: application.applicant_user_id,
      applicationId,
      opportunityId,
      fromStatus: from,
      toStatus: nextStatus,
      actorUserId: req.session.user.id,
      actorRole: "organizer",
    });

    await client.query("COMMIT");
    res.json({ message: "Applicant status updated", applicationId, status: nextStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/:id/analytics", requireOrganizer, catchAsync(async (req, res) => {
  const opportunityId = parseId(req.params.id);
  if (!opportunityId) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const analytics = await loadOpportunityAnalytics(pool, opportunityId, req.session.user.id);
  if (!analytics) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  res.json(analytics);
}));

module.exports = router;
