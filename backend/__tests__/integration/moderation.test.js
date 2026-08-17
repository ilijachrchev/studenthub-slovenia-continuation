const request = require("supertest");
const app = require("../../app");
const pool = require("../../db");

let adminAgent, moderatorAgent, moderatorBAgent, organizerAgent, reporterAgent, reporterBAgent, outsiderAgent;
let orgId, ownerUserId, reporterUserId, reporterBUserId, moderatorUserId, moderatorBUserId;

async function createOpportunity(title, organizationId = orgId, overrides = {}) {
  const { rows } = await pool.query(
    `INSERT INTO opportunity (organization_id, title, description, location, status, deadline)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')
     RETURNING id`,
    [
      organizationId,
      title,
      overrides.description || "Test opportunity",
      overrides.location || "Remote",
      overrides.status || "published",
    ]
  );
  return rows[0].id;
}

async function registerAndLogin(email, password, role, facultyDomain) {
  await request(app).post("/api/auth/register").send({
    first_name: "Test",
    last_name: "User",
    email,
    password,
    role,
  });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password });
  return agent;
}

beforeAll(async () => {
  // Organizer who owns the reported content.
  organizerAgent = await registerAndLogin("mod-owner@test.com", "testpass123", "organizer");
  const { rows: userRows } = await pool.query('SELECT id FROM "user" WHERE email = $1', ["mod-owner@test.com"]);
  ownerUserId = userRows[0].id;

  const { rows: orgRows } = await pool.query(
    `INSERT INTO organization (name, contact_email, status, approved_at)
     VALUES ('Moderation Test Org', 'org@test.com', 'approved', NOW())
     RETURNING id`
  );
  orgId = orgRows[0].id;
  await pool.query(
    "INSERT INTO organizer_profile (user_id, organization_id, role_in_org) VALUES ($1, $2, 'owner')",
    [ownerUserId, orgId]
  );

  // Reporters (plain students).
  reporterAgent = await registerAndLogin("mod-reporter-a@famnit.upr.si", "testpass123", "student");
  const { rows: reporterRows } = await pool.query(
    'SELECT id FROM "user" WHERE email = $1',
    ["mod-reporter-a@famnit.upr.si"]
  );
  reporterUserId = reporterRows[0].id;

  reporterBAgent = await registerAndLogin("mod-reporter-b@famnit.upr.si", "testpass123", "student");
  const { rows: reporterBRows } = await pool.query(
    'SELECT id FROM "user" WHERE email = $1',
    ["mod-reporter-b@famnit.upr.si"]
  );
  reporterBUserId = reporterBRows[0].id;

  outsiderAgent = await registerAndLogin("mod-outsider@test.com", "testpass123", "organizer");

  // Admin (registers as organizer, then promoted directly in DB — mirrors
  // how the platform actually provisions admins).
  await registerAndLogin("mod-admin@test.com", "testpass123", "organizer");
  await pool.query("UPDATE \"user\" SET role = 'admin' WHERE email = $1", ["mod-admin@test.com"]);
  const { rows: adminUserRows } = await pool.query('SELECT id FROM "user" WHERE email = $1', ["mod-admin@test.com"]);
  await pool.query("INSERT INTO admin (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [adminUserRows[0].id]);
  adminAgent = request.agent(app);
  await adminAgent.post("/api/auth/login").send({ email: "mod-admin@test.com", password: "testpass123" });

  // Moderators.
  await registerAndLogin("mod-mod-a@test.com", "testpass123", "organizer");
  await pool.query("UPDATE \"user\" SET role = 'moderator' WHERE email = $1", ["mod-mod-a@test.com"]);
  const { rows: modARows } = await pool.query('SELECT id FROM "user" WHERE email = $1', ["mod-mod-a@test.com"]);
  moderatorUserId = modARows[0].id;
  await pool.query("INSERT INTO moderator (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [moderatorUserId]);
  moderatorAgent = request.agent(app);
  await moderatorAgent.post("/api/auth/login").send({ email: "mod-mod-a@test.com", password: "testpass123" });

  await registerAndLogin("mod-mod-b@test.com", "testpass123", "organizer");
  await pool.query("UPDATE \"user\" SET role = 'moderator' WHERE email = $1", ["mod-mod-b@test.com"]);
  const { rows: modBRows } = await pool.query('SELECT id FROM "user" WHERE email = $1', ["mod-mod-b@test.com"]);
  moderatorBUserId = modBRows[0].id;
  await pool.query("INSERT INTO moderator (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [moderatorBUserId]);
  moderatorBAgent = request.agent(app);
  await moderatorBAgent.post("/api/auth/login").send({ email: "mod-mod-b@test.com", password: "testpass123" });
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM "user" WHERE email IN (
      'mod-owner@test.com', 'mod-reporter-a@famnit.upr.si', 'mod-reporter-b@famnit.upr.si',
      'mod-outsider@test.com', 'mod-admin@test.com', 'mod-mod-a@test.com', 'mod-mod-b@test.com'
    )`
  );
  await pool.end();
});

describe("POST /api/moderation/reports — report intake", () => {
  test("rejects unauthenticated submission", async () => {
    const oppId = await createOpportunity("Unauth report target");
    const res = await request(app)
      .post("/api/moderation/reports")
      .send({ target_type: "opportunity", target_id: oppId, category: "spam", reason: "This looks like spam." });
    expect(res.status).toBe(401);
  });

  test("creates a report as a normal authenticated user", async () => {
    const oppId = await createOpportunity("Reportable listing");
    const res = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "This posting looks like spam content.",
    });

    expect(res.status).toBe(201);
    expect(res.body.reportId).toBeDefined();
    expect(res.body.status).toBe("open");
  });

  test("rejects malformed payloads", async () => {
    const oppId = await createOpportunity("Malformed payload target");

    const noReason = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "short",
    });
    expect(noReason.status).toBe(400);

    const badCategory = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "not_a_real_category",
      reason: "A perfectly valid length reason string here.",
    });
    expect(badCategory.status).toBe(400);

    const badTargetType = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "user",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(badTargetType.status).toBe(400);
  });

  test("rejects non-numeric / malicious target_id without a 500", async () => {
    const res = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: "1); DROP TABLE moderation_report;--",
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(res.status).toBe(400);
  });

  test("404s for a target that does not exist", async () => {
    const res = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: 999999999,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(res.status).toBe(404);
  });

  test("blocks duplicate active reports from the same reporter", async () => {
    const oppId = await createOpportunity("Duplicate report target");

    const first = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(first.status).toBe(201);

    const second = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "other",
      reason: "A different but still valid reason string.",
    });
    expect(second.status).toBe(409);

    // A different reporter targeting the same content is not a duplicate.
    const third = await reporterBAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(third.status).toBe(201);
  });

  test("a non-owner organizer can report someone else's listing (not a self-report)", async () => {
    const oppId = await createOpportunity("Non-owner reportable listing");
    const res = await outsiderAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "misleading_information",
      reason: "This listing makes claims that don't match reality.",
    });
    expect(res.status).toBe(201);
  });

  test("blocks self-reporting your own listing", async () => {
    const oppId = await createOpportunity("Own listing");
    const res = await organizerAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(res.status).toBe(400);
  });

  test("rate-limits a reporter submitting too many reports", async () => {
    // Temporarily lower the per-user limit so this test stays fast and
    // doesn't interfere with the shared reporter accounts used elsewhere.
    const previousLimit = process.env.MODERATION_REPORTS_PER_HOUR_LIMIT;
    process.env.MODERATION_REPORTS_PER_HOUR_LIMIT = "3";

    try {
      const rateLimitedAgent = await registerAndLogin("mod-rate-limited@famnit.upr.si", "testpass123", "student");
      const opportunityIds = [];
      for (let i = 0; i < 4; i++) {
        opportunityIds.push(await createOpportunity(`Rate limit target ${i}`));
      }

      const results = [];
      for (const oppId of opportunityIds) {
        const res = await rateLimitedAgent.post("/api/moderation/reports").send({
          target_type: "opportunity",
          target_id: oppId,
          category: "spam",
          reason: "A perfectly valid length reason string here.",
        });
        results.push(res.status);
      }

      expect(results).toEqual([201, 201, 201, 429]);
    } finally {
      process.env.MODERATION_REPORTS_PER_HOUR_LIMIT = previousLimit;
      await pool.query('DELETE FROM "user" WHERE email = $1', ["mod-rate-limited@famnit.upr.si"]);
    }
  });
});

describe("GET /api/moderation/reports/mine", () => {
  test("only returns the caller's own reports, without moderator-internal fields", async () => {
    const oppId = await createOpportunity("Mine-only target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(created.status).toBe(201);

    const mine = await reporterAgent.get("/api/moderation/reports/mine");
    expect(mine.status).toBe(200);
    const ids = mine.body.reports.map((r) => r.id);
    expect(ids).toContain(created.body.reportId);
    for (const report of mine.body.reports) {
      expect(report.reporter_email).toBeUndefined();
      expect(report.assigned_moderator_user_id).toBeUndefined();
      expect(report.reason).toBeUndefined();
    }

    const othersReports = await reporterBAgent.get("/api/moderation/reports/mine");
    expect(othersReports.body.reports.map((r) => r.id)).not.toContain(created.body.reportId);
  });
});

describe("authorization boundaries on the moderation queue/detail", () => {
  let oppId, reportId;

  beforeAll(async () => {
    oppId = await createOpportunity("Authz boundary target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    reportId = created.body.reportId;
  });

  test("unauthenticated requests are rejected", async () => {
    const res = await request(app).get("/api/moderation/queue");
    expect(res.status).toBe(401);
  });

  test("plain students cannot access the queue (IDOR/privilege check)", async () => {
    const res = await reporterAgent.get("/api/moderation/queue");
    expect(res.status).toBe(403);
  });

  test("organizers cannot access the queue", async () => {
    const res = await organizerAgent.get("/api/moderation/queue");
    expect(res.status).toBe(403);
  });

  test("the reporter cannot fetch their own report via the moderator detail endpoint (IDOR)", async () => {
    const res = await reporterAgent.get(`/api/moderation/reports/${reportId}`);
    expect(res.status).toBe(403);
  });

  test("moderators can access the queue and see the report", async () => {
    const res = await moderatorAgent.get("/api/moderation/queue");
    expect(res.status).toBe(200);
    expect(res.body.reports.map((r) => r.id)).toContain(reportId);
  });

  test("admins can access the queue", async () => {
    const res = await adminAgent.get("/api/moderation/queue");
    expect(res.status).toBe(200);
  });

  test("a session claiming role=moderator without a moderator table row is still rejected", async () => {
    // Simulates a stale/forged session role — the DB record check is what
    // actually gates access, not the role string carried in the session.
    await registerAndLogin("mod-fake@test.com", "testpass123", "organizer");
    await pool.query("UPDATE \"user\" SET role = 'moderator' WHERE email = $1", ["mod-fake@test.com"]);
    const fakeAgent = request.agent(app);
    await fakeAgent.post("/api/auth/login").send({ email: "mod-fake@test.com", password: "testpass123" });

    const res = await fakeAgent.get("/api/moderation/queue");
    expect(res.status).toBe(403);

    await pool.query('DELETE FROM "user" WHERE email = $1', ["mod-fake@test.com"]);
  });

  test("malicious/non-numeric report ids 404 instead of erroring", async () => {
    const res = await moderatorAgent.get("/api/moderation/reports/not-a-number");
    expect(res.status).toBe(404);
    expect(res.body.error).not.toMatch(/SELECT|syntax|stack/i);
  });
});

describe("assignment (claim/release) and concurrency", () => {
  test("a moderator can claim an open report", async () => {
    const oppId = await createOpportunity("Claim target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    const claim = await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    expect(claim.status).toBe(200);
    expect(claim.body.report.status).toBe("under_review");
    expect(claim.body.report.assigned_moderator_user_id).toBe(moderatorUserId);
  });

  test("a second moderator cannot claim an already-claimed report", async () => {
    const oppId = await createOpportunity("Double claim target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    const first = await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    expect(first.status).toBe(200);

    const second = await moderatorBAgent.post(`/api/moderation/reports/${reportId}/claim`);
    expect(second.status).toBe(409);
  });

  test("concurrent claims on the same report: exactly one wins the race", async () => {
    const oppId = await createOpportunity("Concurrent claim target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    const [resA, resB] = await Promise.all([
      moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`),
      moderatorBAgent.post(`/api/moderation/reports/${reportId}/claim`),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const { rows } = await pool.query(
      "SELECT assigned_moderator_user_id FROM moderation_report WHERE id = $1",
      [reportId]
    );
    expect([moderatorUserId, moderatorBUserId]).toContain(rows[0].assigned_moderator_user_id);
  });

  test("a moderator can release their own claim back to the open queue", async () => {
    const oppId = await createOpportunity("Release target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    const release = await moderatorAgent.post(`/api/moderation/reports/${reportId}/release`);
    expect(release.status).toBe(200);

    const claimAgain = await moderatorBAgent.post(`/api/moderation/reports/${reportId}/claim`);
    expect(claimAgain.status).toBe(200);
  });

  test("a moderator cannot release someone else's claim", async () => {
    const oppId = await createOpportunity("Release-other target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    const release = await moderatorBAgent.post(`/api/moderation/reports/${reportId}/release`);
    expect(release.status).toBe(409);
  });
});

describe("resolution: resolve / dismiss / escalate, transitions, and evidence", () => {
  test("rejects invalid state transitions: resolving an unclaimed report as a non-assigned moderator", async () => {
    const oppId = await createOpportunity("Unclaimed resolve target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    const res = await moderatorBAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({
      action: "no_action",
      note: "Trying to resolve someone else's claim.",
    });
    expect(res.status).toBe(409);
  });

  test("resolving requires a note and a valid action", async () => {
    const oppId = await createOpportunity("Missing note target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;
    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);

    const noNote = await moderatorAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({ action: "no_action" });
    expect(noNote.status).toBe(400);

    const badAction = await moderatorAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({
      action: "delete_everything",
      note: "A valid note here.",
    });
    expect(badAction.status).toBe(400);
  });

  test("assigned moderator can resolve with hide_content and the opportunity is hidden", async () => {
    const oppId = await createOpportunity("Hide-on-resolve target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "scam_or_fraud",
      reason: "This is a clear scam listing that must be reviewed.",
    });
    const reportId = created.body.reportId;

    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    const resolve = await moderatorAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({
      action: "hide_content",
      note: "Confirmed scam, hiding the listing.",
    });

    expect(resolve.status).toBe(200);
    expect(resolve.body.report.status).toBe("resolved");
    expect(resolve.body.report.resolution_action).toBe("hide_content");

    const { rows } = await pool.query("SELECT status FROM opportunity WHERE id = $1", [oppId]);
    expect(rows[0].status).toBe("hidden");
  });

  test("cannot resolve an already-closed report twice (concurrent resolution race)", async () => {
    const oppId = await createOpportunity("Concurrent resolve target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;
    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);

    const [first, second] = await Promise.all([
      moderatorAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({ action: "no_action", note: "First resolution attempt." }),
      moderatorAgent.post(`/api/moderation/reports/${reportId}/dismiss`).send({ note: "Second, racing resolution attempt." }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  test("escalation requires admin sign-off to close", async () => {
    const oppId = await createOpportunity("Escalation target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "discrimination",
      reason: "This listing contains discriminatory language.",
    });
    const reportId = created.body.reportId;

    const escalate = await moderatorAgent.post(`/api/moderation/reports/${reportId}/escalate`).send({
      note: "This needs admin review.",
    });
    expect(escalate.status).toBe(200);
    expect(escalate.body.report.status).toBe("escalated");
    expect(escalate.body.report.severity).toBe("critical");

    const moderatorTriesToClose = await moderatorAgent.post(`/api/moderation/reports/${reportId}/dismiss`).send({
      note: "Trying to close an escalated report as a plain moderator.",
    });
    expect(moderatorTriesToClose.status).toBe(409);

    const adminCloses = await adminAgent.post(`/api/moderation/reports/${reportId}/dismiss`).send({
      note: "Reviewed by admin, no action needed.",
    });
    expect(adminCloses.status).toBe(200);
  });

  test("admin can reassign a report to a different moderator", async () => {
    const oppId = await createOpportunity("Reassign target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;
    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);

    const reassign = await adminAgent.post(`/api/moderation/reports/${reportId}/reassign`).send({
      moderator_user_id: moderatorBUserId,
    });
    expect(reassign.status).toBe(200);
    expect(reassign.body.report.assigned_moderator_user_id).toBe(moderatorBUserId);
  });

  test("a plain moderator cannot reassign reports (admin-only)", async () => {
    const oppId = await createOpportunity("Reassign forbidden target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    const res = await moderatorAgent.post(`/api/moderation/reports/${reportId}/reassign`).send({
      moderator_user_id: moderatorBUserId,
    });
    expect(res.status).toBe(403);
  });
});

describe("evidence preservation & audit trail", () => {
  test("resolving a report produces a full, ordered audit trail", async () => {
    const oppId = await createOpportunity("Audit trail target");
    const created = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    const reportId = created.body.reportId;

    await moderatorAgent.post(`/api/moderation/reports/${reportId}/claim`);
    await moderatorAgent.post(`/api/moderation/reports/${reportId}/resolve`).send({
      action: "no_action",
      note: "Reviewed, no action necessary.",
    });

    const history = await moderatorAgent.get(`/api/moderation/reports/${reportId}/history`);
    expect(history.status).toBe(200);
    const actions = history.body.history.map((entry) => entry.action);
    expect(actions).toEqual(["report_created", "report_claimed", "report_resolved"]);

    // Every entry preserves who acted and when.
    for (const entry of history.body.history) {
      expect(entry.created_at).toBeDefined();
    }
    expect(history.body.history[1].actor_user_id).toBe(moderatorUserId);
  });

  test("the audit log is append-only: direct UPDATE/DELETE are rejected by the database", async () => {
    const { rows } = await pool.query("SELECT id FROM moderation_audit_log ORDER BY id DESC LIMIT 1");
    const auditId = rows[0].id;

    await expect(
      pool.query("UPDATE moderation_audit_log SET action = 'tampered' WHERE id = $1", [auditId])
    ).rejects.toThrow(/append-only/i);

    await expect(
      pool.query("DELETE FROM moderation_audit_log WHERE id = $1", [auditId])
    ).rejects.toThrow(/append-only/i);
  });

  test("a failed report creation (duplicate) does not leave a stray audit entry", async () => {
    const oppId = await createOpportunity("Rollback audit target");
    const first = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(first.status).toBe(201);

    const { rows: beforeRows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM moderation_audit_log WHERE target_type = 'opportunity' AND target_id = $1",
      [oppId]
    );

    const second = await reporterAgent.post("/api/moderation/reports").send({
      target_type: "opportunity",
      target_id: oppId,
      category: "spam",
      reason: "A perfectly valid length reason string here.",
    });
    expect(second.status).toBe(409);

    const { rows: afterRows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM moderation_audit_log WHERE target_type = 'opportunity' AND target_id = $1",
      [oppId]
    );
    expect(afterRows[0].count).toBe(beforeRows[0].count);
  });
});

describe("direct admin content actions", () => {
  test("only admins can directly hide/restore content outside the report workflow", async () => {
    const oppId = await createOpportunity("Direct action target");

    const modAttempt = await moderatorAgent.post(`/api/moderation/opportunities/${oppId}/hide`).send({
      reason: "Trying as a plain moderator.",
    });
    expect(modAttempt.status).toBe(403);

    const hide = await adminAgent.post(`/api/moderation/opportunities/${oppId}/hide`).send({
      reason: "Policy violation confirmed by admin review.",
    });
    expect(hide.status).toBe(200);

    const { rows } = await pool.query("SELECT status FROM opportunity WHERE id = $1", [oppId]);
    expect(rows[0].status).toBe("hidden");

    const restore = await adminAgent.post(`/api/moderation/opportunities/${oppId}/restore`);
    expect(restore.status).toBe(200);
  });
});

describe("API error safety", () => {
  test("errors never leak stack traces, SQL, or internal paths", async () => {
    const res = await moderatorAgent.get("/api/moderation/reports/999999999");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at Object|node_modules|pg-pool|SELECT .* FROM/i);
  });
});
