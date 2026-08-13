const {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TRANSITIONS,
  assertOpportunityStatus,
  assertTransition,
  canTransition,
  normalizeOpportunityStatus,
} = require("../domain/opportunityState");

describe("opportunity lifecycle state machine", () => {
  test("exposes the canonical lifecycle statuses", () => {
    expect(OPPORTUNITY_STATUSES).toEqual([
      "draft",
      "submitted",
      "published",
      "rejected",
      "closed",
      "archived",
    ]);
  });

  test("normalizes status strings", () => {
    expect(normalizeOpportunityStatus(" Draft ")).toBe("draft");
    expect(normalizeOpportunityStatus(null)).toBeNull();
  });

  test("allows declared transitions", () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, "draft", "submitted")).toBe(true);
    expect(canTransition(OPPORTUNITY_TRANSITIONS, "submitted", "published")).toBe(true);
    expect(canTransition(OPPORTUNITY_TRANSITIONS, "closed", "published")).toBe(true);
  });

  test("rejects undeclared transitions", () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, "draft", "published")).toBe(false);
    expect(canTransition(OPPORTUNITY_TRANSITIONS, "published", "submitted")).toBe(false);
  });

  test("throws for malformed status values", () => {
    expect(() => assertOpportunityStatus("unknown")).toThrow("Unsupported opportunity status: unknown");
    expect(() => assertTransition(OPPORTUNITY_TRANSITIONS, "draft", "unknown")).toThrow(
      "Unsupported opportunity status: unknown",
    );
  });

  test("throws for repeated transitions", () => {
    expect(() => assertTransition(OPPORTUNITY_TRANSITIONS, "draft", "draft")).toThrow(
      "Cannot transition opportunity from draft to draft",
    );
  });

  test("throws for invalid state changes", () => {
    expect(() => assertTransition(OPPORTUNITY_TRANSITIONS, "submitted", "closed")).toThrow(
      "Cannot transition opportunity from submitted to closed",
    );
  });
});
