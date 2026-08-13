const pool = require("../../db");

function parseLimit(value, fallback = 10) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 50);
}

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function placeholders(count) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`);
}

function tokenizeText(value) {
  if (!value) return [];
  const matches = String(value).toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return [];
  return matches.filter((token) => token.length >= 3);
}

function buildRecommendationContext(historyRows = [], bookmarkRows = []) {
  const priorOpportunityIds = new Set();
  const organizationWeights = new Map();
  const tokenWeights = new Map();

  for (const row of [...historyRows, ...bookmarkRows]) {
    if (!row) continue;

    if (row.opportunity_id != null) {
      priorOpportunityIds.add(Number(row.opportunity_id));
    }

    if (row.organization_id != null) {
      const key = Number(row.organization_id);
      organizationWeights.set(key, (organizationWeights.get(key) || 0) + 1);
    }

    const text = [row.title, row.description, row.location, row.organization_name]
      .filter(Boolean)
      .join(" ");

    for (const token of tokenizeText(text)) {
      tokenWeights.set(token, (tokenWeights.get(token) || 0) + 1);
    }
  }

  return {
    priorOpportunityIds,
    organizationWeights,
    tokenWeights,
  };
}

function scoreOpportunity(opportunity, context) {
  const reasons = [];
  let score = 0;

  if (context.organizationWeights.has(Number(opportunity.organization_id))) {
    const weight = context.organizationWeights.get(Number(opportunity.organization_id));
    score += 15 + weight * 2;
    reasons.push({
      score: 15 + weight * 2,
      text: `You have already interacted with ${opportunity.organization_name}`,
    });
  }

  const opportunityTokens = new Set(
    tokenizeText(
      [
        opportunity.title,
        opportunity.description,
        opportunity.location,
        opportunity.organization_name,
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

  let tokenScore = 0;
  for (const token of opportunityTokens) {
    const weight = context.tokenWeights.get(token) || 0;
    if (weight > 0) {
      tokenScore += weight;
    }
  }

  if (tokenScore > 0) {
    const points = Math.min(20, tokenScore * 2);
    score += points;
    reasons.push({
      score: points,
      text: "Matches topics from opportunities you already explored",
    });
  }

  const deadline = opportunity.deadline ? new Date(opportunity.deadline).getTime() : null;
  if (deadline && Number.isFinite(deadline)) {
    const daysUntilDeadline = Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysUntilDeadline <= 14) {
      const points = Math.max(1, 8 - Math.max(daysUntilDeadline, 0));
      score += points;
      reasons.push({
        score: points,
        text: "Application deadline is coming up soon",
      });
    }
  }

  reasons.sort((left, right) => right.score - left.score || left.text.localeCompare(right.text));

  return {
    score,
    reason: reasons[0]?.text || "Published opportunity",
    reasons: reasons.map((reason) => reason.text),
  };
}

function buildRecommendationPayload(opportunity, scoreInfo) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description,
    location: opportunity.location,
    deadline: opportunity.deadline,
    status: opportunity.status,
    organization_id: opportunity.organization_id,
    organization_name: opportunity.organization_name,
    score: scoreInfo.score,
    primary_reason: scoreInfo.reason,
    reason: scoreInfo.reason,
    reasons: scoreInfo.reasons,
    tags: [],
  };
}

async function getRecommendations(userId, limit = 10, page = 1) {
  const safeLimit = parseLimit(limit, 10);
  const safePage = parsePage(page, 1);
  const offset = (safePage - 1) * safeLimit;

  const { rows: opportunityRows } = await pool.query(
    `SELECT o.id, o.title, o.description, o.location, o.deadline, o.status,
            o.organization_id, org.name AS organization_name
     FROM opportunity o
     JOIN organization org ON org.id = o.organization_id
     WHERE o.status = 'published'
       AND org.status = 'approved'
       AND o.deadline >= NOW()
     ORDER BY o.deadline ASC, o.id ASC`
  );

  if (opportunityRows.length === 0) {
    return {
      opportunities: [],
      items: [],
      page: safePage,
      limit: safeLimit,
      total: 0,
      hasMore: false,
    };
  }

  let context = buildRecommendationContext();
  if (userId) {
    const [historyResult, bookmarkResult] = await Promise.all([
      pool.query(
        `SELECT a.opportunity_id, o.organization_id, o.title, o.description, o.location,
                org.name AS organization_name
         FROM application a
         JOIN opportunity o ON o.id = a.opportunity_id
         JOIN organization org ON org.id = o.organization_id
         WHERE a.applicant_user_id = $1
         ORDER BY a.created_at DESC, a.id DESC`,
        [userId]
      ),
      pool.query(
        `SELECT b.opportunity_id, o.organization_id, o.title, o.description, o.location,
                org.name AS organization_name
         FROM opportunity_bookmark b
         JOIN opportunity o ON o.id = b.opportunity_id
         JOIN organization org ON org.id = o.organization_id
         WHERE b.user_id = $1
         ORDER BY b.saved_at DESC, b.id DESC`,
        [userId]
      ),
    ]);

    context = buildRecommendationContext(historyResult.rows, bookmarkResult.rows);
  }

  const scored = opportunityRows
    .filter((opportunity) => !context.priorOpportunityIds.has(Number(opportunity.id)))
    .map((opportunity) => {
      const scoreInfo = userId ? scoreOpportunity(opportunity, context) : { score: 0, reason: "Published opportunity", reasons: [] };
      return buildRecommendationPayload(opportunity, scoreInfo);
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDeadline = new Date(left.deadline).getTime();
      const rightDeadline = new Date(right.deadline).getTime();
      if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      return left.id - right.id;
    });

  const total = scored.length;
  const items = scored.slice(offset, offset + safeLimit);

  return {
    opportunities: items,
    items,
    page: safePage,
    limit: safeLimit,
    total,
    hasMore: offset + items.length < total,
  };
}

module.exports = {
  buildRecommendationContext,
  buildRecommendationPayload,
  getRecommendations,
  parseLimit,
  parsePage,
  scoreOpportunity,
  tokenizeText,
};
