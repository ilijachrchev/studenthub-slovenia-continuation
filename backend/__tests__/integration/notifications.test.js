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

async function listNotifications(agent) {
  const response = await agent.get("/api/notifications");
  expect(response.status).toBe(200);
  return response.body;
}

describe("Notification lifecycle", () => {
  let studentAgent;
  let organizerAgent;

  beforeAll(async () => {
    studentAgent = await login("student@famnit.upr.si", "student123");
    organizerAgent = await login("organizer@studenthub.test", "organizer123");
  });

  afterAll(async () => {
    await pool.end();
  });

  test("rejects unauthenticated notification access", async () => {
    const response = await request(app).get("/api/notifications");
    expect(response.status).toBe(401);
  });

  test("returns notification metadata, unread count, and compatibility aliases", async () => {
    const body = await listNotifications(studentAgent);

    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(body.unread_count).toBe(1);
    expect(body.unreadCount).toBe(1);
  });

  test("marks a notification read and rejects missing notifications", async () => {
    const before = await listNotifications(studentAgent);
    const unread = before.items.find((item) => !item.is_read);

    expect(unread).toBeDefined();

    const readResponse = await studentAgent.post(`/api/notifications/${unread.id}/read`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.notification.id).toBe(unread.id);
    expect(readResponse.body.notification.is_read).toBe(true);

    const missingResponse = await studentAgent.post("/api/notifications/999999/read");
    expect(missingResponse.status).toBe(404);

    const after = await listNotifications(studentAgent);
    expect(after.unread_count).toBe(before.unread_count - 1);
  });

  test("marks all notifications read in one request", async () => {
    const response = await studentAgent.post("/api/notifications/read-all");
    expect(response.status).toBe(200);
    expect(response.body.count).toBeGreaterThanOrEqual(0);

    const after = await listNotifications(studentAgent);
    expect(after.unread_count).toBe(0);
    expect(after.items.every((item) => item.is_read)).toBe(true);
  });

  test("notification preferences round-trip", async () => {
    const nextPreferences = {
      application_updates: true,
      recommendation_updates: false,
      deadline_reminders: true,
    };

    const updateResponse = await studentAgent
      .put("/api/notifications/preferences")
      .send({ preferences: nextPreferences });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.preferences.recommendation_updates).toBe(false);

    const readback = await studentAgent.get("/api/notifications/preferences");
    expect(readback.status).toBe(200);
    expect(readback.body.preferences.recommendation_updates).toBe(false);
  });

  test("application submission emits exactly one application.received notification", async () => {
    const before = await listNotifications(organizerAgent);

    const applyResponse = await studentAgent
      .post("/api/opportunities/2/apply")
      .send({ cover_note: "I can help with open-source work." });

    expect(applyResponse.status).toBe(201);
    expect(applyResponse.body.applicationId).toBeDefined();

    const duplicateResponse = await studentAgent
      .post("/api/opportunities/2/apply")
      .send({ cover_note: "I can help with open-source work." });
    expect(duplicateResponse.status).toBe(409);

    const after = await listNotifications(organizerAgent);
    expect(after.total).toBe(before.total + 1);

    const matching = after.items.filter(
      (item) =>
        item.type === "application.received" &&
        Number(item.payload?.opportunityId) === 2 &&
        Number(item.payload?.applicationId) === applyResponse.body.applicationId
    );
    expect(matching).toHaveLength(1);
  });

  test("student withdrawal emits one status_changed notification", async () => {
    const before = await listNotifications(organizerAgent);

    const withdrawResponse = await studentAgent.delete("/api/opportunities/1/apply");
    expect(withdrawResponse.status).toBe(200);
    expect(withdrawResponse.body.status).toBe("withdrawn");

    const duplicateResponse = await studentAgent.delete("/api/opportunities/1/apply");
    expect([400, 409]).toContain(duplicateResponse.status);

    const after = await listNotifications(organizerAgent);
    expect(after.total).toBe(before.total + 1);

    const matching = after.items.filter(
      (item) =>
        item.type === "application.status_changed" &&
        Number(item.payload?.opportunityId) === 1 &&
        item.payload?.toStatus === "withdrawn"
    );
    expect(matching).toHaveLength(1);
  });
});
