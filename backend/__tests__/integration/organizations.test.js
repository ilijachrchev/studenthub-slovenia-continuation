const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let studentAgent, organizerAgent, orgId;

beforeAll(async () => {
  // Register a student
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Org",
      last_name: "Student",
      email: "org-student@famnit.upr.si",
      password: "testpass123",
      role: "student",
    });

  // Register an organizer
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Org",
      last_name: "Manager",
      email: "org-manager@test.com",
      password: "testpass123",
      role: "organizer",
    });

  // Create logged-in agents
  studentAgent = request.agent(app);
  await studentAgent
    .post("/api/auth/login")
    .send({ email: "org-student@famnit.upr.si", password: "testpass123" });

  organizerAgent = request.agent(app);
  await organizerAgent
    .post("/api/auth/login")
    .send({ email: "org-manager@test.com", password: "testpass123" });

  // Create an organization
  const createRes = await organizerAgent
    .post("/api/organizations")
    .send({
      name: "Test Organization",
      description: "A test org",
      contact_email: "org@test.com",
      website: "https://test.org",
    });
  orgId = createRes.body.organizationId;

  // Approve the organization
  await pool.query(
    "UPDATE organization SET status = 'approved', approved_at = NOW() WHERE id = $1",
    [orgId]
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM organization_follower WHERE organization_id = $1",
    [orgId]
  );
  await pool.query(
    "DELETE FROM organizer_profile WHERE organization_id = $1",
    [orgId]
  );
  await pool.query(
    "DELETE FROM organization WHERE id = $1",
    [orgId]
  );
  await pool.query(
    'DELETE FROM "user" WHERE email IN ($1, $2)',
    ["org-student@famnit.upr.si", "org-manager@test.com"]
  );
  await pool.end();
});

describe("Organization profiles", () => {
  test("GET /api/organizations/:id returns public profile with social links", async () => {
    // Add social links
    await pool.query(
      `UPDATE organization SET facebook = 'https://fb.com/test', instagram = 'https://ig.com/test'
       WHERE id = $1`,
      [orgId]
    );

    const res = await request(app).get(`/api/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.organization.name).toBe("Test Organization");
    expect(res.body.organization.description).toBe("A test org");
    expect(res.body.organization.facebook).toBe("https://fb.com/test");
    expect(res.body.organization.instagram).toBe("https://ig.com/test");
    expect(res.body.organization.follower_count).toBeDefined();
    expect(res.body.organization.is_following).toBe(false);
    expect(Array.isArray(res.body.upcoming)).toBe(true);
    expect(Array.isArray(res.body.past)).toBe(true);
  });

  test("GET /api/organizations/:id/members returns member list", async () => {
    const res = await request(app).get(`/api/organizations/${orgId}/members`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThanOrEqual(1);
    expect(res.body.members[0].role_in_org).toBe("owner");
  });

  test("PUT /api/organizations/:id updates profile (owner only)", async () => {
    const res = await organizerAgent
      .put(`/api/organizations/${orgId}`)
      .send({
        description: "Updated description",
        facebook: "https://fb.com/updated",
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated/i);

    // Verify update
    const profileRes = await request(app).get(`/api/organizations/${orgId}`);
    expect(profileRes.body.organization.description).toBe("Updated description");
    expect(profileRes.body.organization.facebook).toBe("https://fb.com/updated");
  });

  test("PUT /api/organizations/:id rejects non-owner", async () => {
    const res = await studentAgent
      .put(`/api/organizations/${orgId}`)
      .send({ description: "Hacked" });
    expect(res.status).toBe(403);
  });
});

describe("Organization following", () => {
  test("POST /api/organizations/:id/follow follows an org", async () => {
    const res = await studentAgent.post(`/api/organizations/${orgId}/follow`);
    expect([200, 201]).toContain(res.status);
  });

  test("POST /api/organizations/:id/follow is idempotent", async () => {
    const res = await studentAgent.post(`/api/organizations/${orgId}/follow`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already following/i);
  });

  test("GET /api/organizations/:id shows is_following", async () => {
    const res = await studentAgent.get(`/api/organizations/${orgId}`);
    expect(res.body.organization.is_following).toBe(true);
    expect(res.body.organization.follower_count).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/organizations/followed lists followed orgs", async () => {
    const res = await studentAgent.get("/api/organizations/followed");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.organizations)).toBe(true);
    expect(res.body.organizations.length).toBeGreaterThanOrEqual(1);
  });

  test("DELETE /api/organizations/:id/follow unfollows an org", async () => {
    const res = await studentAgent.delete(`/api/organizations/${orgId}/follow`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/unfollowed/i);
  });

  test("DELETE /api/organizations/:id/follow returns 404 if not following", async () => {
    const res = await studentAgent.delete(`/api/organizations/${orgId}/follow`);
    expect(res.status).toBe(404);
  });

  test("follow endpoints require auth", async () => {
    const followRes = await request(app).post(`/api/organizations/${orgId}/follow`);
    expect(followRes.status).toBe(401);

    const unfollowRes = await request(app).delete(`/api/organizations/${orgId}/follow`);
    expect(unfollowRes.status).toBe(401);

    const listRes = await request(app).get("/api/organizations/followed");
    expect(listRes.status).toBe(401);
  });
});
