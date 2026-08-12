const { Pool } = require("pg");
const { getAppRuntimeConfig } = require("./config/runtime");

const runtime = getAppRuntimeConfig();

const pool = new Pool({
  host: runtime.db.host,
  user: runtime.db.user,
  password: runtime.db.password,
  database: runtime.db.database,
  port: runtime.db.port,
  max: 10,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "5000", 10),
});

module.exports = pool;
