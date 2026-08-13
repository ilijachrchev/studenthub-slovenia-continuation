const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

afterAll(async () => {
  await pool.end();
});

async function loginStudent(agent) {
  await agent.post("/api/auth/login").send({
    email: "student@famnit.upr.si",
    password: "student123",
  });
}

describe("GET /api/recommendations", () => {
  test("returns deterministic student recommendations", async () => {
    const agent = request.agent(app);
    await loginStudent(agent);

    const res = await agent.get("/api/recommendations?limit=3");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);

    const [first, second] = res.body.items;
    expect(first.id).toBe(1);
    if (second) {
      expect(second.score).toBeLessThanOrEqual(first.score);
    }

    for (const item of res.body.items) {
      expect(item.score).toBeDefined();
      expect(typeof item.primary_reason).toBe("string");
      expect(Array.isArray(item.reasons)).toBe(true);
    }
  });

  test("rejects non-student users", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "organizer@studenthub.test",
      password: "organizer123",
    });

    const res = await agent.get("/api/recommendations");
    expect(res.status).toBe(403);
  });
});
