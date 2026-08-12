const app = require("./app");
const pool = require("./db");
const logger = require("./middleware/logger");
const { validateProductionBootstrapConfig } = require("./config/runtime");

const SHUTDOWN_TIMEOUT_MS = 10000;

let server = null;
let shuttingDown = false;
let hooksRegistered = false;

async function checkDatabaseReady() {
  await pool.query("SELECT 1 AS health");
}

async function closeHttpServer() {
  if (!server) {
    return;
  }

  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal, exitCode }, "Shutdown signal received");

  const forceExit = setTimeout(() => {
    logger.error({ signal }, "Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await Promise.allSettled([closeHttpServer(), pool.end()]);
  } finally {
    clearTimeout(forceExit);
    process.exit(exitCode);
  }
}

function registerProcessHooks() {
  if (hooksRegistered) {
    return;
  }

  hooksRegistered = true;

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
}

async function start() {
  const runtime = validateProductionBootstrapConfig();
  registerProcessHooks();

  if (runtime.production) {
    await checkDatabaseReady();
  } else {
    try {
      await checkDatabaseReady();
    } catch (error) {
      logger.warn({ err: error.message }, "Database connection check failed during non-production startup");
    }
  }

  server = app.listen(runtime.port, () => {
    logger.info({ port: runtime.port, requestIdHeader: "X-Request-ID" }, "Server started");
  });

  return server;
}

module.exports = {
  start,
  shutdown,
  checkDatabaseReady,
};
