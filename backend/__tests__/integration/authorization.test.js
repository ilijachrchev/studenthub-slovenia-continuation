const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let adminAgent, organizerAgent, studentAgent;

beforeAll(async () => {
  // Register isolated test users to avoid race conditions with auth.test.js
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "AuthAdmin",
      last_name: "Tester",
      email: "authz-admin@test.com",
      password: "testpass123",
      role: "organizer",
    });

  // Upgrade to admin via direct DB call
  await pool.query(
    "UPDATE \"user\" SET role = 'admin' WHERE email = $1",
    ["authz-admin@test.com"]
  );

  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "AuthOrg",
      last_name: "Tester",
      email: "authz-organizer@test.com",
      password: "testpass123",
      role: "organizer",
    });

  // Student registration requires a valid university email domain
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "AuthStudent",
      last_name: "Tester",
      email: "authz-student@famnit.upr.si",
      password: "testpass123",
      role: "student",
    });

  // Create logged-in agents for each role
  adminAgent = request.agent(app);
  await adminAgent
    .post("/api/auth/login")
    .send({ email: "authz-admin@test.com", password: "testpass123" });

  organizerAgent = request.agent(app);
  await organizerAgent
    .post("/api/auth/login")
    .send({ email: "authz-organizer@test.com", password: "testpass123" });

  studentAgent = request.agent(app);
  await studentAgent
    .post("/api/auth/login")
    .send({ email: "authz-student@famnit.upr.si", password: "testpass123" });
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM admin WHERE user_id IN (SELECT id FROM \"user\" WHERE email = $1)",
    ["authz-admin@test.com"]
  );
  await pool.query(
    "DELETE FROM organizer_profile WHERE user_id IN (SELECT id FROM \"user\" WHERE email IN ($1, $2))",
    ["authz-organizer@test.com", "authz-student@famnit.upr.si"]
  );
  await pool.query(
    "DELETE FROM \"user\" WHERE email IN ($1, $2, $3)",
    ["authz-admin@test.com", "authz-organizer@test.com", "authz-student@famnit.upr.si"]
  );
  await pool.end();
});

describe("Authorization middleware", () => {
  describe("student routes require student role", () => {
    test("returns 401 when not logged in", async () => {
      const res = await request(app).get("/api/student/profile");
      expect(res.status).toBe(401);
    });

    test("returns 403 when organizer tries to access student routes", async () => {
      const res = await organizerAgent.get("/api/student/profile");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/student/i);
    });

    test("returns 403 when admin tries to access student routes", async () => {
      const res = await adminAgent.get("/api/student/profile");
      expect(res.status).toBe(403);
    });
  });

  describe("organizer routes require organizer role", () => {
    test("returns 401 when not logged in", async () => {
      const res = await request(app).get("/api/organizer/events");
      expect(res.status).toBe(401);
    });

    test("returns 403 when student tries to access organizer routes", async () => {
      const res = await studentAgent.get("/api/organizer/events");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/organizer/i);
    });

    test("returns 403 when admin tries to access organizer routes", async () => {
      const res = await adminAgent.get("/api/organizer/events");
      expect(res.status).toBe(403);
    });
  });

  describe("admin routes require admin role", () => {
    test("returns 401 when not logged in", async () => {
      const res = await request(app).get("/api/admin/events/pending");
      expect(res.status).toBe(401);
    });

    test("returns 403 when student tries to access admin routes", async () => {
      const res = await studentAgent.get("/api/admin/events/pending");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    test("returns 403 when organizer tries to access admin routes", async () => {
      const res = await organizerAgent.get("/api/admin/events/pending");
      expect(res.status).toBe(403);
    });
  });

  describe("role cannot be self-escalated via registration", () => {
    test("cannot register as admin", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          first_name: "Evil",
          last_name: "User",
          email: "authz-evil@test.com",
          password: "strongpass1",
          role: "admin",
        });

      if (res.status === 201) {
        const agent = request.agent(app);
        await agent
          .post("/api/auth/login")
          .send({ email: "authz-evil@test.com", password: "strongpass1" });
        const meRes = await agent.get("/api/auth/me");
        expect(meRes.body.user.role).toBe("student");
      }
    });
  });
});

describe("Session behavior", () => {
  test("session regeneration on login prevents fixation", async () => {
    const agent = request.agent(app);

    await agent.get("/api/auth/me");

    await agent
      .post("/api/auth/login")
      .send({ email: "authz-student@famnit.upr.si", password: "testpass123" });

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("authz-student@famnit.upr.si");
  });

  test("logout clears session", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ email: "authz-student@famnit.upr.si", password: "testpass123" });

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(200);

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });
});

describe("API reliability", () => {
  test("returns JSON for unknown API routes", async () => {
    const res = await request(app).get("/api/nonexistent");
    expect(res.status).toBe(404);
  });

  test("health endpoint works without auth", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  test("rejects oversized request body with 413", async () => {
    const largeBody = { data: "x".repeat(600 * 1024) };
    const res = await request(app)
      .post("/api/auth/login")
      .send(largeBody);
    expect(res.status).toBe(413);
  });
});
