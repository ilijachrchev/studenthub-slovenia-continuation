const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let opportunityId;
let applicationId;

function uniqueTitle() {
  return `StudentHub Opportunity Test ${Date.now()}`;
}

beforeAll(async () => {
  const title = uniqueTitle();
  const { rows } = await pool.query(
    `INSERT INTO opportunity (organization_id, title, description, location, status, deadline, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id`,
    [1, title, "A focused contract test opportunity.", "Koper", "published", "2026-12-31T12:00:00.000Z"]
  );
  opportunityId = rows[0].id;
});

afterAll(async () => {
  if (applicationId) {
    await pool.query("DELETE FROM application_history WHERE application_id = $1", [applicationId]);
    await pool.query("DELETE FROM application WHERE id = $1", [applicationId]);
  }

  if (opportunityId) {
    await pool.query("DELETE FROM opportunity_bookmark WHERE opportunity_id = $1", [opportunityId]);
    await pool.query("DELETE FROM opportunity WHERE id = $1", [opportunityId]);
  }

  await pool.end();
});

describe("Opportunity hub API", () => {
  test("lists the published opportunity and supports detail/bookmark flows", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const listRes = await agent.get(`/api/opportunities?search=StudentHub%20Opportunity%20Test`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items || listRes.body.opportunities || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: opportunityId,
          title: expect.stringContaining("StudentHub Opportunity Test"),
        }),
      ])
    );

    const detailRes = await agent.get(`/api/opportunities/${opportunityId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.opportunity.id).toBe(opportunityId);
    expect(detailRes.body.opportunity.bookmarked).toBe(false);

    const bookmarkRes = await agent.post(`/api/opportunities/${opportunityId}/bookmark`);
    expect(bookmarkRes.status).toBe(201);

    const duplicateBookmarkRes = await agent.post(`/api/opportunities/${opportunityId}/bookmark`);
    expect(duplicateBookmarkRes.status).toBe(409);

    const savedIdsRes = await agent.get("/api/opportunities/saved/ids");
    expect(savedIdsRes.status).toBe(200);
    expect(savedIdsRes.body.ids).toContain(opportunityId);

    const savedRes = await agent.get("/api/opportunities/saved");
    expect(savedRes.status).toBe(200);
    expect(savedRes.body.items || savedRes.body.opportunities || []).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: opportunityId })])
    );

    const removeBookmarkRes = await agent.delete(`/api/opportunities/${opportunityId}/bookmark`);
    expect(removeBookmarkRes.status).toBe(200);
  });

  test("submits an application, exposes history, and blocks duplicate submissions", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const applyRes = await agent
      .post(`/api/applications/${opportunityId}/apply`)
      .send({ cover_note: "I would like to help ship this project." });

    expect(applyRes.status).toBe(201);
    applicationId = applyRes.body.applicationId;
    expect(applicationId).toBeDefined();

    const duplicateApplyRes = await agent
      .post(`/api/applications/${opportunityId}/apply`)
      .send({ cover_note: "Second submission." });

    expect(duplicateApplyRes.status).toBe(409);

    const mineRes = await agent.get("/api/applications/mine");
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: applicationId,
          opportunity_id: opportunityId,
          history: expect.any(Array),
        }),
      ])
    );
  });
});
