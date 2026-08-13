const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildRecommendationContext, buildRecommendationPayload, scoreOpportunity } = require("../lib/opportunity/recommendations");

const router = express.Router();

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimit(value, fallback = 8) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : fallback;
}

router.get("/", requireAuth, requireRole("student"), catchAsync(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 8);
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const deadline = typeof req.query.deadline === "string" ? req.query.deadline.trim().toLowerCase() : "";
  const userId = req.session.user.id;

  const filters = ["o.status = 'published'", "org.status = 'approved'"];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      o.title ILIKE $${values.length}
      OR o.description ILIKE $${values.length}
      OR o.location ILIKE $${values.length}
      OR org.name ILIKE $${values.length}
    )`);
  }

  if (deadline === "upcoming") {
    filters.push("o.deadline >= NOW()");
  } else if (deadline === "past") {
    filters.push("o.deadline < NOW()");
  }

  const { rows: rows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.status, o.deadline, o.created_at, o.published_at,
            org.id AS organization_id, org.name AS organization_name,
            org.description AS organization_description, org.website AS organization_website
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE ${filters.join(" AND ")}
     ORDER BY o.deadline ASC, o.published_at DESC NULLS LAST, o.id ASC`,
    values
  );

  const { rows: historyRows } = await pool.query(
    `SELECT a.opportunity_id, o.title, o.description, o.location, o.organization_id, org.name AS organization_name
     FROM application a
     JOIN opportunity o ON o.id = a.opportunity_id
     JOIN organization org ON org.id = o.organization_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [userId]
  );
  const { rows: bookmarkRows } = await pool.query(
    `SELECT b.event_id AS opportunity_id, o.title, o.description, o.location, o.organization_id, org.name AS organization_name
     FROM bookmark b
     JOIN opportunity o ON o.id = b.event_id
     JOIN organization org ON org.id = o.organization_id
     WHERE b.user_id = $1
     ORDER BY b."saved_At" DESC, b.id DESC`,
    [userId]
  );
  const context = buildRecommendationContext(historyRows, bookmarkRows);

  const scored = rows
    .filter((row) => !context.priorOpportunityIds.has(row.id))
    .map((row) => {
      const score = userId ? scoreOpportunity(row, context) : { score: 0, reason: "Published opportunity" };
      return buildRecommendationPayload(row, score.score, score.reason);
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDeadline = new Date(left.deadline).getTime();
      const rightDeadline = new Date(right.deadline).getTime();
      if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      return left.id - right.id;
    });

  const total = scored.length;
  const items = scored.slice(offset, offset + limit);

  res.json({
    opportunities: items,
    items,
    page,
    limit,
    total,
    hasMore: offset + items.length < total,
  });
}));

module.exports = router;
