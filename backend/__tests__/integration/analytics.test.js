const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

async function login(email, password) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Failed to login as ${email}: ${response.status}`);
  }
  return agent;
}

describe("Opportunity analytics", () => {
  let studentAgent;
  let organizerAgent;
  let secondOrganizerAgent;

  beforeAll(async () => {
    studentAgent = await login("student@famnit.upr.si", "student123");
    organizerAgent = await login("organizer@studenthub.test", "organizer123");
    secondOrganizerAgent = await login("organizer2@studenthub.test", "organizer123");
  });

  afterAll(async () => {
    await pool.end();
  });

  test("rejects unauthorized reporting access", async () => {
    const guestResponse = await request(app).get("/api/organizer/opportunities/3/analytics");
    expect(guestResponse.status).toBe(401);

    const studentResponse = await studentAgent.get("/api/organizer/opportunities/3/analytics");
    expect(studentResponse.status).toBe(403);
  });

  test("returns an empty analytics payload for an untouched opportunity", async () => {
    const response = await organizerAgent.get("/api/organizer/opportunities/3/analytics");

    expect(response.status).toBe(200);
    expect(response.body.opportunity.id).toBe(3);
    expect(response.body.summary).toMatchObject({
      views: 0,
      visits: 0,
      applications: 0,
      reviews: 0,
      accepts: 0,
      rejects: 0,
      conversion: 0,
    });
    expect(response.body.funnel).toEqual([
      { stage: "views", count: 0 },
      { stage: "visits", count: 0 },
      { stage: "applications", count: 0 },
      { stage: "reviews", count: 0 },
      { stage: "accepts", count: 0 },
      { stage: "rejects", count: 0 },
    ]);
    expect(response.body.timeseries).toEqual([]);
  });

  test("rejects cross-organization access and allows the owning organizer", async () => {
    const forbiddenResponse = await organizerAgent.get("/api/organizer/opportunities/4/analytics");
    expect(forbiddenResponse.status).toBe(404);

    const allowedResponse = await secondOrganizerAgent.get("/api/organizer/opportunities/4/analytics");
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.body.opportunity.id).toBe(4);
  });

  test("persists captured events and reflects them in reporting", async () => {
    const captureResponse = await studentAgent.post("/api/analytics/events").send({
      events: [
        { event: "opportunity_view", opportunityId: 3, title: "Documentation Writing Workshop" },
        { event: "opportunity_saved", opportunity_id: 3, title: "Documentation Writing Workshop" },
        { event: "unsupported_event", opportunityId: 3 },
      ],
    });

    expect(captureResponse.status).toBe(201);
    expect(captureResponse.body.inserted).toBe(2);

    const analyticsResponse = await organizerAgent.get("/api/organizer/opportunities/3/analytics");
    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.opportunity.id).toBe(3);
    expect(analyticsResponse.body.summary.views).toBe(1);
    expect(analyticsResponse.body.summary.visits).toBe(1);
    expect(analyticsResponse.body.summary.saves).toBe(1);
    expect(analyticsResponse.body.summary.applications).toBe(0);
    expect(analyticsResponse.body.summary.conversion).toBe(0);
    expect(analyticsResponse.body.funnel[0]).toEqual({ stage: "views", count: 1 });
    expect(Array.isArray(analyticsResponse.body.timeseries)).toBe(true);
    expect(analyticsResponse.body.timeseries.length).toBeGreaterThan(0);
  });
});
