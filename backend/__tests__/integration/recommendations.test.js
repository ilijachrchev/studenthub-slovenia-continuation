const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

async function login(email, password) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Failed to login as ${email}: ${response.status}`);
  }
  return agent;
}

describe("Recommendation discovery", () => {
  let studentAgent;
  let organizerAgent;

  beforeAll(async () => {
    studentAgent = await login("student@famnit.upr.si", "student123");
    organizerAgent = await login("organizer@studenthub.test", "organizer123");
  });

  afterAll(async () => {
    await pool.end();
  });

  test("rejects unauthenticated and non-student access", async () => {
    const guestResponse = await request(app).get("/api/recommendations");
    expect(guestResponse.status).toBe(401);

    const organizerResponse = await organizerAgent.get("/api/recommendations");
    expect(organizerResponse.status).toBe(403);
  });

  test("returns deterministic, paginated recommendations for students", async () => {
    const first = await studentAgent.get("/api/recommendations?limit=2&page=1");
    const second = await studentAgent.get("/api/recommendations?limit=2&page=1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstIds = first.body.items.map((item) => item.id);
    const secondIds = second.body.items.map((item) => item.id);

    expect(firstIds).toEqual(secondIds);
    expect(first.body.page).toBe(1);
    expect(first.body.limit).toBe(2);
    expect(first.body.items.length).toBeLessThanOrEqual(2);
    expect(first.body.total).toBeGreaterThanOrEqual(first.body.items.length);
    expect(first.body.hasMore).toBe(first.body.total > first.body.items.length);
    expect(first.body.opportunities).toEqual(first.body.items);
    expect(first.body.items.every((item) => typeof item.score === "number")).toBe(true);
    expect(first.body.items.every((item) => typeof item.primary_reason === "string")).toBe(true);
    expect(firstIds).not.toContain(1);
    expect(firstIds).not.toContain(5);
    expect(firstIds).not.toContain(6);
  });

  test("filters and empty results behave cleanly", async () => {
    const filtered = await studentAgent.get("/api/recommendations?search=documentation&limit=10");
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.every((item) => /documentation/i.test(item.title || item.description || ""))).toBe(true);

    const past = await studentAgent.get("/api/recommendations?deadline=past&limit=10");
    expect(past.status).toBe(200);
    expect(past.body.items).toEqual([]);
    expect(past.body.total).toBe(0);

    const empty = await studentAgent.get("/api/recommendations?search=does-not-exist-12345");
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
    expect(empty.body.total).toBe(0);
  });

  test("pagination returns stable slices", async () => {
    const pageOne = await studentAgent.get("/api/recommendations?limit=1&page=1");
    const pageTwo = await studentAgent.get("/api/recommendations?limit=1&page=2");

    expect(pageOne.status).toBe(200);
    expect(pageTwo.status).toBe(200);
    expect(pageOne.body.items).toHaveLength(1);
    expect(pageTwo.body.items.length).toBeLessThanOrEqual(1);

    if (pageTwo.body.items.length === 1) {
      expect(pageOne.body.items[0].id).not.toBe(pageTwo.body.items[0].id);
    }
  });
});
