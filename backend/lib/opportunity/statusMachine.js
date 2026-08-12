const STATUSES = Object.freeze([
  "pending",
  "under_review",
  "shortlisted",
  "accepted",
  "rejected",
  "withdrawn",
]);

const ALIASES = Object.freeze({
  submitted: "pending",
  approved: "accepted",
  declined: "rejected",
  cancelled: "withdrawn",
  canceled: "withdrawn",
  reviewing: "under_review",
});

const TRANSITIONS = Object.freeze({
  student: {
    pending: ["withdrawn"],
    under_review: ["withdrawn"],
    shortlisted: ["withdrawn"],
    accepted: [],
    rejected: [],
    withdrawn: [],
  },
  organizer: {
    pending: ["under_review", "shortlisted", "accepted", "rejected"],
    under_review: ["shortlisted", "accepted", "rejected"],
    shortlisted: ["accepted", "rejected"],
    accepted: [],
    rejected: [],
    withdrawn: [],
  },
  admin: {
    pending: ["under_review", "shortlisted", "accepted", "rejected", "withdrawn"],
    under_review: ["shortlisted", "accepted", "rejected", "withdrawn"],
    shortlisted: ["accepted", "rejected", "withdrawn"],
    accepted: [],
    rejected: [],
    withdrawn: [],
  },
});

function normalizeStatus(status) {
  if (typeof status !== "string") {
    return null;
  }

  const trimmed = status.trim().toLowerCase();
  return ALIASES[trimmed] || trimmed;
}

function assertTransition(from, to, role) {
  const normalizedFrom = normalizeStatus(from);
  const normalizedTo = normalizeStatus(to);
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (!STATUSES.includes(normalizedFrom)) {
    const error = new Error(`Unsupported application status: ${from}`);
    error.status = 400;
    throw error;
  }

  if (!STATUSES.includes(normalizedTo)) {
    const error = new Error(`Unsupported application status: ${to}`);
    error.status = 400;
    throw error;
  }

  const allowedByRole = TRANSITIONS[normalizedRole];
  if (!allowedByRole) {
    const error = new Error(`Unsupported role for application transitions: ${role}`);
    error.status = 403;
    throw error;
  }

  const allowedTargets = allowedByRole[normalizedFrom] || [];
  if (!allowedTargets.includes(normalizedTo)) {
    const error = new Error(
      `Transition ${normalizedFrom} -> ${normalizedTo} is not allowed for ${normalizedRole}`
    );
    error.status = 400;
    throw error;
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    role: normalizedRole,
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  normalizeStatus,
  assertTransition,
};


