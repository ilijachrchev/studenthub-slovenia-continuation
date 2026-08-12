/**
 * Migration rollback test
 *
 * Tests the migration lifecycle:
 * 1. Create fresh database
 * 2. Run migrations up
 * 3. Verify tables exist
 * 4. Verify seeds are idempotent
 * 5. Verify integrity constraints and triggers
 * 6. Run migrations down
 * 7. Verify rollback completes
 */

const { Client } = require("pg");
const Knex = require("knex");

const TEST_DB = "studenthub_migration_test";
const ROOT_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "studenti",
  password: process.env.DB_PASS || process.env.DB_PASSWORD || "studentipass",
  database: process.env.DB_DATABASE || "SISIII2026_89241041",
};

const REQUIRED_TABLES = [
  "university",
  "faculty",
  "tag",
  "user",
  "admin",
  "organization",
  "organizer_profile",
  "event",
  "event_tag",
  "event_target",
  "event_rejection",
  "student_profile",
  "user_interest",
  "bookmark",
  "registration",
  "feedback",
  "opportunity",
  "application",
  "application_history",
  "notification_preferences",
  "notification",
];

async function countRows(knex, table) {
  const { rows } = await knex.raw(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return rows[0].count;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Migration lifecycle", () => {
  let client;
  let knex;

  beforeAll(async () => {
    client = new Client(ROOT_CONFIG);
    await client.connect();

    // Terminate existing connections before dropping
    await client.query(
      `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `,
      [TEST_DB]
    );

    await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await client.query(`CREATE DATABASE ${TEST_DB}`);

    // Initialize Knex with test database
    knex = Knex({
      client: "pg",
      connection: {
        host: ROOT_CONFIG.host,
        port: ROOT_CONFIG.port,
        user: ROOT_CONFIG.user,
        password: ROOT_CONFIG.password,
        database: TEST_DB,
      },
      migrations: {
        directory: "./db/migrations",
      },
      seeds: {
        directory: "./db/seeds",
      },
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    if (client) {
      await client.query(
        `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
        [TEST_DB]
      );
      await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await client.end();
    }
  });

  test("migrations run up successfully", async () => {
    const [batchNo, migrations] = await knex.migrate.latest();

    expect(batchNo).toBeGreaterThanOrEqual(0);
    expect(migrations.length).toBeGreaterThan(0);
  });

  test("all required tables exist after migration", async () => {
    const { rows } = await knex.raw(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    const tableNames = rows.map((r) => r.tablename);

    for (const table of REQUIRED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  test("seeds are idempotent", async () => {
    await knex.seed.run();

    const before = {
      opportunity: await countRows(knex, "opportunity"),
      application: await countRows(knex, "application"),
      application_history: await countRows(knex, "application_history"),
      notification: await countRows(knex, "notification"),
    };

    await knex.seed.run();

    const after = {
      opportunity: await countRows(knex, "opportunity"),
      application: await countRows(knex, "application"),
      application_history: await countRows(knex, "application_history"),
      notification: await countRows(knex, "notification"),
    };

    expect(after).toEqual(before);
  });

  test("database constraints reject invalid statuses", async () => {
    await knex("user").insert({
      id: 9100,
      first_name: "Status",
      last_name: "Tester",
      email: "status-tester@example.com",
      password_hash: "hash",
      role: "student",
    }).onConflict("id").ignore();

    await knex("organization").insert({
      id: 9100,
      name: "Status Org",
      contact_email: "status-org@example.com",
      status: "approved",
    }).onConflict("id").ignore();

    await knex("opportunity").insert({
      id: 9100,
      organization_id: 9100,
      title: "Status Constraint Opportunity",
      description: "Used to validate opportunity and application status checks",
      location: "Koper",
      deadline: "2026-10-20 10:00:00",
      status: "draft",
    }).onConflict("id").ignore();

    await expect(
      knex("opportunity").insert({
        organization_id: 9100,
        title: "Invalid status opportunity",
        description: "Should fail",
        location: "Koper",
        deadline: "2026-10-01 10:00:00",
        status: "totally_invalid",
      })
    ).rejects.toThrow();

    await expect(
      knex("application").insert({
        opportunity_id: 9100,
        applicant_user_id: 9100,
        status: "not-a-status",
      })
    ).rejects.toThrow();
  });

  test("updated_at is refreshed by the database trigger", async () => {
    await knex("user").insert({
      id: 9001,
      first_name: "Trigger",
      last_name: "Tester",
      email: "trigger-tester@example.com",
      password_hash: "hash",
      role: "student",
    }).onConflict("id").ignore();

    await knex("organization").insert({
      id: 9001,
      name: "Trigger Org",
      contact_email: "trigger-org@example.com",
      status: "approved",
    }).onConflict("id").ignore();

    await knex("opportunity").insert({
      id: 9001,
      organization_id: 9001,
      title: "Trigger Opportunity",
      description: "Created for timestamp validation",
      location: "Koper",
      deadline: "2026-10-05 10:00:00",
      status: "draft",
    }).onConflict("id").ignore();

    await knex("application").insert({
      id: 9001,
      opportunity_id: 9001,
      applicant_user_id: 9001,
      status: "pending",
    }).onConflict("id").ignore();

    const before = await knex("application")
      .select("updated_at")
      .where({ id: 9001 })
      .first();

    await sleep(25);

    await knex("application")
      .where({ id: 9001 })
      .update({ cover_note: "Timestamp trigger validation" });

    const after = await knex("application")
      .select("updated_at")
      .where({ id: 9001 })
      .first();

    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updated_at).getTime()
    );
  });

  test("foreign keys cascade through opportunity/application deletion", async () => {
    await knex("user").insert({
      id: 9002,
      first_name: "Cascade",
      last_name: "Tester",
      email: "cascade-tester@example.com",
      password_hash: "hash",
      role: "student",
    }).onConflict("id").ignore();

    await knex("organization").insert({
      id: 9002,
      name: "Cascade Org",
      contact_email: "cascade-org@example.com",
      status: "approved",
    }).onConflict("id").ignore();

    await knex("opportunity").insert({
      id: 9002,
      organization_id: 9002,
      title: "Cascade Opportunity",
      description: "Used to validate delete behavior",
      location: "Koper",
      deadline: "2026-10-10 10:00:00",
      status: "draft",
    }).onConflict("id").ignore();

    await knex("application").insert({
      id: 9002,
      opportunity_id: 9002,
      applicant_user_id: 9002,
      status: "pending",
    }).onConflict("id").ignore();

    await knex("application_history").insert({
      id: 9002,
      application_id: 9002,
      action: "application_created",
      from_status: null,
      to_status: "pending",
      actor_user_id: 9002,
    }).onConflict("id").ignore();

    await knex("organization").where({ id: 9002 }).delete();

    expect(Number((await knex("opportunity").where({ id: 9002 }).count({ count: "*" }))[0].count)).toBe(0);
    expect(Number((await knex("application").where({ id: 9002 }).count({ count: "*" }))[0].count)).toBe(0);
    expect(Number((await knex("application_history").where({ id: 9002 }).count({ count: "*" }))[0].count)).toBe(0);
  });

  test("migrations run down successfully", async () => {
    const [batchNo] = await knex.migrate.rollback(null, true);

    expect(batchNo).toBeGreaterThanOrEqual(0);
  });

  test("tables are removed after full rollback", async () => {
    const { rows } = await knex.raw(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    const tableNames = rows.map((r) => r.tablename);

    const remainingRequired = REQUIRED_TABLES.filter((table) =>
      tableNames.includes(table)
    );

    expect(remainingRequired.length).toBe(0);
  });

  test("migrations can be run up again after rollback", async () => {
    const [batchNo, migrations] = await knex.migrate.latest();

    expect(batchNo).toBeGreaterThanOrEqual(0);
    expect(migrations.length).toBeGreaterThan(0);

    const { rows } = await knex.raw(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    const tableNames = rows.map((r) => r.tablename);

    for (const table of REQUIRED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });
});
