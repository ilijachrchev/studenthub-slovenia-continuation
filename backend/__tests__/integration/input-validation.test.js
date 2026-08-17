const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

describe("Input validation and duplicate-write hardening", () => {
  const agent = request.agent(app);

  beforeAll(async () => {
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });
  });

  afterAll(async () => {
    await pool.end();
  });

  test("rejects invalid registration ids instead of querying the database", async () => {
    const res = await agent.post("/api/registrations/not-a-number");
    expect(res.status).toBe(404);
  });

  test("rejects invalid bookmark ids instead of querying the database", async () => {
    const res = await agent.post("/api/bookmarks/not-a-number");
    expect(res.status).toBe(404);
  });

  test("rejects invalid feedback ids instead of querying the database", async () => {
    const res = await agent.post("/api/feedback/not-a-number").send({
      rating: 5,
      comment: "Great",
    });

    expect(res.status).toBe(404);
  });

  test("returns a clean conflict for duplicate bookmarks", async () => {
    const res = await agent.post("/api/bookmarks/1");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already saved/i);
  });

  test("returns a clean conflict for duplicate feedback", async () => {
    const res = await agent.post("/api/feedback/6").send({
      rating: 5,
      comment: "Still great",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already left feedback/i);
  });
});
