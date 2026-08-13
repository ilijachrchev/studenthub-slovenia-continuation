function tokenizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildOpportunityText(opportunity) {
  return [
    opportunity.title,
    opportunity.description,
    opportunity.location,
    opportunity.organization_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildRecommendationContext(historyRows, bookmarkRows) {
  const historyOpportunities = historyRows.map((row) => ({
    id: row.opportunity_id,
    title: row.title,
    description: row.description,
    location: row.location,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
  }));

  const bookmarkOpportunities = bookmarkRows.map((row) => ({
    id: row.opportunity_id,
    title: row.title,
    description: row.description,
    location: row.location,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
  }));

  const priorOpportunities = unique([...historyOpportunities, ...bookmarkOpportunities].map((item) => item.id));
  const tokens = unique([
    ...historyOpportunities.flatMap((item) => tokenizeText(buildOpportunityText(item))),
    ...bookmarkOpportunities.flatMap((item) => tokenizeText(buildOpportunityText(item))),
  ]);
  const tokenSet = new Set(tokens);
  const organizationIds = unique([
    ...historyOpportunities.map((item) => item.organization_id),
    ...bookmarkOpportunities.map((item) => item.organization_id),
  ]);

  return {
    historyOpportunities,
    bookmarkOpportunities,
    priorOpportunityIds: new Set(priorOpportunities),
    priorOrganizationIds: new Set(organizationIds),
    tokens,
    tokenSet,
  };
}

function scoreOpportunity(opportunity, context) {
  let score = 0;
  const reasonParts = [];

  if (context.priorOrganizationIds.has(opportunity.organization_id)) {
    score += 8;
    reasonParts.push(`from ${opportunity.organization_name}`);
  }

  const opportunityTokens = tokenizeText(buildOpportunityText(opportunity));
  const sharedTokens = opportunityTokens.filter((token) =>
    context.tokenSet ? context.tokenSet.has(token) : context.tokens.includes(token)
  );
  if (sharedTokens.length > 0) {
    score += sharedTokens.length * 3;
    reasonParts.push(`shares ${sharedTokens.slice(0, 2).join(", ")}`);
  }

  if (opportunity.deadline) {
    const deadlineDays = Math.max(0, Math.ceil((new Date(opportunity.deadline).getTime() - Date.now()) / 86400000));
    if (deadlineDays <= 7) {
      score += 5;
      reasonParts.push("closes soon");
    } else if (deadlineDays <= 30) {
      score += 2;
    }
  }

  if (opportunity.published_at) {
    const ageDays = Math.max(0, Math.ceil((Date.now() - new Date(opportunity.published_at).getTime()) / 86400000));
    if (ageDays <= 14) {
      score += 2;
    }
  }

  return {
    score,
    reason: reasonParts[0] || "Based on your activity and this opportunity's details",
  };
}

function buildRecommendationPayload(opportunity, score, reason) {
  return {
    ...opportunity,
    score,
    primary_reason: reason,
    reason,
  };
}

module.exports = {
  buildRecommendationContext,
  buildRecommendationPayload,
  scoreOpportunity,
  tokenizeText,
};
