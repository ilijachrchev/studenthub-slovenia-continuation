import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiRequest, ApiError } from "../lib/api";

describe("apiRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("serializes plain object bodies as JSON", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ ok: true }),
    });

    const result = await apiRequest("/api/example", {
      method: "POST",
      body: { hello: "world" },
    });

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "/api/example",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ hello: "world" }),
      }),
    );
  });

  test("throws ApiError for non-ok responses", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ error: "Forbidden" }),
    });

    const promise = apiRequest("/api/example");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 403,
      message: "Forbidden",
    });
  });

  test("surfaces aborted requests with an aborted code", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce((_, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const promise = apiRequest("/api/example", { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: "aborted",
      message: "Request aborted",
    });
  });
});
