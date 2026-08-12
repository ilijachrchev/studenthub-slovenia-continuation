const { Client } = require("pg");
const Knex = require("knex");

const TEST_DB = "studenthub_test";
const PREPARED = process.env.TEST_DB_ALREADY_PREPARED === "true";
const ROOT_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: "studenti",
  password: "studentipass",
  database: "SISIII2026_89241041",
};

async function resetSequences(knex) {
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
}

module.exports = async function globalSetup() {
  const knexConfig = require("../knexfile").test;
  knexConfig.connection.database = TEST_DB;
  const knex = Knex(knexConfig);

  try {
    if (!PREPARED) {
      const client = new Client(ROOT_CONFIG);
      await client.connect();

      // Terminate existing connections to the test database
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [TEST_DB]);

      // Drop and recreate test database
      await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await client.query(`CREATE DATABASE ${TEST_DB} TEMPLATE template0`);

      await client.end();
    }

    await knex.migrate.latest();
    await knex.seed.run();
    await resetSequences(knex);
  } finally {
    await knex.destroy();
  }
};
