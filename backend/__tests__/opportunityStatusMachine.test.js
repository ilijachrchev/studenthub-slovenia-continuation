const {
  STATUSES,
  normalizeStatus,
  isValidStatus,
  assertTransition,
  timestampColumnFor,
} = require("../lib/opportunity/opportunityStatusMachine");

describe("opportunityStatusMachine", () => {
  describe("normalizeStatus / isValidStatus", () => {
    test("lowercases and trims", () => {
      expect(normalizeStatus("  Published ")).toBe("published");
    });

    test("rejects non-strings", () => {
      expect(normalizeStatus(null)).toBeNull();
      expect(normalizeStatus(42)).toBeNull();
      expect(normalizeStatus(undefined)).toBeNull();
    });

    test("recognizes every declared status", () => {
      for (const status of STATUSES) {
        expect(isValidStatus(status)).toBe(true);
      }
      expect(isValidStatus("deleted")).toBe(false);
    });
  });

  describe("assertTransition — organizer", () => {
    test("allows draft -> published", () => {
      const result = assertTransition("draft", "published", "organizer");
      expect(result).toEqual({ from: "draft", to: "published", role: "organizer" });
    });

    test("allows published -> closed", () => {
      expect(() => assertTransition("published", "closed", "organizer")).not.toThrow();
    });

    test("allows closed -> archived and closed -> published (reopen)", () => {
      expect(() => assertTransition("closed", "archived", "organizer")).not.toThrow();
      expect(() => assertTransition("closed", "published", "organizer")).not.toThrow();
    });

    test("rejects published -> draft (no going back to draft)", () => {
      expect(() => assertTransition("published", "draft", "organizer")).toThrow(
        /not allowed/
      );
    });

    test("rejects archived -> anything (terminal state)", () => {
      expect(() => assertTransition("archived", "draft", "organizer")).toThrow();
      expect(() => assertTransition("archived", "published", "organizer")).toThrow();
    });

    test("rejects a no-op transition (from === to)", () => {
      expect(() => assertTransition("published", "published", "organizer")).toThrow();
    });

    test("invalid transition throws a 409 with a clear message", () => {
      try {
        assertTransition("draft", "closed", "organizer");
        throw new Error("expected assertTransition to throw");
      } catch (error) {
        expect(error.status).toBe(409);
        expect(error.message).toMatch(/draft -> closed/);
      }
    });
  });

  describe("assertTransition — admin", () => {
    test("admin can force-archive a published opportunity directly (moderation takedown)", () => {
      expect(() => assertTransition("published", "archived", "admin")).not.toThrow();
    });

    test("admin cannot resurrect an archived opportunity", () => {
      expect(() => assertTransition("archived", "published", "admin")).toThrow();
    });
  });

  describe("assertTransition — input safety", () => {
    test("rejects unknown from-status with 400", () => {
      try {
        assertTransition("bogus", "published", "organizer");
        throw new Error("expected throw");
      } catch (error) {
        expect(error.status).toBe(400);
      }
    });

    test("rejects unknown to-status with 400", () => {
      try {
        assertTransition("draft", "bogus", "organizer");
        throw new Error("expected throw");
      } catch (error) {
        expect(error.status).toBe(400);
      }
    });

    test("rejects unknown role with 403 (clients cannot invent privileges)", () => {
      try {
        assertTransition("draft", "published", "student");
        throw new Error("expected throw");
      } catch (error) {
        expect(error.status).toBe(403);
      }
    });

    test("is case-insensitive and trims whitespace", () => {
      expect(() => assertTransition(" Draft ", " PUBLISHED ", " Organizer ")).not.toThrow();
    });
  });

  describe("timestampColumnFor", () => {
    test("maps published/closed/archived to their timestamp columns", () => {
      expect(timestampColumnFor("published")).toBe("published_at");
      expect(timestampColumnFor("closed")).toBe("closed_at");
      expect(timestampColumnFor("archived")).toBe("archived_at");
    });

    test("returns null for draft (no dedicated timestamp column)", () => {
      expect(timestampColumnFor("draft")).toBeNull();
    });
  });
});
