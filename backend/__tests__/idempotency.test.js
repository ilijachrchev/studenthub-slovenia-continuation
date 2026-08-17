const {
  extractKey,
  hashRequest,
  checkIdempotency,
  storeIdempotentResponse,
} = require("../lib/opportunity/idempotency");

function fakeReq(headerValue) {
  return {
    get(name) {
      if (name.toLowerCase() === "idempotency-key") {
        return headerValue;
      }
      return undefined;
    },
  };
}

function fakeClient(existingRows = []) {
  return {
    calls: [],
    query(sql, params) {
      this.calls.push({ sql, params });
      if (sql.includes("SELECT response_status")) {
        return Promise.resolve({ rows: existingRows });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

describe("idempotency helper", () => {
  describe("extractKey", () => {
    test("reads the Idempotency-Key header", () => {
      expect(extractKey(fakeReq("abc-123"))).toBe("abc-123");
    });

    test("trims whitespace", () => {
      expect(extractKey(fakeReq("  abc-123  "))).toBe("abc-123");
    });

    test("returns null when absent", () => {
      expect(extractKey(fakeReq(undefined))).toBeNull();
    });

    test("returns null for an empty/whitespace-only key", () => {
      expect(extractKey(fakeReq("   "))).toBeNull();
    });

    test("rejects keys over the length limit", () => {
      expect(extractKey(fakeReq("x".repeat(300)))).toBeNull();
    });
  });

  describe("hashRequest", () => {
    test("is deterministic for the same payload", () => {
      const a = hashRequest({ to: "published", id: 1 });
      const b = hashRequest({ to: "published", id: 1 });
      expect(a).toBe(b);
    });

    test("differs for different payloads", () => {
      const a = hashRequest({ to: "published" });
      const b = hashRequest({ to: "closed" });
      expect(a).not.toBe(b);
    });

    test("handles null/undefined payload without throwing", () => {
      expect(() => hashRequest(undefined)).not.toThrow();
      expect(() => hashRequest(null)).not.toThrow();
    });
  });

  describe("checkIdempotency", () => {
    test("returns replay:false, conflict:false when no key supplied", async () => {
      const client = fakeClient();
      const result = await checkIdempotency(client, {
        scope: "opportunity.transition",
        key: null,
        userId: 1,
        requestBody: { to: "published" },
      });
      expect(result).toEqual({ replay: false, conflict: false, key: null });
      expect(client.calls.length).toBe(0); // no wasted query when there's no key
    });

    test("returns replay:false, conflict:false for a fresh key", async () => {
      const client = fakeClient([]);
      const result = await checkIdempotency(client, {
        scope: "opportunity.transition",
        key: "key-1",
        userId: 1,
        requestBody: { to: "published" },
      });
      expect(result.replay).toBe(false);
      expect(result.conflict).toBe(false);
      expect(result.key).toBe("key-1");
    });

    test("returns replay:true with the stored response for a matching replay", async () => {
      const requestBody = { to: "published" };
      const requestHash = hashRequest(requestBody);
      const client = fakeClient([
        { response_status: 200, response_body: { ok: true }, request_hash: requestHash },
      ]);

      const result = await checkIdempotency(client, {
        scope: "opportunity.transition",
        key: "key-1",
        userId: 1,
        requestBody,
      });

      expect(result.replay).toBe(true);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
    });

    test("returns conflict:true when the same key is reused for a different payload", async () => {
      const client = fakeClient([
        { response_status: 200, response_body: { ok: true }, request_hash: hashRequest({ to: "published" }) },
      ]);

      const result = await checkIdempotency(client, {
        scope: "opportunity.transition",
        key: "key-1",
        userId: 1,
        requestBody: { to: "archived" },
      });

      expect(result.replay).toBe(false);
      expect(result.conflict).toBe(true);
    });
  });

  describe("storeIdempotentResponse", () => {
    test("is a no-op when no key is supplied", async () => {
      const client = fakeClient();
      await storeIdempotentResponse(client, {
        scope: "opportunity.transition",
        key: null,
        userId: 1,
        requestHash: "abc",
        status: 200,
        body: {},
      });
      expect(client.calls.length).toBe(0);
    });

    test("inserts a row when a key is supplied", async () => {
      const client = fakeClient();
      await storeIdempotentResponse(client, {
        scope: "opportunity.transition",
        key: "key-1",
        userId: 1,
        requestHash: "abc",
        status: 200,
        body: { ok: true },
      });
      expect(client.calls.length).toBe(1);
      expect(client.calls[0].sql).toMatch(/INSERT INTO idempotency_key/);
      expect(client.calls[0].sql).toMatch(/ON CONFLICT/);
    });
  });
});
