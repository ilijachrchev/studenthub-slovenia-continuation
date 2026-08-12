const { URL } = require("node:url");

const DEFAULT_FRONTEND_URL = "http://localhost:30010";
const DEFAULT_SESSION_SECRET = "dev-only-insecure-secret";
const DEFAULT_PORT = 30011;
const DEFAULT_DB_PORT = 5432;
const ALLOWED_DB_CLIENTS = new Set(["pg", "mysql2"]);

function parseBoolean(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function parsePort(value) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isAbsoluteOrigin(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function buildDatabaseConfig({ strict, errors }) {
  const client = process.env.DB_CLIENT || (strict ? null : "pg");
  if (client && !ALLOWED_DB_CLIENTS.has(client)) {
    errors.push(`DB_CLIENT must be one of: ${Array.from(ALLOWED_DB_CLIENTS).join(", ")}`);
  }

  const host = process.env.DB_HOST || (strict ? null : "localhost");
  if (strict && !nonEmpty(host)) {
    errors.push("DB_HOST is required in production");
  }

  const user = process.env.DB_USER || (strict ? null : "root");
  if (strict && !nonEmpty(user)) {
    errors.push("DB_USER is required in production");
  }

  const password = process.env.DB_PASS || process.env.DB_PASSWORD || (strict ? null : "");
  if (strict && !nonEmpty(password)) {
    errors.push("DB_PASS or DB_PASSWORD is required in production");
  }

  const database = process.env.DB_DATABASE || (strict ? null : "SISIII2026_89241041");
  if (strict && !nonEmpty(database)) {
    errors.push("DB_DATABASE is required in production");
  }

  const dbPort = parsePort(process.env.DB_PORT);
  if (strict && dbPort == null) {
    errors.push("DB_PORT must be a valid port number in production");
  }

  return {
    client: client || "pg",
    host: host || "localhost",
    user: user || "root",
    password: password || "",
    database: database || "SISIII2026_89241041",
    port: dbPort || DEFAULT_DB_PORT,
  };
}

function getRuntimeConfig({ strict = false } = {}) {
  const envName = process.env.NODE_ENV || "development";
  const production = envName === "production";
  const enforceProductionRules = strict;
  const errors = [];

  const sessionSecret = process.env.SESSION_SECRET || (enforceProductionRules ? null : DEFAULT_SESSION_SECRET);
  if (enforceProductionRules && !nonEmpty(sessionSecret)) {
    errors.push("SESSION_SECRET is required in production");
  } else if (enforceProductionRules && String(sessionSecret).trim().length < 16) {
    errors.push("SESSION_SECRET must be at least 16 characters long in production");
  }

  const frontendUrl = process.env.FRONTEND_URL || (enforceProductionRules ? null : DEFAULT_FRONTEND_URL);
  if (enforceProductionRules && !isAbsoluteOrigin(frontendUrl)) {
    errors.push("FRONTEND_URL must be a valid absolute origin in production");
  }

  const port = parsePort(process.env.PORT) || DEFAULT_PORT;
  if (enforceProductionRules && parsePort(process.env.PORT) == null) {
    errors.push("PORT must be a valid port number in production");
  }

  const trustProxy = parseBoolean(process.env.TRUST_PROXY);
  if (enforceProductionRules && trustProxy !== true) {
    errors.push("TRUST_PROXY must be enabled in production so secure cookies work behind a proxy");
  }

  const db = buildDatabaseConfig({ strict: enforceProductionRules, errors });

  if (production && db.client !== "pg") {
    errors.push("DB_CLIENT must be pg in production");
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid production configuration: ${errors.join("; ")}`);
    error.details = errors;
    throw error;
  }

  return {
    envName,
    production,
    port,
    frontendUrl,
    sessionSecret,
    trustProxy: trustProxy === true,
    cookieSecure: production || process.env.COOKIE_SECURE === "true",
    db,
  };
}

function getAppRuntimeConfig() {
  return getRuntimeConfig({ strict: false });
}

function validateProductionBootstrapConfig() {
  return getRuntimeConfig({ strict: true });
}

module.exports = {
  getAppRuntimeConfig,
  validateProductionBootstrapConfig,
  isAbsoluteOrigin,
  parseBoolean,
  parsePort,
};
