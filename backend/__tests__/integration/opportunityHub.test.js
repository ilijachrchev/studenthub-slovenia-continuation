const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let adminAgent;
let organizerAgent;
let studentAgent;
let opportunityId;
let reportId;

async function login(agent, email, password) {
  await agent.post("/api/auth/login").send({ email, password });
}

beforeAll(async () => {
  adminAgent = request.agent(app);
  organizerAgent = request.agent(app);
  studentAgent = request.agent(app);

  await login(adminAgent, "admin@studenthub.test", "admin123");
  await login(organizerAgent, "organizer@studenthub.test", "organizer123");
  await login(studentAgent, "student@famnit.upr.si", "student123");

  const insert = await pool.query(
    `INSERT INTO opportunity
      (organization_id, title, description, location, status, deadline, created_at, published_at, updated_at)
     VALUES ($1, $2, $3, $4, 'published', NOW() + INTERVAL '30 days', NOW(), NOW(), NOW())
     RETURNING id`,
    [
      1,
      "StudentHub Analytics Workflow",
      "Opportunity used for analytics and moderation integration tests.",
      "Koper",
    ]
  );

  opportunityId = insert.rows[0].id;
});

afterAll(async () => {
  if (opportunityId) {
    await pool.query("DELETE FROM opportunity WHERE id = $1", [opportunityId]);
  }
  await pool.end();
});

describe("analytics", () => {
  test("records analytics events and exposes organizer aggregation", async () => {
    const viewRes = await studentAgent.get(`/api/opportunities/${opportunityId}`);
    expect(viewRes.status).toBe(200);

    const eventRes = await studentAgent.post("/api/analytics/events").send({
      eventType: "recommendation_clicked",
      opportunityId,
    });
    expect(eventRes.status).toBe(201);
    expect(Array.isArray(eventRes.body.inserted)).toBe(true);
    expect(eventRes.body.inserted.length).toBe(1);

    const applyRes = await studentAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "I want to help." });
    expect([201, 409]).toContain(applyRes.status);

    const analyticsRes = await organizerAgent.get(`/api/organizer/opportunities/${opportunityId}/analytics`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.opportunity.id).toBe(opportunityId);
    expect(analyticsRes.body.summary.views).toBeGreaterThanOrEqual(1);
    expect(analyticsRes.body.summary.applications).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(analyticsRes.body.funnel)).toBe(true);
    expect(Array.isArray(analyticsRes.body.timeseries)).toBe(true);
  });
});

describe("recommendations", () => {
  test("returns ranked recommendation payloads for students", async () => {
    const res = await studentAgent.get("/api/recommendations?limit=5&page=1");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.opportunities)).toBe(true);
    for (let i = 1; i < res.body.items.length; i += 1) {
      expect(res.body.items[i - 1].score).toBeGreaterThanOrEqual(res.body.items[i].score);
    }
  });
});

describe("moderation", () => {
  test("creates a report, blocks duplicates, and enforces admin authorization", async () => {
    const reportRes = await studentAgent.post(`/api/opportunities/${opportunityId}/report`).send({
      reason: "incorrect location",
      details: "The posted location is not the current venue.",
    });

    expect(reportRes.status).toBe(201);
    expect(reportRes.body.report.id).toBeDefined();
    reportId = reportRes.body.report.id;

    const duplicateRes = await studentAgent.post(`/api/opportunities/${opportunityId}/report`).send({
      reason: "incorrect location",
    });
    expect(duplicateRes.status).toBe(409);

    const unauthorizedRes = await studentAgent.get("/api/admin/moderation/reports");
    expect(unauthorizedRes.status).toBe(403);

    const listRes = await adminAgent.get("/api/admin/moderation/reports?status=open");
    expect(listRes.status).toBe(200);
    expect(listRes.body.reports.some((item) => String(item.id) === String(reportId))).toBe(true);
  });

  test("supports report state transitions and audit trail recording", async () => {
    const reviewRes = await adminAgent.post(`/api/admin/moderation/reports/${reportId}/review`);
    expect(reviewRes.status).toBe(200);

    const resolveRes = await adminAgent.post(`/api/admin/moderation/reports/${reportId}/resolve`).send({
      note: "Verified and fixed.",
      archive_opportunity: true,
    });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.report.status).toBe("resolved");
    expect(Array.isArray(resolveRes.body.report.audit_trail)).toBe(true);
    expect(resolveRes.body.report.audit_trail.length).toBeGreaterThanOrEqual(2);

    const detailRes = await adminAgent.get(`/api/admin/moderation/reports/${reportId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.report.status).toBe("resolved");
    expect(detailRes.body.report.audit_trail.some((entry) => entry.action === "report_review_started")).toBe(true);
    expect(detailRes.body.report.audit_trail.some((entry) => entry.action === "report_resolved")).toBe(true);

    const archivedOpportunity = await pool.query(
      "SELECT status FROM opportunity WHERE id = $1",
      [opportunityId]
    );
    expect(archivedOpportunity.rows[0].status).toBe("archived");
  });

  test("rejects unauthorized moderation writes", async () => {
    const res = await studentAgent.post(`/api/admin/moderation/reports/${reportId}/dismiss`).send({
      note: "Should not be allowed.",
    });

    expect(res.status).toBe(403);
  });
});
