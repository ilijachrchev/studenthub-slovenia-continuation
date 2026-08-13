const pool = require("../../db");
const { emit } = require("./notifications");

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

async function getOpportunityForApplicant(client, opportunityId) {
  const { rows } = await client.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline,
            org.id AS organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.id = $1
       AND o.status = 'published'
       AND o.deadline > NOW()
       AND org.status = 'approved'`,
    [opportunityId]
  );

  return rows[0] || null;
}

async function loadApplicationAccess(client, applicationId) {
  const { rows } = await client.query(
    `SELECT a.id, a.status, a.opportunity_id, a.applicant_user_id, a.cover_note,
            o.title AS opportunity_title,
            org.id AS organization_id
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.id = $1`,
    [applicationId]
  );

  return rows[0] || null;
}

async function emitApplicationReceived(client, {
  ownerUserId,
  applicationId,
  opportunityId,
  applicantUserId,
  opportunityTitle,
}) {
  return emit(ownerUserId, "application.received", {
    applicationId,
    opportunityId,
    applicantUserId,
    opportunityTitle,
  }, client);
}

async function emitApplicationStatusChanged(client, {
  recipientUserId,
  applicationId,
  opportunityId,
  fromStatus,
  toStatus,
  actorUserId,
  actorRole,
}) {
  return emit(recipientUserId, "application.status_changed", {
    applicationId,
    opportunityId,
    fromStatus,
    toStatus,
    actorUserId,
    actorRole,
  }, client);
}

module.exports = {
  emitApplicationReceived,
  emitApplicationStatusChanged,
  getOpportunityForApplicant,
  getOpportunityOwner,
  loadApplicationAccess,
  parseId,
  toIso,
};
