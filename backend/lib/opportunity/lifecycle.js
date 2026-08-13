const {
  OPPORTUNITY_TRANSITIONS,
  assertOpportunityStatus,
  assertTransition,
} = require("../../domain/opportunityState");

const ORGANIZER_ALLOWED_TRANSITIONS = new Set([
  "draft->submitted",
  "draft->archived",
  "rejected->draft",
  "rejected->archived",
  "published->closed",
  "published->archived",
  "closed->published",
  "closed->archived",
]);

const ADMIN_ALLOWED_TRANSITIONS = new Set([
  "submitted->published",
  "submitted->rejected",
  "published->archived",
  "closed->archived",
]);

function transitionKey(fromStatus, toStatus) {
  return `${fromStatus}->${toStatus}`;
}

async function getOwnedOpportunity(client, opportunityId, userId, lockForUpdate = false) {
  const { rows } = await client.query(
    `SELECT o.id, o.status, o.organization_id, o.posted_by, o.application_deadline
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     JOIN organizer_profile op
       ON op.organization_id = org.id
      AND op.role_in_org = 'owner'
     WHERE o.id = $1
       AND op.user_id = $2
     ${lockForUpdate ? "FOR UPDATE" : ""}`,
    [opportunityId, userId]
  );

  return rows[0] || null;
}

async function getOpportunityForTransition(client, opportunityId, lockForUpdate = false) {
  const { rows } = await client.query(
    `SELECT id, status, organization_id, posted_by, application_deadline
     FROM opportunity
     WHERE id = $1
     ${lockForUpdate ? "FOR UPDATE" : ""}`,
    [opportunityId]
  );

  return rows[0] || null;
}

async function recordStatusHistory(client, {
  opportunityId,
  previousStatus,
  nextStatus,
  actorUserId,
  reason = null,
}) {
  await client.query(
    `INSERT INTO opportunity_status_history
      (opportunity_id, previous_status, next_status, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [opportunityId, previousStatus, nextStatus, actorUserId, reason]
  );
}

function assertActorCanTransition(actorRole, fromStatus, toStatus) {
  const key = transitionKey(fromStatus, toStatus);
  if (actorRole === "organizer" && ORGANIZER_ALLOWED_TRANSITIONS.has(key)) {
    return;
  }
  if (actorRole === "admin" && ADMIN_ALLOWED_TRANSITIONS.has(key)) {
    return;
  }

  const error = new Error(`Only authorized users can transition opportunity from ${fromStatus} to ${toStatus}`);
  error.status = 403;
  throw error;
}

function assertReopenDeadline(opportunity, nextStatus, actorRole) {
  if (actorRole !== "organizer" || opportunity.status !== "closed" || nextStatus !== "published") {
    return;
  }

  if (!opportunity.application_deadline) {
    return;
  }

  if (new Date(opportunity.application_deadline).getTime() < Date.now()) {
    const error = new Error("Cannot reopen opportunity after the application deadline");
    error.status = 409;
    throw error;
  }
}

async function createOpportunityWithHistory(client, {
  opportunityId,
  actorUserId,
  reason = null,
}) {
  await recordStatusHistory(client, {
    opportunityId,
    previousStatus: null,
    nextStatus: "draft",
    actorUserId,
    reason,
  });
}

async function transitionOpportunity(client, {
  opportunityId,
  actorUserId,
  actorRole,
  toStatus,
  reason = null,
  requireOwnership = true,
}) {
  const nextStatus = assertOpportunityStatus(toStatus);

  const opportunity = requireOwnership
    ? await getOwnedOpportunity(client, opportunityId, actorUserId, true)
    : await getOpportunityForTransition(client, opportunityId, true);

  if (!opportunity) {
    const error = new Error("Opportunity not found");
    error.status = 404;
    throw error;
  }

  const currentStatus = assertOpportunityStatus(opportunity.status);

  if (currentStatus === nextStatus) {
    const error = new Error(`Opportunity is already ${nextStatus}`);
    error.status = 409;
    throw error;
  }

  assertTransition(OPPORTUNITY_TRANSITIONS, currentStatus, nextStatus);
  assertReopenDeadline(opportunity, nextStatus, actorRole);
  assertActorCanTransition(actorRole, currentStatus, nextStatus);

  const { rowCount } = await client.query(
    `UPDATE opportunity
     SET status = $1,
         published_at = CASE
           WHEN $1 = 'published' AND published_at IS NULL THEN NOW()
           ELSE published_at
         END,
         updated_at = NOW()
     WHERE id = $2 AND status = $3`,
    [nextStatus, opportunityId, currentStatus]
  );

  if (rowCount === 0) {
    const error = new Error("Opportunity status has changed");
    error.status = 409;
    throw error;
  }

  await recordStatusHistory(client, {
    opportunityId,
    previousStatus: currentStatus,
    nextStatus,
    actorUserId,
    reason,
  });

  return {
    opportunityId,
    previousStatus: currentStatus,
    status: nextStatus,
  };
}

async function listOpportunityHistory(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT id, opportunity_id, previous_status, next_status, actor_user_id, reason, created_at
     FROM opportunity_status_history
     WHERE opportunity_id = $1
     ORDER BY created_at ASC, id ASC`,
    [opportunityId]
  );

  return rows;
}

module.exports = {
  getOwnedOpportunity,
  getOpportunityForTransition,
  recordStatusHistory,
  createOpportunityWithHistory,
  transitionOpportunity,
  listOpportunityHistory,
  assertActorCanTransition,
  assertReopenDeadline,
  transitionKey,
};
