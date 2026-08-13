const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

const createdOpportunityIds = [];

async function loginAgent(agent, email, password) {
  const res = await agent.post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
}

async function createOpportunity(agent, overrides = {}) {
  const res = await agent.post("/api/opportunities").send({
    title: `Lifecycle Test ${Date.now()}`,
    description: "Lifecycle test opportunity",
    type: "internship",
    location: "Koper",
    is_remote: true,
    application_mode: "built_in",
    compensation: "Paid",
    application_deadline: "2030-12-31T23:59:59",
    starts_at: "2030-11-01T09:00:00",
    tag_ids: [1],
    ...overrides,
  });

  expect(res.status).toBe(201);
  expect(res.body.opportunityId).toBeDefined();
  createdOpportunityIds.push(res.body.opportunityId);
  return res.body.opportunityId;
}

async function getHistory(opportunityId) {
  const { rows } = await pool.query(
    `SELECT previous_status, next_status, actor_user_id, reason
     FROM opportunity_status_history
     WHERE opportunity_id = $1
     ORDER BY created_at ASC, id ASC`,
    [opportunityId]
  );
  return rows;
}

describe("Opportunity lifecycle integration", () => {
  const organizerAgent = request.agent(app);
  const adminAgent = request.agent(app);
  const studentAgent = request.agent(app);

  beforeAll(async () => {
    await loginAgent(organizerAgent, "organizer@studenthub.test", "organizer123");
    await loginAgent(adminAgent, "admin@studenthub.test", "admin123");
    await loginAgent(studentAgent, "student@famnit.upr.si", "student123");
  });

  afterEach(async () => {
    if (createdOpportunityIds.length === 0) {
      return;
    }

    await pool.query(
      "DELETE FROM opportunity_status_history WHERE opportunity_id = ANY($1::int[])",
      [createdOpportunityIds]
    );
    await pool.query(
      "DELETE FROM opportunity_tag WHERE opportunity_id = ANY($1::int[])",
      [createdOpportunityIds]
    );
    await pool.query(
      "DELETE FROM opportunity WHERE id = ANY($1::int[])",
      [createdOpportunityIds]
    );
    createdOpportunityIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  test("creates a draft opportunity and records initial history", async () => {
    const opportunityId = await createOpportunity(organizerAgent);

    const history = await getHistory(opportunityId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      previous_status: null,
      next_status: "draft",
    });
  });

  test("runs the organizer/admin lifecycle and records history", async () => {
    const opportunityId = await createOpportunity(organizerAgent);

    let res = await organizerAgent.post(`/api/opportunities/${opportunityId}/submit`);
    expect(res.status).toBe(200);

    res = await adminAgent.post(`/api/admin/opportunities/${opportunityId}/approve`);
    expect(res.status).toBe(200);

    res = await organizerAgent.post(`/api/opportunities/${opportunityId}/close`);
    expect(res.status).toBe(200);

    res = await organizerAgent.post(`/api/opportunities/${opportunityId}/reopen`);
    expect(res.status).toBe(200);

    res = await organizerAgent.post(`/api/opportunities/${opportunityId}/archive`);
    expect(res.status).toBe(200);

    const history = await getHistory(opportunityId);
    expect(history.map((row) => row.next_status)).toEqual([
      "draft",
      "submitted",
      "published",
      "closed",
      "published",
      "archived",
    ]);
  });

  test("rejects repeated transitions", async () => {
    const opportunityId = await createOpportunity(organizerAgent);

    let res = await organizerAgent.post(`/api/opportunities/${opportunityId}/submit`);
    expect(res.status).toBe(200);

    res = await organizerAgent.post(`/api/opportunities/${opportunityId}/submit`);
    expect(res.status).toBe(409);
  });

  test("rejects nonexistent opportunities", async () => {
    const res = await organizerAgent.post("/api/opportunities/99999999/submit");
    expect(res.status).toBe(404);
  });

  test("enforces transition authorization boundaries", async () => {
    const opportunityId = await createOpportunity(organizerAgent);

    let res = await studentAgent.post("/api/opportunities");
    expect(res.status).toBe(403);

    res = await organizerAgent.post(`/api/admin/opportunities/${opportunityId}/approve`);
    expect(res.status).toBe(403);
  });

  test("rejects invalid admin transitions after publish", async () => {
    const opportunityId = await createOpportunity(organizerAgent);

    let res = await organizerAgent.post(`/api/opportunities/${opportunityId}/submit`);
    expect(res.status).toBe(200);

    res = await adminAgent.post(`/api/admin/opportunities/${opportunityId}/approve`);
    expect(res.status).toBe(200);

    res = await adminAgent.post(`/api/admin/opportunities/${opportunityId}/approve`);
    expect(res.status).toBe(409);
  });
});
