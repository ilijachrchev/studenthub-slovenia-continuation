const { Client } = require("pg");

const TEST_DB = "studenthub_test";
const PREPARED = process.env.TEST_DB_ALREADY_PREPARED === "true";
const ROOT_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "studenti",
  password: process.env.DB_PASS || process.env.DB_PASSWORD || "studentipass",
  database: process.env.DB_DATABASE || "SISIII2026_89241041",
};

module.exports = async function globalTeardown() {
  if (PREPARED) {
    return;
  }

  const client = new Client(ROOT_CONFIG);
  await client.connect();

  // Terminate connections before dropping
  await client.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [TEST_DB]);

  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await client.end();
};
