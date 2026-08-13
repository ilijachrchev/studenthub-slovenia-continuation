const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

describe("Opportunity lifecycle backend", () => {
  const otherOrganizerEmail = "opp-owner-boundary@test.com";
  let organizerAgent;
  let studentAgent;
  let otherOrganizerAgent;
  let transitionOpportunityId;
  let withdrawOpportunityId;
  let applicationId;

  beforeAll(async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Boundary",
        last_name: "Organizer",
        email: otherOrganizerEmail,
        password: "testpass123",
        role: "organizer",
      });

    organizerAgent = request.agent(app);
    await organizerAgent
      .post("/api/auth/login")
      .send({ email: "organizer@studenthub.test", password: "organizer123" });

    studentAgent = request.agent(app);
    await studentAgent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    otherOrganizerAgent = request.agent(app);
    await otherOrganizerAgent
      .post("/api/auth/login")
      .send({ email: otherOrganizerEmail, password: "testpass123" });

    const createTransitionRes = await organizerAgent.post("/api/organizer/opportunities").send({
      title: "Opportunity Lifecycle Backend Transition",
      summary: "Transition test summary",
      description: "This opportunity exists to exercise organizer lifecycle and applicant transitions.",
      location: "Koper",
      application_deadline: "2026-09-01T10:00",
      start_date: "2026-09-10T10:00",
      end_date: "2026-09-11T10:00",
      capacity: 10,
      compensation: "Paid",
      contact_email: "oss@studenthub.test",
      apply_url: "https://example.org/apply",
      tags: [1],
    });
    expect(createTransitionRes.status).toBe(201);
    transitionOpportunityId = createTransitionRes.body.opportunity.id;

    const patchRes = await organizerAgent.patch(`/api/organizer/opportunities/${transitionOpportunityId}`).send({
      title: "Opportunity Lifecycle Backend Transition Updated",
      summary: "Transition test summary updated",
      description: "This opportunity exists to exercise organizer lifecycle and applicant transitions.",
      location: "Koper",
      application_deadline: "2026-09-01T10:00",
      start_date: "2026-09-10T10:00",
      end_date: "2026-09-11T10:00",
      capacity: 10,
      compensation: "Paid",
      contact_email: "oss@studenthub.test",
      apply_url: "https://example.org/apply",
      tags: [1],
    });
    expect(patchRes.status).toBe(200);

    const submitRes = await organizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/submit`);
    expect(submitRes.status).toBe(200);

    const createWithdrawRes = await organizerAgent.post("/api/organizer/opportunities").send({
      title: "Opportunity Lifecycle Backend Withdraw",
      summary: "Withdraw test summary",
      description: "This opportunity exists to exercise withdrawal.",
      location: "Koper",
      application_deadline: "2026-09-01T10:00",
      start_date: "2026-09-12T10:00",
      end_date: "2026-09-13T10:00",
      capacity: 10,
      compensation: "Paid",
      contact_email: "oss@studenthub.test",
      apply_url: "https://example.org/apply",
      tags: [1],
    });
    expect(createWithdrawRes.status).toBe(201);
    withdrawOpportunityId = createWithdrawRes.body.opportunity.id;

    const submitWithdrawRes = await organizerAgent.post(`/api/organizer/opportunities/${withdrawOpportunityId}/submit`);
    expect(submitWithdrawRes.status).toBe(200);
  });

  afterAll(async () => {
    const ids = [transitionOpportunityId, withdrawOpportunityId].filter(Boolean);
    if (ids.length > 0) {
      await pool.query("DELETE FROM application_history WHERE application_id IN (SELECT id FROM application WHERE opportunity_id = ANY($1::int[]))", [ids]).catch(() => {});
      await pool.query("DELETE FROM application WHERE opportunity_id = ANY($1::int[])", [ids]).catch(() => {});
      await pool.query("DELETE FROM opportunity_bookmark WHERE opportunity_id = ANY($1::int[])", [ids]).catch(() => {});
      await pool.query("DELETE FROM opportunity_tag WHERE opportunity_id = ANY($1::int[])", [ids]).catch(() => {});
      await pool.query("DELETE FROM opportunity WHERE id = ANY($1::int[])", [ids]).catch(() => {});
    }

    await pool.query("DELETE FROM \"user\" WHERE email = $1", [otherOrganizerEmail]).catch(() => {});
    await pool.end();
  });

  test("rejects malformed organizer opportunity payloads", async () => {
    const res = await organizerAgent.post("/api/organizer/opportunities").send({
      description: "Missing title should fail",
      location: "Koper",
      application_deadline: "2026-09-01T10:00",
      start_date: "2026-09-10T10:00",
      end_date: "2026-09-11T10:00",
      tags: [1],
    });

    expect(res.status).toBe(400);
  });

  test("owner can edit, submit, and fetch opportunities", async () => {
    const detailRes = await studentAgent.get(`/api/opportunities/${transitionOpportunityId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.opportunity.id).toBe(transitionOpportunityId);
    expect(detailRes.body.opportunity.status).toBe("submitted");

    const ownerListRes = await organizerAgent.get("/api/organizer/opportunities");
    expect(ownerListRes.status).toBe(200);
    expect(Array.isArray(ownerListRes.body.opportunities)).toBe(true);
    expect(ownerListRes.body.opportunities.some((item) => item.id === transitionOpportunityId)).toBe(true);
  });

  test("opportunity lifecycle rejects invalid transitions and non-owner access", async () => {
    const secondSubmit = await organizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/submit`);
    expect(secondSubmit.status).toBe(400);

    const closeByOther = await otherOrganizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/close`);
    expect(closeByOther.status).toBe(404);

    const archiveByOther = await otherOrganizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/archive`);
    expect(archiveByOther.status).toBe(404);
  });

  test("non-owner organizer cannot access another organizer's opportunity", async () => {
    const res = await otherOrganizerAgent.get(`/api/organizer/opportunities/${transitionOpportunityId}/applicants`);
    expect(res.status).toBe(404);
  });

  test("bookmark operations are unique and reversible", async () => {
    const firstSave = await studentAgent.post(`/api/opportunities/${transitionOpportunityId}/bookmark`);
    expect(firstSave.status).toBe(201);

    const duplicateSave = await studentAgent.post(`/api/opportunities/${transitionOpportunityId}/bookmark`);
    expect(duplicateSave.status).toBe(409);

    const idsRes = await studentAgent.get("/api/opportunities/saved/ids");
    expect(idsRes.status).toBe(200);
    expect(idsRes.body.ids).toContain(transitionOpportunityId);

    const removeSave = await studentAgent.delete(`/api/opportunities/${transitionOpportunityId}/bookmark`);
    expect(removeSave.status).toBe(200);

    const missingRemove = await studentAgent.delete(`/api/opportunities/${transitionOpportunityId}/bookmark`);
    expect(missingRemove.status).toBe(404);
  });

  test("student can apply once and duplicate applications are rejected", async () => {
    const applyRes = await studentAgent.post(`/api/opportunities/${transitionOpportunityId}/apply`).send({
      cover_note: "I am interested in this opportunity.",
    });
    expect(applyRes.status).toBe(201);
    applicationId = applyRes.body.applicationId || applyRes.body.application?.id;
    expect(applicationId).toBeDefined();

    const duplicateApply = await studentAgent.post(`/api/opportunities/${transitionOpportunityId}/apply`).send({
      cover_note: "Second attempt",
    });
    expect(duplicateApply.status).toBe(409);

    const applicationsRes = await studentAgent.get("/api/opportunities/applications");
    expect(applicationsRes.status).toBe(200);
    expect(applicationsRes.body.applications.some((item) => item.id === applicationId)).toBe(true);

    const historyRes = await studentAgent.get(`/api/opportunities/${applicationId}/history`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.applicationId).toBe(applicationId);
    expect(Array.isArray(historyRes.body.history)).toBe(true);
    expect(historyRes.body.history.length).toBeGreaterThan(0);
  });

  test("organizer applicant transitions are concurrency safe", async () => {
    const applicantsRes = await organizerAgent.get(`/api/organizer/opportunities/${transitionOpportunityId}/applicants`);
    expect(applicantsRes.status).toBe(200);
    const applicant = applicantsRes.body.applicants.find((item) => item.id === applicationId);
    expect(applicant).toBeDefined();

    const [first, second] = await Promise.all([
      organizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/applicants/${applicationId}/transition`).send({
        status: "review",
        note: "First review pass",
      }),
      organizerAgent.post(`/api/organizer/opportunities/${transitionOpportunityId}/applicants/${applicationId}/transition`).send({
        status: "review",
        note: "Second review pass",
      }),
    ]);

    expect([200, 409]).toContain(first.status);
    expect([200, 409]).toContain(second.status);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  test("student withdrawal uses opportunity id and is idempotent", async () => {
    const applyRes = await studentAgent.post(`/api/opportunities/${withdrawOpportunityId}/apply`).send({
      cover_note: "I would like to withdraw this later.",
    });
    expect(applyRes.status).toBe(201);

    const withdrawRes = await studentAgent.delete(`/api/opportunities/${withdrawOpportunityId}/apply`);
    expect(withdrawRes.status).toBe(200);

    const secondWithdrawRes = await studentAgent.delete(`/api/opportunities/${withdrawOpportunityId}/apply`);
    expect(secondWithdrawRes.status).toBe(404);
  });

  test("withdrawal on another student's application remains hidden", async () => {
    const res = await otherOrganizerAgent.delete(`/api/opportunities/${withdrawOpportunityId}/apply`);
    expect(res.status).toBe(403);
  });

  test("organizer analytics returns derived summary", async () => {
    const res = await organizerAgent.get(`/api/organizer/opportunities/${transitionOpportunityId}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.opportunity.id).toBe(transitionOpportunityId);
    expect(res.body.summary.applications).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.funnel)).toBe(true);
    expect(Array.isArray(res.body.timeseries)).toBe(true);
  });
});
