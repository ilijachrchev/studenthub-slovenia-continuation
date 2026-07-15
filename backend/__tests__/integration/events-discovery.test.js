const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let studentAgent, organizerAgent, otherOrgAgent, adminAgent;
let orgId, otherOrgId, eventId;

beforeAll(async () => {
  await request(app)
    .post("/api/auth/register")
    .send({ first_name: "Disc", last_name: "Student", email: "disc-student@famnit.upr.si", password: "testpass123", role: "student" });
  await request(app)
    .post("/api/auth/register")
    .send({ first_name: "Disc", last_name: "Org", email: "disc-org@test.com", password: "testpass123", role: "organizer" });
  await request(app)
    .post("/api/auth/register")
    .send({ first_name: "Other", last_name: "Org", email: "disc-other-org@test.com", password: "testpass123", role: "organizer" });

  studentAgent = request.agent(app);
  await studentAgent.post("/api/auth/login").send({ email: "disc-student@famnit.upr.si", password: "testpass123" });

  organizerAgent = request.agent(app);
  await organizerAgent.post("/api/auth/login").send({ email: "disc-org@test.com", password: "testpass123" });

  otherOrgAgent = request.agent(app);
  await otherOrgAgent.post("/api/auth/login").send({ email: "disc-other-org@test.com", password: "testpass123" });

  // Create and approve org
  const orgRes = await organizerAgent.post("/api/organizations").send({ name: "Disc Org", contact_email: "disc@org.com" });
  orgId = orgRes.body.organizationId;
  await pool.query("UPDATE organization SET status = 'approved', approved_at = NOW() WHERE id = $1", [orgId]);

  // Create second org for cross-org testing
  const otherOrgRes = await otherOrgAgent.post("/api/organizations").send({ name: "Other Org", contact_email: "disc-other@org.com" });
  otherOrgId = otherOrgRes.body.organizationId;
  await pool.query("UPDATE organization SET status = 'approved', approved_at = NOW() WHERE id = $1", [otherOrgId]);

  // Create a published event
  const eventRes = await organizerAgent.post("/api/organizer/events").send({
    title: "Test Discovery Event",
    location: "Ljubljana",
    start_datetime: new Date(Date.now() + 86400000).toISOString(),
    end_datetime: new Date(Date.now() + 172800000).toISOString(),
    registration_type: "built_in",
    capacity: 50,
    tag_ids: [1],
    target_faculty_ids: [1],
  });
  eventId = eventRes.body.eventId;
  await pool.query("UPDATE event SET status = 'published' WHERE id = $1", [eventId]);

  // Create an admin agent: insert user + admin record directly
  const bcrypt = require("bcryptjs");
  const { rows: adminUser } = await pool.query(
    'INSERT INTO "user" (first_name, last_name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ["Disc", "Admin", "disc-admin@test.com", await bcrypt.hash("testpass123", 10), "admin"]
  );
  await pool.query("INSERT INTO admin (user_id) VALUES ($1)", [adminUser[0].id]);
  adminAgent = request.agent(app);
  await adminAgent.post("/api/auth/login").send({ email: "disc-admin@test.com", password: "testpass123" });
});

afterAll(async () => {
  // Delete all child records of events owned by these orgs
  const { rows: orgEvents } = await pool.query(
    "SELECT id FROM event WHERE organization_id IN ($1, $2)", [orgId, otherOrgId]
  );
  const eventIds = orgEvents.map((e) => e.id);
  if (eventIds.length > 0) {
    const ph = eventIds.map((_, i) => `$${i + 1}`).join(",");
    await pool.query(`DELETE FROM event_tag WHERE event_id IN (${ph})`, eventIds);
    await pool.query(`DELETE FROM event_target WHERE event_id IN (${ph})`, eventIds);
    await pool.query(`DELETE FROM registration WHERE event_id IN (${ph})`, eventIds);
    await pool.query(`DELETE FROM event WHERE id IN (${ph})`, eventIds);
  }
  await pool.query("DELETE FROM organizer_profile WHERE organization_id IN ($1, $2)", [orgId, otherOrgId]);
  await pool.query("DELETE FROM organization WHERE id IN ($1, $2)", [orgId, otherOrgId]);
  await pool.query('DELETE FROM admin WHERE user_id IN (SELECT id FROM "user" WHERE email = $1)', ["disc-admin@test.com"]);
  await pool.query('DELETE FROM "user" WHERE email IN ($1, $2, $3, $4)', ["disc-student@famnit.upr.si", "disc-org@test.com", "disc-other-org@test.com", "disc-admin@test.com"]);
  await pool.end();
});

