const { assertTransition, normalizeStatus } = require("../lib/opportunity/statusMachine");

describe("opportunity status machine", () => {
  test("normalizes aliases to canonical statuses", () => {
    expect(normalizeStatus("submitted")).toBe("pending");
    expect(normalizeStatus("review")).toBe("under_review");
    expect(normalizeStatus("in_review")).toBe("under_review");
    expect(normalizeStatus("declined")).toBe("rejected");
  });

  test("rejects invalid statuses", () => {
    expect(() => assertTransition("bogus", "pending", "organizer")).toThrow(/Unsupported application status/);
    expect(() => assertTransition("pending", "bogus", "organizer")).toThrow(/Unsupported application status/);
  });

  test("rejects disallowed transitions", () => {
    expect(() => assertTransition("accepted", "pending", "organizer")).toThrow(/not allowed/);
    expect(() => assertTransition("pending", "withdrawn", "organizer")).toThrow(/not allowed/);
    expect(() => assertTransition("pending", "accepted", "student")).toThrow(/not allowed/);
  });

  test("rejects unsupported roles", () => {
    expect(() => assertTransition("pending", "under_review", "guest")).toThrow(/Unsupported role/);
  });

  test("allows organizer and student transitions that are supported", () => {
    expect(assertTransition("pending", "under_review", "organizer")).toEqual({
      from: "pending",
      to: "under_review",
      role: "organizer",
    });

    expect(assertTransition("pending", "withdrawn", "student")).toEqual({
      from: "pending",
      to: "withdrawn",
      role: "student",
    });
  });
});
