const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

afterAll(async () => {
  await pool.end();
});

describe("Duplicate operation hardening", () => {
  test("bookmark saves are idempotent with 409 on duplicates", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "student@famnit.upr.si",
      password: "student123",
    });

    await pool.query(
      "DELETE FROM bookmark WHERE user_id = (SELECT id FROM \"user\" WHERE email = $1) AND event_id = $2",
      ["student@famnit.upr.si", 2]
    );

    const first = await agent.post("/api/bookmarks/2");
    expect(first.status).toBe(201);

    const second = await agent.post("/api/bookmarks/2");
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already saved/i);
  });

  test("feedback submissions reject duplicates after event completion", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "student@famnit.upr.si",
      password: "student123",
    });

    const eventId = 6;
    const { rows: studentRows } = await pool.query(
      "SELECT id FROM \"user\" WHERE email = $1",
      ["student@famnit.upr.si"]
    );
    const studentId = studentRows[0].id;
    const { rows: originalEvent } = await pool.query(
      "SELECT end_datetime FROM event WHERE id = $1",
      [eventId]
    );
    const originalEndDatetime = originalEvent[0].end_datetime;

    try {
      await pool.query("DELETE FROM feedback WHERE user_id = $1 AND event_id = $2", [studentId, eventId]);
      await pool.query(
        "UPDATE event SET end_datetime = $1 WHERE id = $2",
        ["2024-01-01 00:00:00", eventId]
      );

      const first = await agent.post(`/api/feedback/${eventId}`).send({
        rating: 5,
        comment: "Great session",
      });
      expect(first.status).toBe(201);

      const second = await agent.post(`/api/feedback/${eventId}`).send({
        rating: 4,
        comment: "Still great",
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already left feedback/i);
    } finally {
      await pool.query("UPDATE event SET end_datetime = $1 WHERE id = $2", [
        originalEndDatetime,
        eventId,
      ]);
    }
  });
});
