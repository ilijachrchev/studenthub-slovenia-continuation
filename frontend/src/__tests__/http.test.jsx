import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, getApiErrorMessage, requestJson } from "../api/http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  test("parses json and defaults to credentials include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const data = await requestJson("/api/example", {
      method: "POST",
      body: { hello: "world" },
    });

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/example",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
      })
    );
  });

  test("maps validation failures to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid data" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(requestJson("/api/example")).rejects.toMatchObject({
      status: 422,
      code: "validation_error",
      message: "Invalid data",
    });
  });

  test("turns network failures into ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(requestJson("/api/example")).rejects.toBeInstanceOf(ApiError);
    await expect(requestJson("/api/example")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });
});

describe("getApiErrorMessage", () => {
  test("formats common statuses", () => {
    expect(
      getApiErrorMessage(new ApiError({ status: 401, code: "unauthorized", message: "Sign in" }))
    ).toBe("Please sign in to continue.");
    expect(
      getApiErrorMessage(new ApiError({ status: 429, code: "rate_limited", message: "" }))
    ).toBe("Too many requests. Please wait and try again.");
  });
});
