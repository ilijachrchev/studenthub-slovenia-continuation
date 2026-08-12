const pool = require("../../db");

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

async function getOpportunityOwnerUserId(client, opportunityId) {
  const db = client || pool;
  const { rows } = await db.query(
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

async function getOwnedOrganizationId(client, userId) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT org.id
     FROM organization org
     JOIN organizer_profile op ON op.organization_id = org.id
     WHERE op.user_id = $1
       AND op.role_in_org = 'owner'
       AND org.status = 'approved'
     ORDER BY org.id ASC
     LIMIT 1`,
    [userId]
  );

  return rows[0] ? rows[0].id : null;
}

async function getOpportunityTags(client, opportunityIds) {
  if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
    return new Map();
  }

  const db = client || pool;
  const { rows } = await db.query(
    `SELECT ot.opportunity_id, t.id, t.name
     FROM opportunity_tag ot
     JOIN tag t ON t.id = ot.tag_id
     WHERE ot.opportunity_id = ANY($1::int[])
     ORDER BY t.name ASC`,
    [opportunityIds]
  );

  const tagsByOpportunity = new Map();
  for (const row of rows) {
    if (!tagsByOpportunity.has(row.opportunity_id)) {
      tagsByOpportunity.set(row.opportunity_id, []);
    }
    tagsByOpportunity.get(row.opportunity_id).push({ id: row.id, name: row.name });
  }

  return tagsByOpportunity;
}

async function resolveTagIds(client, values) {
  const db = client || pool;
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const ids = new Set();

  for (const raw of values) {
    if (raw == null) continue;

    if (typeof raw === "number" && Number.isFinite(raw)) {
      const { rows } = await db.query("SELECT id FROM tag WHERE id = $1", [raw]);
      if (rows.length === 0) {
        const error = new Error(`Unknown tag id: ${raw}`);
        error.status = 400;
        throw error;
      }
      ids.add(rows[0].id);
      continue;
    }

    const label = String(raw).trim();
    if (!label) continue;

    const { rows: existing } = await db.query(
      "SELECT id FROM tag WHERE LOWER(name) = LOWER($1)",
      [label]
    );

    if (existing.length > 0) {
      ids.add(existing[0].id);
      continue;
    }

    const { rows: created } = await db.query(
      "INSERT INTO tag (name) VALUES ($1) RETURNING id",
      [label]
    );
    ids.add(created[0].id);
  }

  return [...ids];
}

module.exports = {
  getOwnedOrganizationId,
  getOpportunityOwnerUserId,
  getOpportunityTags,
  parseId,
  resolveTagIds,
  toIso,
};
