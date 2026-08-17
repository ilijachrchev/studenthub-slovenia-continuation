const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateOpportunity } = require("../middleware/validate");
const {
  assertTransition,
  normalizeStatus,
  timestampColumnFor,
} = require("../lib/opportunity/opportunityStatusMachine");
const { emit } = require("../lib/opportunity/notifications");
const {
  extractKey,
  hashRequest,
  checkIdempotency,
  storeIdempotentResponse,
} = require("../lib/opportunity/idempotency");

const router = express.Router();

// Mutations are authenticated already, but a compromised/buggy client
// (or a scripted abuse attempt) shouldn't be able to hammer lifecycle
// transitions or flood opportunity_history. Keyed by session user, not IP,
// since these are all auth-gated routes.
const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  keyGenerator: (req) => (req.session && req.session.user ? `user:${req.session.user.id}` : req.ip),
  message: { error: "Too many requests, please try again later" },
});

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function serializeOpportunity(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    title: row.title,
    description: row.description,
    location: row.location,
    status: row.status,
    deadline: toIso(row.deadline),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    published_at: toIso(row.published_at),
    closed_at: toIso(row.closed_at),
    archived_at: toIso(row.archived_at),
  };
}

/** Any organizer_profile membership (any role) grants management rights over the org's opportunities. */
async function getManagedOrganizationId(client, userId) {
  const { rows } = await client.query(
    `SELECT o.id
     FROM organization o
     JOIN organizer_profile op ON op.organization_id = o.id
     WHERE op.user_id = $1 AND o.status = 'approved'
     ORDER BY o.id ASC
     LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0].id : null;
}

async function isOpportunityManager(client, opportunityId, userId) {
  const { rows } = await client.query(
    `SELECT 1
     FROM opportunity o
     JOIN organizer_profile op ON op.organization_id = o.organization_id
     WHERE o.id = $1 AND op.user_id = $2
     LIMIT 1`,
    [opportunityId, userId]
  );
  return rows.length > 0;
}

/** Only the org "owner" receives lifecycle notifications, matching applications.js. */
async function getOpportunityOwnerUserId(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT op.user_id
     FROM opportunity o
     JOIN organizer_profile op ON op.organization_id = o.organization_id AND op.role_in_org = 'owner'
     WHERE o.id = $1
     ORDER BY op.user_id ASC
     LIMIT 1`,
    [opportunityId]
  );
  return rows.length ? rows[0].user_id : null;
}

// GET /api/opportunities — public listing of published, still-open opportunities
router.get("/", catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.status = 'published' AND org.status = 'approved'`
  );

  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.description, o.location,
            o.status, o.deadline, o.created_at, o.updated_at, o.published_at,
            o.closed_at, o.archived_at, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.status = 'published' AND org.status = 'approved'
     ORDER BY o.deadline ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  res.json({
    opportunities: rows.map(serializeOpportunity),
    page,
    limit,
    total: countRows[0].total,
  });
}));

// GET /api/opportunities/mine — organizer: every opportunity for their organization
router.get("/mine", requireAuth, requireRole("organizer"), catchAsync(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.description, o.location,
            o.status, o.deadline, o.created_at, o.updated_at, o.published_at,
            o.closed_at, o.archived_at, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op ON op.organization_id = org.id
     WHERE op.user_id = $1
     ORDER BY o.created_at DESC`,
    [req.session.user.id]
  );

  res.json({ opportunities: rows.map(serializeOpportunity) });
}));

