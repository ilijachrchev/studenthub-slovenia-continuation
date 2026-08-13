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
