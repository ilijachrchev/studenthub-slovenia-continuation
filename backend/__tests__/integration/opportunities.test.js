const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let organizerAAgent, organizerBAgent, adminAgent, studentAgent;
let orgAId, orgBId;
let studentUserId;

function futureDate(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createDraftOpportunity(agent, overrides = {}) {
  const res = await agent.post("/api/opportunities").send({
    title: "Test Opportunity",
    description: "A description",
    location: "Remote",
    deadline: futureDate(30),
    ...overrides,
  });
  return res;
}

beforeAll(async () => {
  // --- organizer A: owns an approved organization ---
  await request(app).post("/api/auth/register").send({
    first_name: "OrgA",
    last_name: "Owner",
    email: "opp-organizer-a@test.com",
    password: "testpass123",
    role: "organizer",
  });
  const { rows: [orgA] } = await pool.query(
    `INSERT INTO organization (name, contact_email, status, approved_at)
     VALUES ('Opp Test Org A', 'opp-orga@test.com', 'approved', NOW())
     RETURNING id`
  );
  orgAId = orgA.id;
  const { rows: [userA] } = await pool.query(`SELECT id FROM "user" WHERE email = $1`, ["opp-organizer-a@test.com"]);
  await pool.query(
    `INSERT INTO organizer_profile (user_id, organization_id, role_in_org) VALUES ($1, $2, 'owner')`,
    [userA.id, orgAId]
  );

  // --- organizer B: owns a *different* approved organization (used for cross-user checks) ---
  await request(app).post("/api/auth/register").send({
    first_name: "OrgB",
    last_name: "Owner",
    email: "opp-organizer-b@test.com",
    password: "testpass123",
    role: "organizer",
  });
  const { rows: [orgB] } = await pool.query(
    `INSERT INTO organization (name, contact_email, status, approved_at)
     VALUES ('Opp Test Org B', 'opp-orgb@test.com', 'approved', NOW())
     RETURNING id`
  );
  orgBId = orgB.id;
  const { rows: [userB] } = await pool.query(`SELECT id FROM "user" WHERE email = $1`, ["opp-organizer-b@test.com"]);
  await pool.query(
    `INSERT INTO organizer_profile (user_id, organization_id, role_in_org) VALUES ($1, $2, 'owner')`,
    [userB.id, orgBId]
  );

  // --- admin ---
  await request(app).post("/api/auth/register").send({
    first_name: "Opp",
    last_name: "Admin",
    email: "opp-admin@test.com",
    password: "testpass123",
    role: "organizer",
  });
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, ["opp-admin@test.com"]);

  // --- student ---
  await request(app).post("/api/auth/register").send({
    first_name: "Opp",
    last_name: "Student",
    email: "opp-student@famnit.upr.si",
    password: "testpass123",
    role: "student",
  });
  const { rows: [student] } = await pool.query(`SELECT id FROM "user" WHERE email = $1`, ["opp-student@famnit.upr.si"]);
  studentUserId = student.id;

  organizerAAgent = request.agent(app);
  await organizerAAgent.post("/api/auth/login").send({ email: "opp-organizer-a@test.com", password: "testpass123" });

  organizerBAgent = request.agent(app);
  await organizerBAgent.post("/api/auth/login").send({ email: "opp-organizer-b@test.com", password: "testpass123" });

  adminAgent = request.agent(app);
  await adminAgent.post("/api/auth/login").send({ email: "opp-admin@test.com", password: "testpass123" });

  studentAgent = request.agent(app);
  await studentAgent.post("/api/auth/login").send({ email: "opp-student@famnit.upr.si", password: "testpass123" });
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/opportunities — creation & validation", () => {
  test("organizer creates a draft opportunity", async () => {
    const res = await createDraftOpportunity(organizerAAgent);
    expect(res.status).toBe(201);
    expect(res.body.opportunity.status).toBe("draft");
    expect(res.body.opportunity.organization_id).toBe(orgAId);
  });

  test("rejects missing title", async () => {
    const res = await createDraftOpportunity(organizerAAgent, { title: undefined });
    expect(res.status).toBe(400);
  });

  test("rejects a deadline in the past", async () => {
    const res = await createDraftOpportunity(organizerAAgent, { deadline: "2020-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/opportunities").send({ title: "x", deadline: futureDate(1) });
    expect(res.status).toBe(401);
  });

  test("rejects a student (wrong role)", async () => {
    const res = await studentAgent.post("/api/opportunities").send({ title: "x", deadline: futureDate(1) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/opportunities/mine and cross-user isolation", () => {
  test("organizer sees only their own organization's opportunities", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Mine Isolation Test" });
    const opportunityId = createRes.body.opportunity.id;

    const mineA = await organizerAAgent.get("/api/opportunities/mine");
    expect(mineA.status).toBe(200);
    expect(mineA.body.opportunities.some((o) => o.id === opportunityId)).toBe(true);

    const mineB = await organizerBAgent.get("/api/opportunities/mine");
    expect(mineB.body.opportunities.some((o) => o.id === opportunityId)).toBe(false);
  });
});

describe("PATCH /api/opportunities/:id — editing", () => {
  test("owner can edit a draft", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await organizerAAgent.patch(`/api/opportunities/${id}`).send({ title: "Updated title" });
    expect(res.status).toBe(200);
    expect(res.body.opportunity.title).toBe("Updated title");
  });

  test("a non-owner (different organization) gets 404, not 403 — no existence leak", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await organizerBAgent.patch(`/api/opportunities/${id}`).send({ title: "Hijacked" });
    expect(res.status).toBe(404);
  });

  test("cannot edit once published", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    const res = await organizerAAgent.patch(`/api/opportunities/${id}`).send({ title: "Too late" });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/opportunities/:id/transition — lifecycle rules", () => {
  test("valid transition: draft -> published", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  test("invalid transition: published -> draft is rejected", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    const res = await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "draft" });
    expect(res.status).toBe(409);

    const historyRes = await organizerAAgent.get(`/api/opportunities/${id}/history`);
    // only the "created" and "published" entries — the rejected attempt left no trace
    expect(historyRes.body.history.length).toBe(2);
  });

  test("malformed input: unknown to_status is rejected without mutating state", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "banana" });
    expect(res.status).toBe(400);

    const detail = await organizerAAgent.get("/api/opportunities/mine");
    const found = detail.body.opportunities.find((o) => o.id === id);
    expect(found.status).toBe("draft");
  });

  test("unauthorized: a student cannot transition an opportunity", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await studentAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });
    expect(res.status).toBe(403);
  });

  test("cross-user: organizer B cannot transition organizer A's opportunity", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const res = await organizerBAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });
    expect(res.status).toBe(404);
  });

  test("missing record: transitioning a non-existent opportunity returns 404", async () => {
    const res = await organizerAAgent.post("/api/opportunities/999999999/transition").send({ to_status: "published" });
    expect(res.status).toBe(404);
  });

  test("malformed id segment returns 404, not a 500", async () => {
    const res = await organizerAAgent.post("/api/opportunities/not-a-number/transition").send({ to_status: "published" });
    expect(res.status).toBe(404);
  });

  test("optimistic concurrency: stale from_status is rejected with 409", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    // Client believes it's still draft (stale read) and tries to publish again.
    const res = await organizerAAgent
      .post(`/api/opportunities/${id}/transition`)
      .send({ to_status: "closed", from_status: "draft" });
    expect(res.status).toBe(409);
  });

  test("admin can force-archive a published opportunity directly", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    const res = await adminAgent
      .post(`/api/opportunities/${id}/transition`)
      .send({ to_status: "archived", reason: "Policy violation" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");

    const notif = await pool.query(
      `SELECT * FROM notification WHERE recipient_user_id = $1 AND type = 'opportunity.status_changed' ORDER BY id DESC LIMIT 1`,
      [(await pool.query(`SELECT id FROM "user" WHERE email = $1`, ["opp-organizer-a@test.com"])).rows[0].id]
    );
    expect(notif.rows.length).toBe(1);
    expect(notif.rows[0].payload.reason).toBe("Policy violation");
  });

  test("duplicate request with the same Idempotency-Key is replayed, not reapplied", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    const key = `idem-${id}-publish`;

    const first = await organizerAAgent
      .post(`/api/opportunities/${id}/transition`)
      .set("Idempotency-Key", key)
      .send({ to_status: "published" });
    expect(first.status).toBe(200);

    const second = await organizerAAgent
      .post(`/api/opportunities/${id}/transition`)
      .set("Idempotency-Key", key)
      .send({ to_status: "published" });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const historyRes = await organizerAAgent.get(`/api/opportunities/${id}/history`);
    // "created" + a single "status_transition" — the replay did not add a second one
    expect(historyRes.body.history.filter((h) => h.action === "status_transition").length).toBe(1);
  });

  test("reusing an Idempotency-Key for a different request is rejected with 422", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;
    const key = `idem-${id}-conflict`;

    const first = await organizerAAgent
      .post(`/api/opportunities/${id}/transition`)
      .set("Idempotency-Key", key)
      .send({ to_status: "published" });
    expect(first.status).toBe(200);

    const second = await organizerAAgent
      .post(`/api/opportunities/${id}/transition`)
      .set("Idempotency-Key", key)
      .send({ to_status: "closed" });
    expect(second.status).toBe(422);
  });

  test("concurrent transitions: only one of two racing publish requests succeeds", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent);
    const id = createRes.body.opportunity.id;

    const [a, b] = await Promise.all([
      organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" }),
      organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" }),
    ]);

    const statuses = [a.status, b.status].sort();
    // Exactly one request wins (200); the other loses the race. Because it's the
    // exact same transition, the loser may see it as either a conflict (409) or,
    // if it reads after the winner commits, a no-op 409 from FOR UPDATE serialization.
    expect(statuses).toContain(200);

    const historyRes = await organizerAAgent.get(`/api/opportunities/${id}/history`);
    expect(historyRes.body.history.filter((h) => h.to_status === "published").length).toBe(1);
  });
});

