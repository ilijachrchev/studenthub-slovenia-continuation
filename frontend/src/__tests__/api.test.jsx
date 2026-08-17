import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, ApiError, isApiError, getApiErrorMessage } from "../lib/api";

describe("apiRequest", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("defaults to include credentials and parses JSON responses", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true }),
    });

    await expect(apiRequest("/api/test")).resolves.toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({ credentials: "include" }));
  });

  test("normalizes API errors with status and response data", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: "Forbidden" }),
    });

    await expect(apiRequest("/api/test")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Forbidden",
      data: { error: "Forbidden" },
    });
  });

  test("handles empty successful responses", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: async () => "",
    });

    await expect(apiRequest("/api/test", { method: "POST" })).resolves.toBeNull();
  });

  test("serializes plain-object request bodies as JSON", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true }),
    });

    await apiRequest("/api/test", { method: "POST", body: { hello: "world" } });

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
  });
});

describe("api error helpers", () => {
  test("identifies ApiError instances", () => {
    const error = new ApiError("Boom", { status: 401 });
    expect(isApiError(error)).toBe(true);
    expect(getApiErrorMessage(error, "Fallback")).toBe("Boom");
  });
});
