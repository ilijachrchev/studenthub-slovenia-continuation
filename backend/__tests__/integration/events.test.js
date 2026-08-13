const request = require("supertest");
const app = require("../../app");

describe("GET /api/events", () => {
  test("returns published events with pagination metadata", async () => {
    const res = await request(app).get("/api/events");

    expect(res.status).toBe(200);
    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBeDefined();

    if (res.body.events.length > 0) {
      const event = res.body.events[0];
      expect(event.id).toBeDefined();
      expect(event.title).toBeDefined();
      expect(event.organization_name).toBeDefined();
    }
  });

  test("respects page and limit query params", async () => {
    const res = await request(app).get("/api/events?page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
  });
});

describe("GET /api/events/:id", () => {
  test("returns event detail with tags", async () => {
    const listRes = await request(app).get("/api/events");
    if (listRes.body.events.length === 0) return;

    const eventId = listRes.body.events[0].id;
    const res = await request(app).get(`/api/events/${eventId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(eventId);
    expect(res.body.title).toBeDefined();
    expect(res.body.organization_name).toBeDefined();
    expect(Array.isArray(res.body.tags)).toBe(true);
  });

  test("returns 404 for non-existent event", async () => {
    const res = await request(app).get("/api/events/999999");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizer/events (event creation)", () => {
  test("creates event as organizer", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ email: "organizer@studenthub.test", password: "organizer123" });

    const res = await agent
      .post("/api/organizer/events")
      .send({
        title: "Test Event",
        description: "A test event",
        location: "Test Hall",
        start_datetime: "2027-06-01T10:00:00",
        end_datetime: "2027-06-01T12:00:00",
        registration_type: "built_in",
        capacity: 50,
        tag_ids: [1],
        target_faculty_ids: [1],
      });

    expect(res.status).toBe(201);
    expect(res.body.eventId).toBeDefined();
  });

  test("rejects unauthenticated event creation", async () => {
    const res = await request(app)
      .post("/api/organizer/events")
      .send({
        title: "Should Fail",
        location: "Nowhere",
        start_datetime: "2027-06-01T10:00:00",
        end_datetime: "2027-06-01T12:00:00",
        tag_ids: [1],
        target_faculty_ids: [1],
      });

    expect(res.status).toBe(401);
  });

  test("rejects missing required fields", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ email: "organizer@studenthub.test", password: "organizer123" });

    const res = await agent
      .post("/api/organizer/events")
      .send({ title: "Incomplete" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/registrations/:id (event registration)", () => {
  let publishedEventId;

  beforeAll(async () => {
    const listRes = await request(app).get("/api/events");
    const builtIn = listRes.body.events.find(
      (e) => e.registration_type === "built_in" && e.capacity != null
    );
    if (builtIn) publishedEventId = builtIn.id;
  });

  test("registers student for published event", async () => {
    if (!publishedEventId) return;

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    // cancel existing registration first if any
    await agent.delete(`/api/registrations/${publishedEventId}`);

    const res = await agent.post(`/api/registrations/${publishedEventId}`);
    expect([201, 409]).toContain(res.status);
  });

  test("rejects duplicate registration", async () => {
    if (!publishedEventId) return;

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const res = await agent.post(`/api/registrations/${publishedEventId}`);
    expect(res.status).toBe(409);
  });

  test("rejects unauthenticated registration", async () => {
    if (!publishedEventId) return;

    const res = await request(app).post(`/api/registrations/${publishedEventId}`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/registrations/:id", () => {
  test("cancels registration", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const listRes = await agent.get("/api/registrations");
    if (listRes.body.length === 0) return;

    const reg = listRes.body[0];
    const res = await agent.delete(`/api/registrations/${reg.event_id}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/registrations", () => {
  test("returns registrations for logged-in user", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "student@famnit.upr.si", password: "student123" });

    const res = await agent.get("/api/registrations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("rejects unauthenticated list request", async () => {
    const res = await request(app).get("/api/registrations");
    expect(res.status).toBe(401);
  });
});