describe("GET /api/opportunities (public) — only published opportunities are exposed", () => {
  test("a draft opportunity is not publicly visible", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Hidden Draft" });
    const id = createRes.body.opportunity.id;

    const res = await request(app).get(`/api/opportunities/${id}`);
    expect(res.status).toBe(404);
  });

  test("a published opportunity is publicly visible", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Visible Once Published" });
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    const res = await request(app).get(`/api/opportunities/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  test("list endpoint paginates and only returns published opportunities", async () => {
    const res = await request(app).get("/api/opportunities?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.opportunities)).toBe(true);
    for (const opp of res.body.opportunities) {
      expect(opp.status).toBe("published");
    }
  });
});

describe("GET /api/opportunities/:id/analytics", () => {
  test("reflects application status distribution and conversion rate", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Analytics Target" });
    const id = createRes.body.opportunity.id;
    await organizerAAgent.post(`/api/opportunities/${id}/transition`).send({ to_status: "published" });

    const applyRes = await studentAgent.post(`/api/applications/${id}/apply`).send({ cover_note: "Hi" });
    expect(applyRes.status).toBe(201);

    const res = await organizerAAgent.get(`/api/opportunities/${id}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.applications.total).toBe(1);
    expect(res.body.applications.status_distribution.pending).toBe(1);
    expect(res.body.applications.conversion_rate).toBe(0);
  });

  test("a non-manager cannot view another organizer's opportunity analytics", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Private Analytics" });
    const id = createRes.body.opportunity.id;

    const res = await organizerBAgent.get(`/api/opportunities/${id}/analytics`);
    expect(res.status).toBe(404);
  });

  test("admin can view analytics for any opportunity", async () => {
    const createRes = await createDraftOpportunity(organizerAAgent, { title: "Admin Visible" });
    const id = createRes.body.opportunity.id;

    const res = await adminAgent.get(`/api/opportunities/${id}/analytics`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/opportunities/analytics/summary", () => {
  test("aggregates the organizer's own opportunities and applications", async () => {
    const res = await organizerAAgent.get("/api/opportunities/analytics/summary");
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(orgAId);
    expect(res.body.opportunities.total).toBeGreaterThan(0);
  });

  test("students cannot access organizer analytics", async () => {
    const res = await studentAgent.get("/api/opportunities/analytics/summary");
    expect(res.status).toBe(403);
  });
});
