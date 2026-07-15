const { Client } = require("pg");
const Knex = require("knex");

const TEST_DB = "studenthub_test";
const ROOT_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: "studenti",
  password: "studentipass",
  database: "SISIII2026_89241041",
};

async function dropIfExists(client, dbName) {
  // Terminate any lingering connections first
  await client.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [dbName]).catch(() => {});
  await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
}

module.exports = async function globalSetup() {
  const client = new Client(ROOT_CONFIG);

  // Retry loop: forceExit from a prior run can leave PostgreSQL cleaning up
  // connections in the background. Retry the drop+create up to 3 times.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.connect();
      await dropIfExists(client, TEST_DB);
      await client.query(`CREATE DATABASE ${TEST_DB}`);
      await client.end();
      break;
    } catch (err) {
      await client.end().catch(() => {});
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Run migrations using Knex
  const knexConfig = require("../knexfile").test;
  knexConfig.connection.database = TEST_DB;
  const knex = Knex(knexConfig);

  try {
    await knex.migrate.latest();
    await knex.seed.run();

    // Reset all sequences to max(id) so auto-increment doesn't collide with seeded IDs
    const tablesToReset = [
      { table: "university", column: "id" },
      { table: "faculty", column: "id" },
      { table: "tag", column: "id" },
      { table: '"user"', column: "id" },
      { table: "organization", column: "id" },
      { table: "event", column: "id" },
    ];
    for (const { table, column } of tablesToReset) {
      const seqName = table.replace(/"/g, "") + "_" + column + "_seq";
      await knex.raw(
        `SELECT setval('${seqName}', COALESCE((SELECT MAX(${column}) FROM ${table}), 1))`
      ).catch(() => {});
    }
  } finally {
    await knex.destroy();
  }
};