// GET /api/opportunities/:id — public detail (published only)
router.get("/:id", catchAsync(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.organization_id, o.title, o.description, o.location,
            o.status, o.deadline, o.created_at, o.updated_at, o.published_at,
            o.closed_at, o.archived_at, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1 AND o.status = 'published' AND org.status = 'approved'`,
    [id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  res.json(serializeOpportunity(rows[0]));
}));

// POST /api/opportunities — organizer creates a new draft
router.post("/", requireAuth, requireRole("organizer"), mutationLimiter, catchAsync(async (req, res) => {
  const errors = validateOpportunity(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  const idemKey = extractKey(req);
  const requestHash = hashRequest({ scope: "opportunity.create", body: req.body });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const idem = await checkIdempotency(client, {
      scope: "opportunity.create",
      key: idemKey,
      userId: req.session.user.id,
      requestBody: { scope: "opportunity.create", body: req.body },
    });
    if (idem.replay) {
      await client.query("COMMIT");
      return res.status(idem.status).json(idem.body);
    }
    if (idem.conflict) {
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "Idempotency-Key was already used for a different request" });
    }

    const organizationId = await getManagedOrganizationId(client, req.session.user.id);
    if (!organizationId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "No approved organization found for this account" });
    }

    const { rows: [opportunity] } = await client.query(
      `INSERT INTO opportunity (organization_id, title, description, location, status, deadline)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING id, organization_id, title, description, location, status, deadline,
                 created_at, updated_at, published_at, closed_at, archived_at`,
      [
        organizationId,
        req.body.title.trim(),
        typeof req.body.description === "string" ? req.body.description.trim() || null : null,
        typeof req.body.location === "string" ? req.body.location.trim() || null : null,
        new Date(req.body.deadline),
      ]
    );

    await client.query(
      `INSERT INTO opportunity_history (opportunity_id, action, from_status, to_status, actor_user_id, actor_role)
       VALUES ($1, 'created', NULL, 'draft', $2, 'organizer')`,
      [opportunity.id, req.session.user.id]
    );

    const responseBody = { message: "Opportunity created", opportunity: serializeOpportunity(opportunity) };
    await storeIdempotentResponse(client, {
      scope: "opportunity.create",
      key: idemKey,
      userId: req.session.user.id,
      requestHash,
      status: 201,
      body: responseBody,
    });

    await client.query("COMMIT");
    return res.status(201).json(responseBody);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// PATCH /api/opportunities/:id — organizer edits a draft (title/description/location/deadline)
router.patch("/:id", requireAuth, requireRole("organizer"), mutationLimiter, catchAsync(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const errors = validateOpportunity(req.body, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT o.id, o.status
       FROM opportunity o
       JOIN organizer_profile op ON op.organization_id = o.organization_id
       WHERE o.id = $1 AND op.user_id = $2
       FOR UPDATE OF o`,
      [id, req.session.user.id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    if (rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only draft opportunities can be edited" });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (req.body.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(req.body.title.trim());
    }
    if (req.body.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(typeof req.body.description === "string" ? req.body.description.trim() || null : null);
    }
    if (req.body.location !== undefined) {
      fields.push(`location = $${idx++}`);
      values.push(typeof req.body.location === "string" ? req.body.location.trim() || null : null);
    }
    if (req.body.deadline !== undefined) {
      fields.push(`deadline = $${idx++}`);
      values.push(new Date(req.body.deadline));
    }

    if (fields.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No editable fields provided" });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows: [updated] } = await client.query(
      `UPDATE opportunity SET ${fields.join(", ")}
       WHERE id = $${idx}
       RETURNING id, organization_id, title, description, location, status, deadline,
                 created_at, updated_at, published_at, closed_at, archived_at`,
      values
    );

    await client.query("COMMIT");
    return res.json({ message: "Opportunity updated", opportunity: serializeOpportunity(updated) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// POST /api/opportunities/:id/transition — explicit, authorization-aware lifecycle transition
router.post("/:id/transition", requireAuth, mutationLimiter, catchAsync(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const role = req.session.user.role;
  if (role !== "organizer" && role !== "admin") {
    return res.status(403).json({ error: "Only organizers or admins can change opportunity status" });
  }

  const to = normalizeStatus(req.body.to_status || req.body.to);
  const declaredFrom = normalizeStatus(req.body.from_status || req.body.from);
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 2000) || null : null;

  if (!to) {
    return res.status(400).json({ error: "to_status is required" });
  }

  const idemKey = extractKey(req);
  const idemRequestBody = { opportunityId: id, to, declaredFrom, reason };
  const requestHash = hashRequest(idemRequestBody);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const idem = await checkIdempotency(client, {
      scope: "opportunity.transition",
      key: idemKey,
      userId: req.session.user.id,
      requestBody: idemRequestBody,
    });
    if (idem.replay) {
      await client.query("COMMIT");
      return res.status(idem.status).json(idem.body);
    }
    if (idem.conflict) {
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "Idempotency-Key was already used for a different request" });
    }

    const { rows } = await client.query(
      `SELECT id, organization_id, status, title
       FROM opportunity
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const opportunity = rows[0];

    if (role === "organizer") {
      const isManager = await isOpportunityManager(client, id, req.session.user.id);
      if (!isManager) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Opportunity not found" });
      }
    }

    if (declaredFrom && declaredFrom !== opportunity.status) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Opportunity status has changed", currentStatus: opportunity.status });
    }

    let transition;
    try {
      transition = assertTransition(opportunity.status, to, role);
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.status || 400).json({ error: error.message });
    }

    const timestampColumn = timestampColumnFor(transition.to);
    const timestampClause = timestampColumn ? `, ${timestampColumn} = NOW()` : "";

    const { rowCount } = await client.query(
      `UPDATE opportunity SET status = $1, updated_at = NOW()${timestampClause}
       WHERE id = $2 AND status = $3`,
      [transition.to, id, transition.from]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Opportunity status has changed" });
    }

    await client.query(
      `INSERT INTO opportunity_history (opportunity_id, action, from_status, to_status, actor_user_id, actor_role, reason)
       VALUES ($1, 'status_transition', $2, $3, $4, $5, $6)`,
      [id, transition.from, transition.to, req.session.user.id, role, reason]
    );

    // Notify affected parties. Admin-initiated changes always notify the org owner
    // (moderation action on their behalf). Closing/archiving notifies applicants
    // who still have a non-terminal application, since it affects their outcome.
    const ownerUserId = await getOpportunityOwnerUserId(client, id);
    if (role === "admin" && ownerUserId) {
      await emit(ownerUserId, "opportunity.status_changed", {
        opportunityId: id,
        opportunityTitle: opportunity.title,
        fromStatus: transition.from,
        toStatus: transition.to,
        actorUserId: req.session.user.id,
        actorRole: role,
        reason,
      }, client);
    }

    if (transition.to === "closed" || transition.to === "archived") {
      const { rows: applicants } = await client.query(
        `SELECT DISTINCT applicant_user_id
         FROM application
         WHERE opportunity_id = $1 AND status NOT IN ('accepted', 'rejected', 'withdrawn')`,
        [id]
      );
      for (const applicant of applicants) {
        await emit(applicant.applicant_user_id, "opportunity.closed", {
          opportunityId: id,
          opportunityTitle: opportunity.title,
          toStatus: transition.to,
        }, client);
      }
    }

    const responseBody = {
      message: "Opportunity status updated",
      opportunityId: id,
      status: transition.to,
    };
    await storeIdempotentResponse(client, {
      scope: "opportunity.transition",
      key: idemKey,
      userId: req.session.user.id,
      requestHash,
      status: 200,
      body: responseBody,
    });

    await client.query("COMMIT");
    return res.json(responseBody);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// GET /api/opportunities/:id/history — audit trail (owner/manager or admin only)
router.get("/:id/history", requireAuth, catchAsync(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows: oppRows } = await pool.query("SELECT id FROM opportunity WHERE id = $1", [id]);
  if (oppRows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const role = req.session.user.role;
  if (role !== "admin") {
    const isManager = await isOpportunityManager(pool, id, req.session.user.id);
    if (!isManager) {
      return res.status(404).json({ error: "Opportunity not found" });
    }
  }

  const { rows } = await pool.query(
    `SELECT id, action, from_status, to_status, actor_user_id, actor_role, reason, created_at
     FROM opportunity_history
     WHERE opportunity_id = $1
     ORDER BY created_at ASC, id ASC`,
    [id]
  );

  res.json({
    opportunityId: id,
    history: rows.map((row) => ({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      reason: row.reason,
      created_at: toIso(row.created_at),
    })),
  });
}));

// GET /api/opportunities/:id/analytics — per-opportunity funnel metrics (owner/manager or admin only)
router.get("/:id/analytics", requireAuth, catchAsync(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const { rows: oppRows } = await pool.query(
    `SELECT id, status, created_at, published_at, closed_at, archived_at
     FROM opportunity WHERE id = $1`,
    [id]
  );
  if (oppRows.length === 0) {
    return res.status(404).json({ error: "Opportunity not found" });
  }

  const role = req.session.user.role;
  if (role !== "admin") {
    const isManager = await isOpportunityManager(pool, id, req.session.user.id);
    if (!isManager) {
      return res.status(404).json({ error: "Opportunity not found" });
    }
  }

  const opportunity = oppRows[0];

  const { rows: distributionRows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM application
     WHERE opportunity_id = $1
     GROUP BY status`,
    [id]
  );

  const { rows: timingRows } = await pool.query(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (first_move.created_at - a.created_at)))
         FILTER (WHERE first_move.created_at IS NOT NULL) AS avg_seconds_to_review,
       AVG(EXTRACT(EPOCH FROM (decision.created_at - a.created_at)))
         FILTER (WHERE decision.created_at IS NOT NULL) AS avg_seconds_to_decision
     FROM application a
     LEFT JOIN LATERAL (
       SELECT created_at FROM application_history
       WHERE application_id = a.id AND action = 'status_transition'
       ORDER BY created_at ASC LIMIT 1
     ) first_move ON true
     LEFT JOIN LATERAL (
       SELECT created_at FROM application_history
       WHERE application_id = a.id AND to_status IN ('accepted', 'rejected')
       ORDER BY created_at ASC LIMIT 1
     ) decision ON true
     WHERE a.opportunity_id = $1`,
    [id]
  );

  const distribution = {};
  let total = 0;
  for (const row of distributionRows) {
    distribution[row.status] = row.count;
    total += row.count;
  }
  const accepted = distribution.accepted || 0;
  const timing = timingRows[0] || {};

  res.json({
    opportunityId: id,
    status: opportunity.status,
    activity: {
      created_at: toIso(opportunity.created_at),
      published_at: toIso(opportunity.published_at),
      closed_at: toIso(opportunity.closed_at),
      archived_at: toIso(opportunity.archived_at),
    },
    applications: {
      total,
      status_distribution: distribution,
      conversion_rate: total > 0 ? Number((accepted / total).toFixed(4)) : null,
      avg_seconds_to_review: timing.avg_seconds_to_review !== null && timing.avg_seconds_to_review !== undefined
        ? Number(timing.avg_seconds_to_review)
        : null,
      avg_seconds_to_decision: timing.avg_seconds_to_decision !== null && timing.avg_seconds_to_decision !== undefined
        ? Number(timing.avg_seconds_to_decision)
        : null,
    },
  });
}));

// GET /api/opportunities/analytics/summary — organizer-wide performance rollup
router.get("/analytics/summary", requireAuth, requireRole("organizer"), catchAsync(async (req, res) => {
  const organizationId = await getManagedOrganizationId(pool, req.session.user.id);
  if (!organizationId) {
    return res.status(403).json({ error: "No approved organization found for this account" });
  }

  const { rows: statusRows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM opportunity
     WHERE organization_id = $1
     GROUP BY status`,
    [organizationId]
  );

  const { rows: appRows } = await pool.query(
    `SELECT a.status, COUNT(*)::int AS count
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     WHERE o.organization_id = $1
     GROUP BY a.status`,
    [organizationId]
  );

  const opportunityStatus = {};
  let totalOpportunities = 0;
  for (const row of statusRows) {
    opportunityStatus[row.status] = row.count;
    totalOpportunities += row.count;
  }

  const applicationStatus = {};
  let totalApplications = 0;
  for (const row of appRows) {
    applicationStatus[row.status] = row.count;
    totalApplications += row.count;
  }
  const accepted = applicationStatus.accepted || 0;

  res.json({
    organizationId,
    opportunities: {
      total: totalOpportunities,
      status_distribution: opportunityStatus,
    },
    applications: {
      total: totalApplications,
      status_distribution: applicationStatus,
      conversion_rate: totalApplications > 0 ? Number((accepted / totalApplications).toFixed(4)) : null,
    },
  });
}));

module.exports = router;
