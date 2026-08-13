const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

afterAll(async () => {
  await pool.end();
});

describe("Opportunity moderation", () => {
  test("students can file a report once and admins can resolve it", async () => {
    const studentAgent = request.agent(app);
    await studentAgent.post("/api/auth/login").send({
      email: "student@famnit.upr.si",
      password: "student123",
    });

    const reportRes = await studentAgent
      .post("/api/opportunities/1/report")
      .send({
        reason: "spam",
        details: "Looks suspicious",
      });

    expect(reportRes.status).toBe(201);
    expect(reportRes.body.report.id).toBeDefined();

    const duplicateRes = await studentAgent
      .post("/api/opportunities/1/report")
      .send({
        reason: "spam",
        details: "Duplicate report",
      });

    expect(duplicateRes.status).toBe(409);

    const adminAgent = request.agent(app);
    await adminAgent.post("/api/auth/login").send({
      email: "admin@studenthub.test",
      password: "admin123",
    });

    const queueRes = await adminAgent.get("/api/admin/moderation/reports?status=open");
    expect(queueRes.status).toBe(200);
    expect(Array.isArray(queueRes.body.reports)).toBe(true);

    const resolveRes = await adminAgent
      .post(`/api/admin/moderation/reports/${reportRes.body.report.id}/resolve`)
      .send({ status: "resolved" });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.report.status).toBe("resolved");

    const overviewRes = await adminAgent.get("/api/admin/analytics/overview");
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.counts).toBeDefined();
    expect(overviewRes.body.activity_30d).toBeDefined();
  });
});
