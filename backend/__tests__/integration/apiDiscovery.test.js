const request = require("supertest");
const app = require("../../app");

describe("API discovery", () => {
  test("GET /api exposes mounted route registry", async () => {
    const res = await request(app).get("/api");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(Array.isArray(res.body.routes)).toBe(true);

    const mounts = res.body.routes.map((route) => route.mount);
    expect(mounts).toEqual(expect.arrayContaining([
      "/api/auth",
      "/api/student",
      "/api/events",
      "/api/registrations",
      "/api/organizations",
      "/api/organizer",
      "/api/admin",
      "/api/bookmarks",
      "/api/feedback",
      "/api/search",
      "/api/applications",
      "/api/notifications",
    ]));
  });
});
