const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  max: 10,
});

pool.on("error", (err) => {
  if (process.env.NODE_ENV !== "test") {
    console.error("Unexpected PostgreSQL pool error", err);
  }
});

module.exports = pool;
