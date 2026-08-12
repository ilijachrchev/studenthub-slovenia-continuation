const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../../app");
const pool = require("../../db");

afterAll(async () => {
  const restoredHash = await bcrypt.hash("organizer123", 10);
  await pool.query(
    'UPDATE "user" SET password_hash = $1 WHERE email = $2',
    [restoredHash, "organizer@studenthub.test"]
  );
  await pool.end();
});

describe("POST /api/auth/register", () => {
  test("registers a new organizer successfully", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "New",
        last_name: "Organizer",
        email: "neworg@test.com",
        password: "strongpass1",
        role: "organizer",
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Registration successful");

    // session cookie is set
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  test("rejects duplicate email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Dup",
        last_name: "User",
        email: "organizer@studenthub.test",
        password: "strongpass1",
        role: "organizer",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test("rejects missing fields", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "test@test.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test("rejects invalid email format", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Bad",
        last_name: "Email",
        email: "not-an-email",
        password: "strongpass1",
        role: "organizer",
      });

    expect(res.status).toBe(400);
  });

  test("rejects weak password (under 8 chars)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        first_name: "Weak",
        last_name: "Pass",
        email: "weak@test.com",
        password: "short",
        role: "organizer",
      });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  const agent = request.agent(app);

  test("logs in with correct credentials", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "organizer123",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Login successful");
    expect(res.body.user.role).toBe("organizer");
    expect(res.body.user.email).toBe("organizer@studenthub.test");
  });

  test("GET /api/auth/me returns user when logged in", async () => {
    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("organizer@studenthub.test");
  });

  test("rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "wrongpassword",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test("rejects non-existent email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "nobody@test.com",
        password: "anypassword",
      });

    expect(res.status).toBe(401);
  });

  test("rejects missing fields", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@test.com" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  test("returns 401 when not logged in", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not logged in/i);
  });
});

describe("POST /api/auth/logout", () => {
  test("destroys session and returns success", async () => {
    const agent = request.agent(app);

    // login first
    await agent
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "organizer123",
      });

    // logout
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Logged out");

    // me should now return 401
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });
});

describe("POST /api/auth/reset-password", () => {
  test("resets password successfully", async () => {
    const agent = request.agent(app);

    // login
    await agent
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "organizer123",
      });

    // reset password
    const res = await agent
      .post("/api/auth/reset-password")
      .send({
        email: "organizer@studenthub.test",
        current_password: "organizer123",
        new_password: "newsecurepass1",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated/i);

    // old password should no longer work
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "organizer123",
      });
    expect(loginRes.status).toBe(401);

    // new password should work
    const newLoginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: "organizer@studenthub.test",
        password: "newsecurepass1",
      });
    expect(newLoginRes.status).toBe(200);
  });

  test("rejects wrong current password", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: "organizer@studenthub.test",
        current_password: "wrongoldpass",
        new_password: "newsecurepass1",
      });

    expect(res.status).toBe(401);
  });

  test("rejects weak new password", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: "organizer@studenthub.test",
        current_password: "newsecurepass1",
        new_password: "short",
      });

    expect(res.status).toBe(400);
  });
});
