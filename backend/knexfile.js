require("dotenv").config();

const client = process.env.DB_CLIENT || "pg";
const defaultPort = client === "pg" ? "5432" : "3306";

module.exports = {
  development: {
    client,
    connection: {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || defaultPort, 10),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || process.env.DB_PASSWORD || "",
      database: process.env.DB_DATABASE || "SISIII2026_89241041",
    },
    migrations: {
      directory: "./db/migrations",
    },
    seeds: {
      directory: "./db/seeds",
    },
  },

  test: {
    client,
    connection: {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || defaultPort, 10),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || process.env.DB_PASSWORD || "",
      database: process.env.DB_DATABASE || "studenthub_test",
    },
    migrations: {
      directory: "./db/migrations",
    },
    seeds: {
      directory: "./db/seeds",
    },
  },

  production: {
    client,
    connection: {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || defaultPort, 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASS || process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    },
    migrations: {
      directory: "./db/migrations",
    },
    seeds: {
      directory: "./db/seeds",
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};
