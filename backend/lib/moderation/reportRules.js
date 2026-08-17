/**
 * Shared vocabulary and pure decision logic for the moderation report
 * lifecycle. Kept dependency-free (no db access) so it's cheap to unit test.
 */

const TARGET_TYPES = Object.freeze(["opportunity"]);

const CATEGORIES = Object.freeze([
  "spam",
  "scam_or_fraud",
  "inappropriate_content",
  "misleading_information",
  "discrimination",
  "other",
]);

const SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);

const STATUSES = Object.freeze(["open", "under_review", "resolved", "dismissed", "escalated"]);

const RESOLUTION_ACTIONS = Object.freeze([
  "hide_content",
  "restore_content",
  "no_action",
  "warn_organizer",
]);

// Reports a normal moderator is allowed to independently close. Escalated
// reports require admin sign-off — that's the point of escalating.
const MODERATOR_CLOSABLE_STATUSES = new Set(["open", "under_review"]);
const ADMIN_ONLY_CLOSABLE_STATUSES = new Set(["escalated"]);

function isValidTargetType(value) {
  return TARGET_TYPES.includes(value);
}

function isValidCategory(value) {
  return CATEGORIES.includes(value);
}

function isValidResolutionAction(value) {
  return RESOLUTION_ACTIONS.includes(value);
}

/**
 * Can this report be claimed right now, given its current row state?
 * Claiming is only valid from "open" and only when nobody already holds it.
 */
function canClaim(report) {
  return report.status === "open" && !report.assigned_moderator_user_id;
}

/**
 * Can `actor` close (resolve/dismiss) this report?
 * - Ordinary moderators may only close reports assigned to themselves.
 * - Admins may close anything, including escalated reports and reports
 *   assigned to a different moderator (with a full audit trail either way).
 */
function canClose(report, actor) {
  if (!MODERATOR_CLOSABLE_STATUSES.has(report.status) && !ADMIN_ONLY_CLOSABLE_STATUSES.has(report.status)) {
    return false;
  }

  if (actor.kind === "admin") {
    return true;
  }

  if (ADMIN_ONLY_CLOSABLE_STATUSES.has(report.status)) {
    return false;
  }

  return report.assigned_moderator_user_id === actor.userId;
}

/**
 * Can `actor` escalate this report to admin attention?
 */
function canEscalate(report) {
  return report.status === "open" || report.status === "under_review";
}

/**
 * Can `actor` release (unclaim) this report back to the open queue?
 */
function canRelease(report, actor) {
  if (report.status !== "under_review") {
    return false;
  }
  if (actor.kind === "admin") {
    return true;
  }
  return report.assigned_moderator_user_id === actor.userId;
}

module.exports = {
  TARGET_TYPES,
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  RESOLUTION_ACTIONS,
  isValidTargetType,
  isValidCategory,
  isValidResolutionAction,
  canClaim,
  canClose,
  canEscalate,
  canRelease,
};
