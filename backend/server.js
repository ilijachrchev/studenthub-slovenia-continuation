require("dotenv").config();
const app = require("./app");
const pool = require("./db");
const logger = require("./middleware/logger");

const PORT = process.env.PORT || 30011;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server started");
});

// Verify database connection on startup
pool.query("SELECT 1 AS health")
  .then(() => {
    logger.info("Database connection verified");
  })
  .catch((err) => {
    logger.fatal({ err: err.message }, "Database connection failed on startup — server is running but will not serve requests correctly");
    server.close(() => process.exit(1));
  });

// Graceful shutdown with timeout
const SHUTDOWN_TIMEOUT = 10000;

const shutdown = async (signal) => {
  logger.info({ signal }, "Shutdown signal received");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  forceExit.unref();

  server.close(() => {
    logger.info("HTTP server closed");
  });

  try {
    await pool.end();
    logger.info("Database pool closed");
  } catch (err) {
    logger.error({ err: err.message }, "Error closing database pool");
  }

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle unhandled rejections — log and exit after a short delay
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message }, "Uncaught exception");
  process.exit(1);
});
