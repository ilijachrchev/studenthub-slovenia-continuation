const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");
const notificationService = require("../../services/notification");

let studentAgent, organizerAgent, studentId;

beforeAll(async () => {
  // Register a student with valid university email
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Notify",
      last_name: "Student",
      email: "notify-student@famnit.upr.si",
      password: "testpass123",
      role: "student",
    });

  // Register an organizer
  await request(app)
    .post("/api/auth/register")
    .send({
      first_name: "Notify",
      last_name: "Organizer",
      email: "notify-org@test.com",
      password: "testpass123",
      role: "organizer",
    });

  // Create logged-in agents
  studentAgent = request.agent(app);
  await studentAgent
    .post("/api/auth/login")
    .send({ email: "notify-student@famnit.upr.si", password: "testpass123" });

  organizerAgent = request.agent(app);
  await organizerAgent
    .post("/api/auth/login")
    .send({ email: "notify-org@test.com", password: "testpass123" });

  // Get the student user ID
  const meRes = await studentAgent.get("/api/auth/me");
  studentId = meRes.body.user.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM "user" WHERE email IN ($1, $2)',
    ["notify-student@famnit.upr.si", "notify-org@test.com"]
  );
  await pool.end();
});

describe("Notification service", () => {
  test("creates a notification", async () => {
    const notif = await notificationService.create({
      userId: studentId,
      type: "test",
      title: "Test title",
      message: "Test message",
      relatedId: 1,
    });

    expect(notif).toBeDefined();
    expect(notif.id).toBeDefined();
    expect(notif.user_id).toBe(studentId);
    expect(notif.type).toBe("test");
    expect(notif.title).toBe("Test title");
    expect(notif.is_read).toBe(false);
  });

  test("gets notifications by user with pagination", async () => {
    const result = await notificationService.getByUser(studentId, { page: 1, limit: 10 });
    expect(result.notifications).toBeDefined();
    expect(Array.isArray(result.notifications)).toBe(true);
    expect(result.total).toBeDefined();
    expect(result.page).toBe(1);
  });

  test("gets unread count", async () => {
    const count = await notificationService.getUnreadCount(studentId);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("marks notification as read", async () => {
    const notif = await notificationService.create({
      userId: studentId,
      type: "test_read",
      title: "Read me",
      message: "Will be read",
    });

    const updated = await notificationService.markAsRead(notif.id, studentId);
    expect(updated).toBe(true);

    // Verify it's read
    const result = await notificationService.getByUser(studentId, { page: 1, limit: 100 });
    const found = result.notifications.find((n) => n.id === notif.id);
    expect(found.is_read).toBe(true);
  });

  test("marks all notifications as read", async () => {
    // Create a few unread notifications
    await notificationService.create({ userId: studentId, type: "bulk", title: "Bulk 1", message: "m1" });
    await notificationService.create({ userId: studentId, type: "bulk", title: "Bulk 2", message: "m2" });

    const count = await notificationService.markAllAsRead(studentId);
    expect(count).toBeGreaterThanOrEqual(2);

    const unread = await notificationService.getUnreadCount(studentId);
    expect(unread).toBe(0);
  });

  test("removes a notification", async () => {
    const notif = await notificationService.create({
      userId: studentId,
      type: "delete_me",
      title: "Delete",
      message: "Gone soon",
    });

    const removed = await notificationService.remove(notif.id, studentId);
    expect(removed).toBe(true);

    // Verify it's gone
    const result = await notificationService.getByUser(studentId, { page: 1, limit: 100 });
    const found = result.notifications.find((n) => n.id === notif.id);
    expect(found).toBeUndefined();
  });

  test("cannot remove another user's notification", async () => {
    const notif = await notificationService.create({
      userId: studentId,
      type: "private",
      title: "Private",
      message: "Only for this user",
    });

    const removed = await notificationService.remove(notif.id, 999);
    expect(removed).toBe(false);
  });
});

describe("Notification API routes", () => {
  test("GET /api/notifications requires auth", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  test("GET /api/notifications returns paginated notifications", async () => {
    const res = await studentAgent.get("/api/notifications");
    expect(res.status).toBe(200);
    expect(res.body.notifications).toBeDefined();
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBe(1);
  });

  test("GET /api/notifications supports pagination params", async () => {
    const res = await studentAgent.get("/api/notifications?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
  });

  test("GET /api/notifications/unread-count returns count", async () => {
    const res = await studentAgent.get("/api/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
  });

  test("PATCH /api/notifications/:id/read marks as read", async () => {
    // Create a notification for the student
    const notif = await notificationService.create({
      userId: studentId,
      type: "api_test",
      title: "API test",
      message: "Test mark as read",
    });

    const res = await studentAgent.patch(`/api/notifications/${notif.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/read/i);
  });

  test("PATCH /api/notifications/:id/read returns 404 for non-existent", async () => {
    const res = await studentAgent.patch("/api/notifications/99999/read");
    expect(res.status).toBe(404);
  });

  test("PATCH /api/notifications/read-all marks all as read", async () => {
    const res = await studentAgent.patch("/api/notifications/read-all");
    expect(res.status).toBe(200);
    expect(res.body.count).toBeDefined();
  });

  test("DELETE /api/notifications/:id deletes notification", async () => {
    const notif = await notificationService.create({
      userId: studentId,
      type: "delete_api",
      title: "Delete via API",
      message: "Will be deleted",
    });

    const res = await studentAgent.delete(`/api/notifications/${notif.id}`);
    expect(res.status).toBe(200);
  });

  test("DELETE /api/notifications/:id returns 404 for non-existent", async () => {
    const res = await studentAgent.delete("/api/notifications/99999");
    expect(res.status).toBe(404);
  });

  test("users cannot access other users' notifications", async () => {
    // Get the organizer's user ID
    const orgMeRes = await organizerAgent.get("/api/auth/me");
    const organizerId = orgMeRes.body.user.id;

    const notif = await notificationService.create({
      userId: organizerId,
      type: "private_notif",
      title: "Private",
      message: "Only for organizer",
    });

    // Student trying to read organizer's notification
    const res = await studentAgent.patch(`/api/notifications/${notif.id}/read`);
    expect(res.status).toBe(404);

    // Student trying to delete organizer's notification
    const delRes = await studentAgent.delete(`/api/notifications/${notif.id}`);
    expect(delRes.status).toBe(404);
  });
});
