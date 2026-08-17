/**
 * Opportunity lifecycle state machine.
 *
 * Governs the lifecycle of the `opportunity` entity itself (not the
 * `application`s submitted against it — see statusMachine.js for that).
 *
 *   draft --------> published --------> closed --------> archived
 *     \                  \                                  ^
 *      \--> archived      \--------------------------------/
 *
 * - draft: only visible to the owning organizer. Editable.
 * - published: publicly listed, accepts applications until `deadline`.
 * - closed: no longer accepts applications, still visible for reference.
 * - archived: terminal. Hidden from all listings.
 *
 * Roles:
 * - organizer: owns the opportunity's organization (see routes/opportunities.js
 *   for the ownership check). Can run the "happy path" transitions.
 * - admin: moderation authority. Can additionally force-archive a published
 *   opportunity (takedown) without going through `closed` first.
 */

const STATUSES = Object.freeze(["draft", "published", "closed", "archived"]);

const TRANSITIONS = Object.freeze({
  organizer: {
    draft: ["published", "archived"],
    published: ["closed"],
    closed: ["archived", "published"],
    archived: [],
  },
  admin: {
    draft: ["published", "archived"],
    published: ["closed", "archived"],
    closed: ["archived", "published"],
    archived: [],
  },
});

function normalizeStatus(status) {
  if (typeof status !== "string") {
    return null;
  }
  const trimmed = status.trim().toLowerCase();
  return trimmed || null;
}

function isValidStatus(status) {
  return STATUSES.includes(normalizeStatus(status));
}

function assertTransition(from, to, role) {
  const normalizedFrom = normalizeStatus(from);
  const normalizedTo = normalizeStatus(to);
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";

  if (!STATUSES.includes(normalizedFrom)) {
    const error = new Error(`Unsupported opportunity status: ${from}`);
    error.status = 400;
    throw error;
  }

  if (!STATUSES.includes(normalizedTo)) {
    const error = new Error(`Unsupported opportunity status: ${to}`);
    error.status = 400;
    throw error;
  }

  const allowedByRole = TRANSITIONS[normalizedRole];
  if (!allowedByRole) {
    const error = new Error(`Unsupported role for opportunity transitions: ${role}`);
    error.status = 403;
    throw error;
  }

  const allowedTargets = allowedByRole[normalizedFrom] || [];
  if (!allowedTargets.includes(normalizedTo)) {
    const error = new Error(
      `Transition ${normalizedFrom} -> ${normalizedTo} is not allowed for ${normalizedRole}`
    );
    error.status = 409;
    throw error;
  }

  return { from: normalizedFrom, to: normalizedTo, role: normalizedRole };
}

/**
 * Columns to stamp when moving into a given status, beyond `status` itself.
 * Kept centralized so routes never hand-roll timestamp bookkeeping.
 */
function timestampColumnFor(toStatus) {
  switch (normalizeStatus(toStatus)) {
    case "published":
      return "published_at";
    case "closed":
      return "closed_at";
    case "archived":
      return "archived_at";
    default:
      return null;
  }
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  normalizeStatus,
  isValidStatus,
  assertTransition,
  timestampColumnFor,
};
