const OPPORTUNITY_TRANSITIONS = {
  draft: ["submitted", "archived"],
  submitted: ["published", "rejected"],
  published: ["closed", "archived"],
  rejected: ["draft", "archived"],
  closed: ["published", "archived"],
  archived: [],
};

function canTransition(transitions, fromStatus, toStatus) {
  const allowed = transitions[fromStatus] || [];
  return allowed.includes(toStatus);
}

function assertTransition(transitions, fromStatus, toStatus) {
  if (!canTransition(transitions, fromStatus, toStatus)) {
    const error = new Error(`Cannot transition opportunity from ${fromStatus} to ${toStatus}`);
    error.status = 409;
    throw error;
  }
}

module.exports = {
  OPPORTUNITY_TRANSITIONS,
  canTransition,
  assertTransition,
};


