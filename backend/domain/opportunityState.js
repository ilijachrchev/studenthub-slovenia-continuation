const OPPORTUNITY_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "published",
  "rejected",
  "closed",
  "archived",
]);

const OPPORTUNITY_TRANSITIONS = Object.freeze({
  draft: ["submitted", "archived"],
  submitted: ["published", "rejected"],
  published: ["closed", "archived"],
  rejected: ["draft", "archived"],
  closed: ["published", "archived"],
  archived: [],
});

function normalizeOpportunityStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toLowerCase();
  return normalized || null;
}

function isOpportunityStatus(status) {
  return OPPORTUNITY_STATUSES.includes(normalizeOpportunityStatus(status));
}

function assertOpportunityStatus(status) {
  const normalized = normalizeOpportunityStatus(status);
  if (!OPPORTUNITY_STATUSES.includes(normalized)) {
    const error = new Error(`Unsupported opportunity status: ${status}`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function canTransition(transitions, fromStatus, toStatus) {
  const from = normalizeOpportunityStatus(fromStatus);
  const to = normalizeOpportunityStatus(toStatus);
  const allowed = transitions[from] || [];
  return allowed.includes(to);
}

function assertTransition(transitions, fromStatus, toStatus) {
  const from = assertOpportunityStatus(fromStatus);
  const to = assertOpportunityStatus(toStatus);

  if (!canTransition(transitions, from, to)) {
    const error = new Error(`Cannot transition opportunity from ${from} to ${to}`);
    error.status = 409;
    throw error;
  }

  return { from, to };
}

module.exports = {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TRANSITIONS,
  normalizeOpportunityStatus,
  isOpportunityStatus,
  assertOpportunityStatus,
  canTransition,
  assertTransition,
};
