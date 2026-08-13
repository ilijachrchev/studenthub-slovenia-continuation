const request = require("supertest");
const pool = require("../../db");

function freshApp() {
  delete require.cache[require.resolve("../../app")];
  return require("../../app");
}

function cookieHeaderFrom(res) {
  const cookies = res.headers["set-cookie"] || [];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

afterAll(async () => {
  await pool.end();
});

async function getUserIdByEmail(email) {
  const { rows } = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
  return rows[0] ? rows[0].id : null;
}

describe("Mutation rate limits", () => {
  test("notifications preferences are rate limited", async () => {
    const app = freshApp();
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const bodies = [
      { preferences: { "application.received": true } },
      { preferences: { "application.received": false } },
      { preferences: { "application.received": true } },
      { preferences: { "application.received": false } },
    ];

    const statuses = [];
    for (const body of bodies) {
      const res = await agent.put("/api/notifications/preferences").send(body);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3).every((status) => status === 200)).toBe(true);
    expect(statuses[3]).toBe(429);
  });
});

describe("Session persistence", () => {
  test("session survives app restart and is revoked on logout", async () => {
    const app1 = freshApp();
    const loginRes = await request(app1)
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    expect(loginRes.status).toBe(200);
    const cookieHeader = cookieHeaderFrom(loginRes);
    expect(cookieHeader).toBeTruthy();

    const app2 = freshApp();
    const meBeforeLogout = await request(app2)
      .get("/api/auth/me")
      .set("Cookie", cookieHeader);
    expect(meBeforeLogout.status).toBe(200);
    expect(meBeforeLogout.body.user.email).toBe("student@famnit.upr.si");

    const logoutRes = await request(app1)
      .post("/api/auth/logout")
      .set("Cookie", cookieHeader);
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await request(app2)
      .get("/api/auth/me")
      .set("Cookie", cookieHeader);
    expect(meAfterLogout.status).toBe(401);
  });
});

describe("Application boundaries", () => {
  const temp = {};

  beforeAll(async () => {
    const app = freshApp();

    await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Other",
        last_name: "Organizer",
        email: "security-other-organizer@test.com",
        password: "testpass123",
        role: "organizer",
      });

    await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Other",
        last_name: "Student",
        email: "security-other-student@famnit.upr.si",
        password: "testpass123",
        role: "student",
      });

    temp.otherOrganizerId = await getUserIdByEmail("security-other-organizer@test.com");
    temp.otherStudentId = await getUserIdByEmail("security-other-student@famnit.upr.si");
    temp.ownerId = await getUserIdByEmail("organizer@studenthub.test");
    temp.studentId = await getUserIdByEmail("student@famnit.upr.si");

    const { rows: orgRows } = await pool.query(
      `INSERT INTO organization (name, description, logo, website, contact_email, university_id, status, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', NOW())
       RETURNING id`,
      [
        "Security Test Org",
        "Temporary organization for security tests",
        null,
        null,
        "security-org@test.com",
        1,
      ]
    );
    temp.organizationId = orgRows[0].id;

    await pool.query(
      "INSERT INTO organizer_profile (user_id, organization_id, role_in_org) VALUES ($1, $2, 'owner')",
      [temp.otherOrganizerId, temp.organizationId]
    );

    const { rows: opportunityRows } = await pool.query(
      `INSERT INTO opportunity (organization_id, title, description, location, status, deadline, created_at)
       VALUES ($1, $2, $3, $4, 'published', NOW() + INTERVAL '7 days', NOW())
       RETURNING id`,
      [
        temp.organizationId,
        "Security Test Opportunity",
        "Temporary opportunity for security tests",
        "Test location",
      ]
    );
    temp.opportunityId = opportunityRows[0].id;

    const { rows: applicationRows } = await pool.query(
      `INSERT INTO application (opportunity_id, applicant_user_id, cover_note, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', NOW(), NOW())
       RETURNING id`,
      [temp.opportunityId, temp.studentId, "Temporary cover note"]
    );
    temp.applicationId = applicationRows[0].id;
  });

  afterAll(async () => {
    if (temp.applicationId) {
      await pool.query("DELETE FROM application_history WHERE application_id = $1", [temp.applicationId]);
      await pool.query("DELETE FROM application WHERE id = $1", [temp.applicationId]);
    }
    if (temp.opportunityId) {
      await pool.query("DELETE FROM opportunity WHERE id = $1", [temp.opportunityId]);
    }
    if (temp.organizationId) {
      await pool.query("DELETE FROM organizer_profile WHERE organization_id = $1", [temp.organizationId]);
      await pool.query("DELETE FROM organization WHERE id = $1", [temp.organizationId]);
    }

    await pool.query(
      'DELETE FROM "user" WHERE email IN ($1, $2)',
      ["security-other-organizer@test.com", "security-other-student@famnit.upr.si"]
    );
  });

  test("applicant can read their own application history", async () => {
    const app = freshApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const res = await agent.get(`/api/applications/${temp.applicationId}/history`);
    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe(temp.applicationId);
  });

  test("other student cannot read someone else's application history", async () => {
    const app = freshApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "security-other-student@famnit.upr.si", password: "testpass123" });

    const res = await agent.get(`/api/applications/${temp.applicationId}/history`);
    expect(res.status).toBe(404);
  });

  test("other organizer cannot list applications for another organizer's opportunity", async () => {
    const app = freshApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "organizer@studenthub.test", password: "organizer123" });

    const res = await agent.get(`/api/applications/opportunities/${temp.opportunityId}/applications`);
    expect(res.status).toBe(404);
  });

  test("invalid application ids return 404 on transitions", async () => {
    const app = freshApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const res = await agent
      .post("/api/applications/not-a-number/transition")
      .send({ from: "pending", to: "withdrawn" });

    expect(res.status).toBe(404);
  });
});
