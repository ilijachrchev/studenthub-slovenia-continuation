const { Client } = require("pg");

const TEST_DB = "studenthub_test";
const ROOT_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "studenti",
  password: process.env.DB_PASS || process.env.DB_PASSWORD || "studentipass",
  database: process.env.DB_DATABASE || "SISIII2026_89241041",
};

module.exports = async function globalTeardown() {
  const client = new Client(ROOT_CONFIG);
  await client.connect();

  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await client.end();
};
