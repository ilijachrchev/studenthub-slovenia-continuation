const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@test.com`;
}

let ipCounter = 1;
function uniqueIp() {
  return `127.0.0.${ipCounter++}`;
}

function withIp(req, ip) {
  return req.set("X-Forwarded-For", ip);
}

async function createOrganizerUser(email, password = "strongpass1") {
  const ip = uniqueIp();
  await withIp(request(app).post("/api/auth/register"), ip).send({
    first_name: "Test",
    last_name: "Organizer",
    email,
    password,
    role: "organizer",
  });
}

describe("authentication", () => {
  const createdUsers = [];

  afterAll(async () => {
    if (createdUsers.length > 0) {
      await pool.query(
        `DELETE FROM "user" WHERE email = ANY($1::text[])`,
        [createdUsers]
      );
    }
  });

  describe("POST /api/auth/register", () => {
    test("registers a new organizer successfully", async () => {
      const email = uniqueEmail("organizer");
      createdUsers.push(email);
      const ip = uniqueIp();

      const res = await withIp(request(app).post("/api/auth/register"), ip)
        .send({
          first_name: "New",
          last_name: "Organizer",
          email,
          password: "strongpass1",
          role: "organizer",
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Registration successful");
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    test("rejects duplicate email", async () => {
      const email = uniqueEmail("duplicate");
      createdUsers.push(email);
      const ip = uniqueIp();

      await withIp(request(app).post("/api/auth/register"), ip).send({
        first_name: "Dup",
        last_name: "User",
        email,
        password: "strongpass1",
        role: "organizer",
      });

      const res = await withIp(request(app).post("/api/auth/register"), ip)
        .send({
          first_name: "Dup",
          last_name: "User",
          email,
          password: "strongpass1",
          role: "organizer",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    test("rejects missing fields", async () => {
      const res = await withIp(request(app).post("/api/auth/register"), uniqueIp())
        .send({ email: "test@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test("rejects invalid email format", async () => {
      const res = await withIp(request(app).post("/api/auth/register"), uniqueIp())
        .send({
          first_name: "Bad",
          last_name: "Email",
          email: "not-an-email",
          password: "strongpass1",
          role: "organizer",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    test("rejects weak password", async () => {
      const res = await withIp(request(app).post("/api/auth/register"), uniqueIp())
        .send({
          first_name: "Weak",
          last_name: "Pass",
          email: uniqueEmail("weak"),
          password: "short",
          role: "organizer",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });
  });

  describe("POST /api/auth/login", () => {
    test("logs in with correct credentials", async () => {
      const email = uniqueEmail("login");
      createdUsers.push(email);
      await createOrganizerUser(email, "strongpass1");
      const ip = uniqueIp();

      const res = await withIp(request(app).post("/api/auth/login"), ip)
        .send({
          email,
          password: "strongpass1",
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Login successful");
      expect(res.body.user.role).toBe("organizer");
      expect(res.body.user.email).toBe(email);
    });

    test("rejects wrong password", async () => {
      const email = uniqueEmail("wrong-password");
      createdUsers.push(email);
      await createOrganizerUser(email, "strongpass1");
      const ip = uniqueIp();

      const res = await withIp(request(app).post("/api/auth/login"), ip)
        .send({
          email,
          password: "wrongpassword",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    test("rejects non-existent email", async () => {
      const res = await withIp(request(app).post("/api/auth/login"), uniqueIp())
        .send({
          email: uniqueEmail("missing"),
          password: "anypassword",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    test("rejects missing fields", async () => {
      const res = await withIp(request(app).post("/api/auth/login"), uniqueIp())
        .send({ email: "test@test.com" });

      expect(res.status).toBe(400);
    });
  });

  describe("session lifecycle", () => {
    test("GET /api/auth/me returns user when logged in and 401 when not", async () => {
      const unauthenticated = await withIp(request(app).get("/api/auth/me"), uniqueIp());
      expect(unauthenticated.status).toBe(401);

      const email = uniqueEmail("me");
      createdUsers.push(email);
      await createOrganizerUser(email, "strongpass1");
      const ip = uniqueIp();

      const agent = request.agent(app);
      await withIp(agent.post("/api/auth/login"), ip).send({ email, password: "strongpass1" });

      const res = await withIp(agent.get("/api/auth/me"), ip);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
    });

    test("logout destroys the session", async () => {
      const email = uniqueEmail("logout");
      createdUsers.push(email);
      await createOrganizerUser(email, "strongpass1");
      const ip = uniqueIp();

      const agent = request.agent(app);
      await withIp(agent.post("/api/auth/login"), ip).send({ email, password: "strongpass1" });

      const res = await withIp(agent.post("/api/auth/logout"), ip);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Logged out");

      const meRes = await withIp(agent.get("/api/auth/me"), ip);
      expect(meRes.status).toBe(401);
    });
  });

  describe("POST /api/auth/reset-password", () => {
    test("resets password successfully and invalidates the old password", async () => {
      const email = uniqueEmail("reset");
      createdUsers.push(email);
      await createOrganizerUser(email, "oldpass123");
      const ip = uniqueIp();

      const agent = request.agent(app);
      await withIp(agent.post("/api/auth/login"), ip).send({ email, password: "oldpass123" });

      const res = await withIp(agent.post("/api/auth/reset-password"), ip).send({
        email,
        current_password: "oldpass123",
        new_password: "newsecurepass1",
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/password updated/i);

      const oldLogin = await withIp(request(app).post("/api/auth/login"), uniqueIp())
        .send({ email, password: "oldpass123" });
      expect(oldLogin.status).toBe(401);

      const newLogin = await withIp(request(app).post("/api/auth/login"), uniqueIp())
        .send({ email, password: "newsecurepass1" });
      expect(newLogin.status).toBe(200);
    });

    test("rejects wrong current password", async () => {
      const email = uniqueEmail("reset-wrong");
      createdUsers.push(email);
      await createOrganizerUser(email, "oldpass123");
      const ip = uniqueIp();

      const res = await withIp(request(app).post("/api/auth/reset-password"), ip)
        .send({
          email,
          current_password: "wrongoldpass",
          new_password: "newsecurepass1",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    test("rejects weak new password", async () => {
      const email = uniqueEmail("reset-weak");
      createdUsers.push(email);
      await createOrganizerUser(email, "oldpass123");
      const ip = uniqueIp();

      const res = await withIp(request(app).post("/api/auth/reset-password"), ip)
        .send({
          email,
          current_password: "oldpass123",
          new_password: "short",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });
  });
});
