const bcrypt = require("bcryptjs");
const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

function uniqueSuffix(label) {
  return `${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function insertUser({
  email,
  firstName = "Test",
  lastName = "User",
  password = "testpass123",
  role = "student",
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO "user" (first_name, last_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [firstName, lastName, email, passwordHash, role]
  );

  return { id: rows[0].id, email, password, role, firstName, lastName };
}

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status}`);
  }
  return agent;
}

async function insertOpportunity({
  organizationId = 1,
  title,
  deadline = "2027-12-31 23:59:00",
  status = "published",
}) {
  const { rows } = await pool.query(
    `INSERT INTO opportunity (organization_id, title, description, location, status, deadline, created_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING id`,
    [
      organizationId,
      title,
      `Description for ${title}`,
      "Koper",
      status,
      deadline,
    ]
  );

  const opportunityId = rows[0].id;
  return opportunityId;
}

async function insertNotification({
  recipientUserId,
  type = "application.received",
  payload = {},
  isRead = false,
  createdAt = "2026-01-01 10:00:00",
  readAt = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO notification (recipient_user_id, type, payload, is_read, created_at, read_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING id`,
    [recipientUserId, type, JSON.stringify(payload), isRead, createdAt, readAt]
  );

  return rows[0].id;
}

async function deleteOpportunityData({ opportunityIds = [], applicationIds = [], notificationRecipientIds = [], userIds = [] }) {
  if (applicationIds.length > 0) {
    await pool.query(
      `DELETE FROM application_history WHERE application_id = ANY($1::int[])`,
      [applicationIds]
    );
    await pool.query(
      `DELETE FROM application WHERE id = ANY($1::int[])`,
      [applicationIds]
    );
  }

  if (opportunityIds.length > 0) {
    await pool.query(
      `DELETE FROM opportunity WHERE id = ANY($1::int[])`,
      [opportunityIds]
    );
  }

  if (notificationRecipientIds.length > 0) {
    await pool.query(
      `DELETE FROM notification_preferences WHERE user_id = ANY($1::int[])`,
      [notificationRecipientIds]
    );
    await pool.query(
      `DELETE FROM notification WHERE recipient_user_id = ANY($1::int[])`,
      [notificationRecipientIds]
    );
  }

  if (userIds.length > 0) {
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1::int[])`, [userIds]);
  }
}

module.exports = {
  uniqueSuffix,
  insertUser,
  loginAgent,
  insertOpportunity,
  insertNotification,
  deleteOpportunityData,
};
