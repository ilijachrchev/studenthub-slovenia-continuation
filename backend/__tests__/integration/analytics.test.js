const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

afterAll(async () => {
  await pool.end();
});

async function loginOrganizer(agent) {
  const passwords = ["organizer123", "newsecurepass1"];
  for (const password of passwords) {
    const res = await agent.post("/api/auth/login").send({
      email: "organizer@studenthub.test",
      password,
    });
    if (res.status === 200) {
      return;
    }
  }
  throw new Error("Unable to log in organizer user");
}

describe("POST /api/analytics/events", () => {
  test("records whitelisted analytics events", async () => {
    const res = await request(app)
      .post("/api/analytics/events")
      .send({
        eventType: "opportunity_viewed",
        opportunityId: 1,
        metadata: { source: "test-suite" },
      });

    expect([200, 204]).toContain(res.status);

    const { rows } = await pool.query(
      `SELECT event_type, opportunity_id, metadata
       FROM analytics_events
       WHERE event_type = $1 AND opportunity_id = $2
       ORDER BY id DESC
       LIMIT 1`,
      ["opportunity_viewed", 1]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].metadata.source).toBe("test-suite");
  });

  test("rejects unsupported event types", async () => {
    const res = await request(app)
      .post("/api/analytics/events")
      .send({
        eventType: "unsupported_event",
        opportunityId: 1,
      });

    expect(res.status).toBe(400);
  });
});

describe("Organizer analytics", () => {
  test("returns opportunity funnel and summary", async () => {
    const agent = request.agent(app);
    await loginOrganizer(agent);

    await agent.post("/api/analytics/events").send({
      eventType: "opportunity_viewed",
      opportunityId: 1,
      metadata: { source: "organizer-analytics-test" },
    });

    const detailRes = await agent.get("/api/organizer/opportunities/1/analytics");
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body.funnel)).toBe(true);
    expect(Array.isArray(detailRes.body.timeseries)).toBe(true);

    const summaryRes = await agent.get("/api/organizer/analytics/summary");
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.totals).toBeDefined();
    expect(summaryRes.body.by_status).toBeDefined();
  });
});
