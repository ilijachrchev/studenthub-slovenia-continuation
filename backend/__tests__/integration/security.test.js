const request = require("supertest");
const app = require("../../app");

let organizerAgent;
let adminAgent;
let studentAgent;

beforeAll(async () => {
  organizerAgent = request.agent(app);
  await organizerAgent
    .post("/api/auth/login")
    .send({ email: "organizer@studenthub.test", password: "organizer123" });

  adminAgent = request.agent(app);
  await adminAgent
    .post("/api/auth/login")
    .send({ email: "admin@studenthub.test", password: "admin123" });

  studentAgent = request.agent(app);
  await studentAgent
    .post("/api/auth/login")
    .send({ email: "student@famnit.upr.si", password: "student123" });
});

describe("security boundaries", () => {
  test("rejects unauthenticated access to protected routes", async () => {
    const res = await request(app).get("/api/admin/events/pending");
    expect(res.status).toBe(401);
  });

  test("rejects normal users from organizer functionality", async () => {
    const res = await studentAgent.get("/api/organizer/events");
    expect(res.status).toBe(403);
  });

  test("rejects another user deleting a bookmark they do not own", async () => {
    const res = await organizerAgent.delete("/api/bookmarks/1");
    expect(res.status).toBe(404);
  });

  test("rejects malformed numeric identifiers", async () => {
    const responses = await Promise.all([
      studentAgent.post("/api/registrations/not-a-number"),
      studentAgent.delete("/api/bookmarks/not-a-number"),
      adminAgent.post("/api/admin/events/not-a-number/approve"),
      organizerAgent.post("/api/organizer/events/not-a-number/submit"),
      request(app).get("/api/events/not-a-number"),
      request(app).get("/api/organizations/not-a-number"),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(404);
    }
  });

  test("rejects nonexistent resources cleanly", async () => {
    const responses = await Promise.all([
      studentAgent.post("/api/registrations/999999"),
      studentAgent.delete("/api/bookmarks/999999"),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(404);
    }
  });
});