describe("Event discovery filtering", () => {
  test("GET /api/events returns events with default sort", async () => {
    const res = await request(app).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.body.events).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBe(1);
  });

  test("supports sort=newest", async () => {
    const res = await request(app).get("/api/events?sort=newest");
    expect(res.status).toBe(200);
  });

  test("supports sort=popularity", async () => {
    const res = await request(app).get("/api/events?sort=popularity");
    expect(res.status).toBe(200);
  });

  test("supports faculty filter", async () => {
    const res = await request(app).get("/api/events?faculty=1");
    expect(res.status).toBe(200);
  });

  test("supports tag filter", async () => {
    const res = await request(app).get("/api/events?tag=1");
    expect(res.status).toBe(200);
  });

  test("supports organization filter", async () => {
    const res = await request(app).get(`/api/events?organization=${orgId}`);
    expect(res.status).toBe(200);
  });

  test("supports location filter", async () => {
    const res = await request(app).get("/api/events?location=Ljubljana");
    expect(res.status).toBe(200);
  });

  test("supports date range filters", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
    const res = await request(app).get(`/api/events?date_from=${tomorrow}&date_to=${nextWeek}`);
    expect(res.status).toBe(200);
  });

  test("supports pagination", async () => {
    const res = await request(app).get("/api/events?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
  });
});

describe("Event lifecycle", () => {
  test("organizer can cancel a draft event", async () => {
    const createRes = await organizerAgent.post("/api/organizer/events").send({
      title: "Draft to Cancel",
      location: "Test",
      start_datetime: new Date(Date.now() + 86400000).toISOString(),
      end_datetime: new Date(Date.now() + 172800000).toISOString(),
      registration_type: "none",
      tag_ids: [1],
      target_faculty_ids: [1],
    });
    const draftId = createRes.body.eventId;

    const cancelRes = await organizerAgent.post(`/api/organizer/events/${draftId}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.message).toMatch(/cancelled/i);

    const { rows } = await pool.query("SELECT status FROM event WHERE id = $1", [draftId]);
    expect(rows[0].status).toBe("cancelled");
  });

  test("organizer cannot cancel another org's event", async () => {
    const cancelRes = await otherOrgAgent.post(`/api/organizer/events/${eventId}/cancel`);
    expect(cancelRes.status).toBe(404);
  });

  test("admin can archive a published event", async () => {
    const archiveRes = await adminAgent.post(`/api/admin/events/${eventId}/archive`);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.message).toMatch(/archived/i);
  });

  test("archived event is no longer visible in public listing", async () => {
    const res = await request(app).get(`/api/events?organization=${orgId}`);
    const found = res.body.events.find((e) => e.id === eventId);
    expect(found).toBeUndefined();
  });
});

describe("Analytics", () => {
  test("admin can get platform stats", async () => {
    const res = await adminAgent.get("/api/analytics/platform");
    expect(res.status).toBe(200);
    expect(typeof res.body.users).toBe("number");
    expect(typeof res.body.events).toBe("number");
    expect(typeof res.body.organizations).toBe("number");
    expect(typeof res.body.registrations).toBe("number");
    expect(Array.isArray(res.body.eventsByStatus)).toBe(true);
  });

  test("organizer can get their event stats", async () => {
    const res = await organizerAgent.get("/api/analytics/organizer");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.totalRegistrations).toBe("number");
    expect(typeof res.body.totalViews).toBe("number");
  });

  test("analytics require correct role", async () => {
    const studentNoAdmin = request.agent(app);
    await studentNoAdmin.post("/api/auth/login").send({ email: "disc-student@famnit.upr.si", password: "testpass123" });

    const res = await studentNoAdmin.get("/api/analytics/platform");
    expect(res.status).toBe(403);
  });
});
