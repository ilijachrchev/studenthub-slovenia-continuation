const request = require("supertest");
const app = require("../app");
const pool = require("../db");

describe("health and readiness", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("GET /api/health returns a liveness response with request id", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.requestId).toBeDefined();
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  test("GET /api/ready returns ready when the database query succeeds", async () => {
    jest.spyOn(pool, "query").mockResolvedValue({ rows: [{ health: 1 }] });

    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
    expect(res.body.requestId).toBeDefined();
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  test("GET /api/ready returns degraded when the database is unavailable", async () => {
    jest.spyOn(pool, "query").mockRejectedValue(new Error("database unavailable"));

    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.database).toBe("disconnected");
    expect(res.body.requestId).toBeDefined();
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });
});
