const pool = require("../../db");
const {
  uniqueSuffix,
  insertUser,
  loginAgent,
  insertNotification,
} = require("./testUtils");

describe("notifications", () => {
  let user;
  let agent;
  const notificationIds = [];

  beforeAll(async () => {
    user = await insertUser({
      email: `${uniqueSuffix("notifications")}@famnit.upr.si`,
      firstName: "Noti",
      lastName: "User",
      password: "testpass123",
      role: "student",
    });
    agent = await loginAgent(user.email, user.password);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM notification WHERE recipient_user_id = $1", [user.id]);
    await pool.query("DELETE FROM notification_preferences WHERE user_id = $1", [user.id]);
    notificationIds.length = 0;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM notification WHERE recipient_user_id = $1", [user.id]);
    await pool.query("DELETE FROM notification_preferences WHERE user_id = $1", [user.id]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [user.id]);
    await pool.end();
  });

  test("lists notifications with unread counts and unread filtering", async () => {
    notificationIds.push(
      await insertNotification({
        recipientUserId: user.id,
        type: "application.received",
        payload: { opportunityId: 11 },
        isRead: false,
        createdAt: "2026-08-01 09:00:00",
      }),
      await insertNotification({
        recipientUserId: user.id,
        type: "application.status_changed",
        payload: { opportunityId: 12 },
        isRead: false,
        createdAt: "2026-08-01 10:00:00",
      }),
      await insertNotification({
        recipientUserId: user.id,
        type: "deadline_reminder",
        payload: { opportunityId: 13 },
        isRead: true,
        createdAt: "2026-08-01 11:00:00",
        readAt: "2026-08-01 11:05:00",
      })
    );

    const listRes = await agent.get("/api/notifications");
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(3);
    expect(listRes.body.unread_count).toBe(2);
    expect(listRes.body.items).toHaveLength(3);

    const unreadRes = await agent.get("/api/notifications?unread=1");
    expect(unreadRes.status).toBe(200);
    expect(unreadRes.body.total).toBe(2);
    expect(unreadRes.body.items).toHaveLength(2);
    expect(unreadRes.body.items.every((item) => item.is_read === false)).toBe(true);

    const pagedRes = await agent.get("/api/notifications?limit=1&page=2");
    expect(pagedRes.status).toBe(200);
    expect(pagedRes.body.limit).toBe(1);
    expect(pagedRes.body.page).toBe(2);
    expect(pagedRes.body.items).toHaveLength(1);
  });

  test("marks a notification as read and blocks unknown ids", async () => {
    const id = await insertNotification({
      recipientUserId: user.id,
      type: "application.received",
      payload: { opportunityId: 21 },
      isRead: false,
    });

    const markRes = await agent.post(`/api/notifications/${id}/read`);
    expect(markRes.status).toBe(200);
    expect(markRes.body.notification.id).toBe(id);
    expect(markRes.body.notification.is_read).toBe(true);

    const { rows } = await pool.query(
      "SELECT is_read, read_at FROM notification WHERE id = $1",
      [id]
    );
    expect(rows[0].is_read).toBe(true);
    expect(rows[0].read_at).not.toBeNull();

    const missingRes = await agent.post("/api/notifications/999999/read");
    expect(missingRes.status).toBe(404);
  });

  test("marks all unread notifications as read", async () => {
    await insertNotification({
      recipientUserId: user.id,
      type: "application.received",
      payload: { opportunityId: 31 },
      isRead: false,
    });
    await insertNotification({
      recipientUserId: user.id,
      type: "application.status_changed",
      payload: { opportunityId: 32 },
      isRead: false,
    });

    const res = await agent.post("/api/notifications/read-all");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS unread FROM notification WHERE recipient_user_id = $1 AND is_read = false",
      [user.id]
    );
    expect(rows[0].unread).toBe(0);
  });

  test("returns defaults and validates notification preferences payloads", async () => {
    const defaultRes = await agent.get("/api/notifications/preferences");
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.preferences["application.received"]).toBe(true);

    const invalidRes = await agent.put("/api/notifications/preferences").send({
      preferences: "not-an-object",
    });
    expect(invalidRes.status).toBe(400);

    const updateRes = await agent.put("/api/notifications/preferences").send({
      preferences: {
        "application.received": false,
        "application.status_changed": true,
      },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.preferences["application.received"]).toBe(false);

    const stored = await agent.get("/api/notifications/preferences");
    expect(stored.status).toBe(200);
    expect(stored.body.preferences["application.received"]).toBe(false);
  });
});
