const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let studentAgent;
let organizerAgent;
let adminAgent;
let orphanAdminAgent;
let orphanAdminEmail = "orphan-admin@test.com";
let reporterEmail = "reporter@famnit.upr.si";

beforeAll(async () => {
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Reporter",
      last_name: "User",
      email: reporterEmail,
      password: "testpass123",
      role: "student",
    });

  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Orphan",
      last_name: "Admin",
      email: orphanAdminEmail,
      password: "testpass123",
      role: "organizer",
    });

  await pool.query(
    "UPDATE \"user\" SET role = 'admin' WHERE email = $1",
    [orphanAdminEmail]
  );

  studentAgent = request.agent(app);
  await studentAgent
    .post("/api/auth/login")
    .send({ email: reporterEmail, password: "testpass123" });

  organizerAgent = request.agent(app);
  await organizerAgent
    .post("/api/auth/login")
    .send({ email: "organizer@studenthub.test", password: "organizer123" });

  adminAgent = request.agent(app);
  await adminAgent
    .post("/api/auth/login")
    .send({ email: "admin@studenthub.test", password: "admin123" });

  orphanAdminAgent = request.agent(app);
  await orphanAdminAgent
    .post("/api/auth/login")
    .send({ email: orphanAdminEmail, password: "testpass123" });
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM \"user\" WHERE email IN ($1, $2)",
    [reporterEmail, orphanAdminEmail]
  );
  await pool.end();
});

async function createReport(opportunityId) {
  const res = await studentAgent
    .post(`/api/opportunities/${opportunityId}/report`)
    .send({ reason: `Report for opportunity ${opportunityId}`, category: "other" });

  return res;
}

describe("opportunity reporting", () => {
  test("rejects invalid targets", async () => {
    const res = await studentAgent
      .post("/api/opportunities/999999/report")
      .send({ reason: "Invalid target", category: "spam" });

    expect(res.status).toBe(404);
  });

  test("rejects unauthorized reporters", async () => {
    const organizerRes = await organizerAgent
      .post("/api/opportunities/1/report")
      .send({ reason: "Organizer report", category: "other" });
    expect(organizerRes.status).toBe(403);

    const adminRes = await adminAgent
      .post("/api/opportunities/1/report")
      .send({ reason: "Admin report", category: "other" });
    expect(adminRes.status).toBe(403);
  });

  test("creates a report and blocks duplicates", async () => {
    const first = await createReport(1);
    expect(first.status).toBe(201);
    expect(first.body.report.id).toBeDefined();

    const duplicate = await createReport(1);
    expect(duplicate.status).toBe(409);
  });

  test("allows reporting a different opportunity", async () => {
    const res = await createReport(2);
    expect(res.status).toBe(201);
  });
});

describe("admin moderation queue", () => {
  test("rejects admins without an admin table row", async () => {
    const res = await orphanAdminAgent.get("/api/admin/moderation/reports");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin record/i);
  });

  test("supports filtering and pagination", async () => {
    const res = await adminAgent.get("/api/admin/moderation/reports?status=open&page=1&limit=1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reports)).toBe(true);
    expect(res.body.reports.length).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);

    const second = await adminAgent.get("/api/admin/moderation/reports?status=open&page=2&limit=1");
    expect(second.status).toBe(200);
    expect(second.body.page).toBe(2);
  });

  test("returns sanitized audit trail in report detail", async () => {
    const listRes = await adminAgent.get("/api/admin/moderation/reports?status=open&page=1&limit=10");
    const reportId = listRes.body.reports[0].id;

    const detailRes = await adminAgent.get(`/api/admin/moderation/reports/${reportId}`);
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body.report.audit_trail)).toBe(true);
    expect(detailRes.body.report.audit_trail.length).toBeGreaterThan(0);
    expect(detailRes.body.report.audit_trail[0].metadata.reason).toBeUndefined();
  });

  test("handles concurrent moderation decisions with one conflict", async () => {
    const listRes = await adminAgent.get("/api/admin/moderation/reports?status=open&page=1&limit=10");
    const reportId = listRes.body.reports[0].id;

    const [resolveRes, dismissRes] = await Promise.all([
      adminAgent.post(`/api/admin/moderation/reports/${reportId}/resolve`).send({
        note: "Valid report, resolved.",
        archive_opportunity: false,
      }),
      adminAgent.post(`/api/admin/moderation/reports/${reportId}/dismiss`).send({
        note: "Conflicting decision.",
        archive_opportunity: false,
      }),
    ]);

    const statuses = [resolveRes.status, dismissRes.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
