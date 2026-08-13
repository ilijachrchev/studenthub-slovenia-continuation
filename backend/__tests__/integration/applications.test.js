const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");
const {
  uniqueSuffix,
  insertUser,
  loginAgent,
  insertOpportunity,
  deleteOpportunityData,
} = require("./testUtils");

describe("opportunity applications", () => {
  let applicant;
  let outsider;
  let applicantAgent;
  let organizerAgent;
  const opportunityIds = [];
  const applicationIds = [];

  beforeAll(async () => {
    applicant = await insertUser({
      email: `${uniqueSuffix("applicant")}@famnit.upr.si`,
      firstName: "Applicant",
      lastName: "User",
      password: "testpass123",
      role: "student",
    });
    outsider = await insertUser({
      email: `${uniqueSuffix("outsider")}@famnit.upr.si`,
      firstName: "Outside",
      lastName: "User",
      password: "testpass123",
      role: "student",
    });

    applicantAgent = await loginAgent(applicant.email, applicant.password);
    organizerAgent = await loginAgent("organizer@studenthub.test", "organizer123");
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM notification WHERE recipient_user_id = $1", [2]);
    await pool.query("DELETE FROM notification_preferences WHERE user_id = $1", [2]);
  });

  afterAll(async () => {
    await deleteOpportunityData({
      opportunityIds,
      applicationIds,
      notificationRecipientIds: [2],
      userIds: [applicant.id, outsider.id],
    });
    await pool.end();
  });

  test("submits an application and emits an organizer notification", async () => {
    const opportunityId = await insertOpportunity({
      title: uniqueSuffix("application"),
    });
    opportunityIds.push(opportunityId);

    const res = await applicantAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "I want to contribute to this project." });

    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBeDefined();
    expect(res.body.status).toBe("pending");
    applicationIds.push(res.body.applicationId);

    const mine = await applicantAgent.get("/api/opportunities/mine");
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body.applications)).toBe(true);
    expect(mine.body.applications.some((item) => item.id === res.body.applicationId)).toBe(true);

    const { rows: notificationRows } = await pool.query(
      `SELECT type, payload
       FROM notification
       WHERE recipient_user_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [2]
    );
    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].type).toBe("application.received");
    expect(notificationRows[0].payload.opportunityId).toBe(opportunityId);
  });

  test("rejects unauthorized application attempts", async () => {
    const opportunityId = await insertOpportunity({
      title: uniqueSuffix("authz"),
    });
    opportunityIds.push(opportunityId);

    const unauthenticated = await pool.query(
      `SELECT COUNT(*)::int AS count FROM application WHERE opportunity_id = $1`,
      [opportunityId]
    );
    expect(unauthenticated.rows[0].count).toBe(0);

    const noSessionRes = await request(app)
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "test" });
    expect(noSessionRes.status).toBe(401);

    const organizerRes = await organizerAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "test" });
    expect(organizerRes.status).toBe(403);

    const duplicateRes = await applicantAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "first" });
    expect(duplicateRes.status).toBe(201);
    applicationIds.push(duplicateRes.body.applicationId);

    const duplicateAgain = await applicantAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "second" });
    expect(duplicateAgain.status).toBe(409);
  });

  test("handles concurrent duplicate apply requests with one success and one conflict", async () => {
    const opportunityId = await insertOpportunity({
      title: uniqueSuffix("race"),
    });
    opportunityIds.push(opportunityId);

    const [first, second] = await Promise.all([
      applicantAgent.post(`/api/opportunities/${opportunityId}/apply`).send({ cover_note: "one" }),
      applicantAgent.post(`/api/opportunities/${opportunityId}/apply`).send({ cover_note: "two" }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM application WHERE opportunity_id = $1`,
      [opportunityId]
    );
    expect(rows[0].count).toBe(1);

    const successful = [first, second].find((response) => response.status === 201);
    if (successful?.body?.applicationId) {
      applicationIds.push(successful.body.applicationId);
    }
  });

  test("keeps transition history consistent under a status race", async () => {
    const opportunityId = await insertOpportunity({
      title: uniqueSuffix("transition"),
    });
    opportunityIds.push(opportunityId);

    const applyRes = await applicantAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "Please consider me." });

    expect(applyRes.status).toBe(201);
    const applicationId = applyRes.body.applicationId;
    applicationIds.push(applicationId);

    const [organizerTransition, applicantTransition] = await Promise.all([
      organizerAgent.post(`/api/opportunities/${applicationId}/transition`).send({
        from_status: "pending",
        to_status: "under_review",
      }),
      applicantAgent.post(`/api/opportunities/${applicationId}/transition`).send({
        from_status: "pending",
        to_status: "withdrawn",
      }),
    ]);

    expect([organizerTransition.status, applicantTransition.status].sort()).toEqual([200, 409]);

    const statusRes = await applicantAgent.get("/api/opportunities/mine");
    expect(statusRes.status).toBe(200);
    const application = statusRes.body.applications.find((item) => item.id === applicationId);
    expect(application).toBeDefined();
    expect(["under_review", "withdrawn"]).toContain(application.status);

    const historyRes = await applicantAgent.get(`/api/opportunities/${applicationId}/history`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.history.length).toBeGreaterThanOrEqual(2);

    const ownerHistory = await organizerAgent.get(`/api/opportunities/${applicationId}/history`);
    expect(ownerHistory.status).toBe(200);

    const strangerAgent = await loginAgent(outsider.email, outsider.password);
    const strangerHistory = await strangerAgent.get(`/api/opportunities/${applicationId}/history`);
    expect(strangerHistory.status).toBe(404);
  });

  test("suppresses organizer notifications when the preference disables application alerts", async () => {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, preferences, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
      [2, JSON.stringify({ "application.received": false, "application.status_changed": true })]
    );

    const opportunityId = await insertOpportunity({
      title: uniqueSuffix("prefs"),
    });
    opportunityIds.push(opportunityId);

    const res = await applicantAgent
      .post(`/api/opportunities/${opportunityId}/apply`)
      .send({ cover_note: "Silent application" });

    expect(res.status).toBe(201);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notification
       WHERE recipient_user_id = $1`,
      [2]
    );
    expect(rows[0].count).toBe(0);
  });
});
