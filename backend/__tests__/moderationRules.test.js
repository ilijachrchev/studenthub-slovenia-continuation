const rules = require("../lib/moderation/reportRules");

describe("moderation report rules (pure logic, no DB)", () => {
  describe("isValidCategory / isValidTargetType / isValidResolutionAction", () => {
    test("accepts known values", () => {
      expect(rules.isValidCategory("spam")).toBe(true);
      expect(rules.isValidTargetType("opportunity")).toBe(true);
      expect(rules.isValidResolutionAction("hide_content")).toBe(true);
    });

    test("rejects unknown values", () => {
      expect(rules.isValidCategory("made_up")).toBe(false);
      expect(rules.isValidTargetType("user")).toBe(false);
      expect(rules.isValidResolutionAction("delete_account")).toBe(false);
    });
  });

  describe("canClaim", () => {
    test("open + unassigned can be claimed", () => {
      expect(rules.canClaim({ status: "open", assigned_moderator_user_id: null })).toBe(true);
    });

    test("already-assigned report cannot be claimed again", () => {
      expect(rules.canClaim({ status: "open", assigned_moderator_user_id: 5 })).toBe(false);
    });

    test("non-open statuses cannot be claimed", () => {
      expect(rules.canClaim({ status: "resolved", assigned_moderator_user_id: null })).toBe(false);
      expect(rules.canClaim({ status: "under_review", assigned_moderator_user_id: null })).toBe(false);
    });
  });

  describe("canClose", () => {
    const assignedModerator = { kind: "moderator", userId: 1 };
    const otherModerator = { kind: "moderator", userId: 2 };
    const admin = { kind: "admin", userId: 99 };

    test("the assigned moderator can close their own under_review report", () => {
      const report = { status: "under_review", assigned_moderator_user_id: 1 };
      expect(rules.canClose(report, assignedModerator)).toBe(true);
    });

    test("a different moderator cannot close someone else's report", () => {
      const report = { status: "under_review", assigned_moderator_user_id: 1 };
      expect(rules.canClose(report, otherModerator)).toBe(false);
    });

    test("a moderator cannot close an unassigned open report they don't own", () => {
      const report = { status: "open", assigned_moderator_user_id: null };
      expect(rules.canClose(report, otherModerator)).toBe(false);
    });

    test("escalated reports cannot be closed by a plain moderator, even the assignee", () => {
      const report = { status: "escalated", assigned_moderator_user_id: 1 };
      expect(rules.canClose(report, assignedModerator)).toBe(false);
    });

    test("admins can close anything not already closed, including escalated reports", () => {
      expect(rules.canClose({ status: "escalated", assigned_moderator_user_id: 1 }, admin)).toBe(true);
      expect(rules.canClose({ status: "open", assigned_moderator_user_id: null }, admin)).toBe(true);
      expect(rules.canClose({ status: "under_review", assigned_moderator_user_id: 2 }, admin)).toBe(true);
    });

    test("nobody can close an already-resolved or dismissed report", () => {
      expect(rules.canClose({ status: "resolved", assigned_moderator_user_id: 1 }, admin)).toBe(false);
      expect(rules.canClose({ status: "dismissed", assigned_moderator_user_id: 1 }, assignedModerator)).toBe(false);
    });
  });

  describe("canRelease", () => {
    test("the assignee can release their own claim", () => {
      const report = { status: "under_review", assigned_moderator_user_id: 1 };
      expect(rules.canRelease(report, { kind: "moderator", userId: 1 })).toBe(true);
    });

    test("a different moderator cannot release someone else's claim", () => {
      const report = { status: "under_review", assigned_moderator_user_id: 1 };
      expect(rules.canRelease(report, { kind: "moderator", userId: 2 })).toBe(false);
    });

    test("admin can force-release any claim", () => {
      const report = { status: "under_review", assigned_moderator_user_id: 1 };
      expect(rules.canRelease(report, { kind: "admin", userId: 99 })).toBe(true);
    });

    test("an open (unclaimed) report cannot be released", () => {
      const report = { status: "open", assigned_moderator_user_id: null };
      expect(rules.canRelease(report, { kind: "admin", userId: 99 })).toBe(false);
    });
  });

  describe("canEscalate", () => {
    test("open and under_review reports can be escalated", () => {
      expect(rules.canEscalate({ status: "open" })).toBe(true);
      expect(rules.canEscalate({ status: "under_review" })).toBe(true);
    });

    test("already-closed or already-escalated reports cannot be escalated again", () => {
      expect(rules.canEscalate({ status: "resolved" })).toBe(false);
      expect(rules.canEscalate({ status: "dismissed" })).toBe(false);
      expect(rules.canEscalate({ status: "escalated" })).toBe(false);
    });
  });
});
