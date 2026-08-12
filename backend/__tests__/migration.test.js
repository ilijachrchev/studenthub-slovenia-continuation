/**
 * Migration rollback test
 *
 * Tests the migration lifecycle:
 * 1. Create fresh database
 * 2. Run migrations up
 * 3. Verify tables exist
 * 4. Run migrations down
 * 5. Verify rollback completes
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
  "session",
  "opportunity",
  "application",
  "application_history",
  "notification_preferences",
  "notification",
  "opportunity_tag",
  "opportunity_bookmark",
];

describe("Migration lifecycle", () => {
  let client;
  let knex;

  beforeAll(async () => {
    client = new Client(ROOT_CONFIG);
    await client.connect();

    // Terminate existing connections before dropping
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [TEST_DB]);

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
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    if (client) {
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [TEST_DB]);
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

  test("opportunity has an updated_at column after migration", async () => {
    const { rows } = await knex.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'opportunity' AND column_name = 'updated_at'`
    );
    expect(rows.length).toBe(1);
  });

  test("updated_at trigger overrides a manual stale value on UPDATE", async () => {
    const { rows: orgRows } = await knex.raw(
      `INSERT INTO organization (name, contact_email) VALUES ('Trig Org', 'trig@example.com') RETURNING id`
    );
    const orgId = orgRows[0].id;
    const { rows: oppRows } = await knex.raw(
      `INSERT INTO opportunity (organization_id, title, deadline)
       VALUES (?, 'Trigger test', NOW() + INTERVAL '1 day') RETURNING id`,
      [orgId]
    );
    const oppId = oppRows[0].id;

    // Attempt to write a clearly stale timestamp; the BEFORE UPDATE trigger must overwrite it.
    await knex.raw(
      `UPDATE opportunity SET updated_at = TIMESTAMP '2000-01-01 00:00:00' WHERE id = ?`,
      [oppId]
    );

    const { rows } = await knex.raw(
      `SELECT EXTRACT(YEAR FROM updated_at)::int AS yr FROM opportunity WHERE id = ?`,
      [oppId]
    );
    expect(rows[0].yr).not.toBe(2000);
    expect(rows[0].yr).toBeGreaterThanOrEqual(2026);
  });

  test("deleting an opportunity cascades to its applications", async () => {
    const { rows: orgRows } = await knex.raw(
      `INSERT INTO organization (name, contact_email) VALUES ('Cascade Org', 'cascade@example.com') RETURNING id`
    );
    const orgId = orgRows[0].id;
    const { rows: userRows } = await knex.raw(
      `INSERT INTO "user" (first_name, last_name, email, password_hash, role)
       VALUES ('Cas', 'Cade', 'cascade-user@example.com', 'x', 'student') RETURNING id`
    );
    const userId = userRows[0].id;
    const { rows: oppRows } = await knex.raw(
      `INSERT INTO opportunity (organization_id, title, deadline)
       VALUES (?, 'Cascade test', NOW() + INTERVAL '1 day') RETURNING id`,
      [orgId]
    );
    const oppId = oppRows[0].id;
    await knex.raw(
      `INSERT INTO application (opportunity_id, applicant_user_id) VALUES (?, ?)`,
      [oppId, userId]
    );

    await knex.raw(`DELETE FROM opportunity WHERE id = ?`, [oppId]);

    const { rows } = await knex.raw(
      `SELECT COUNT(*)::int AS cnt FROM application WHERE opportunity_id = ?`,
      [oppId]
    );
    expect(rows[0].cnt).toBe(0);
  });

  test("migrations run down successfully", async () => {
    const [batchNo, migrations] = await knex.migrate.rollback(null, true);

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
