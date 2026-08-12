require("dotenv").config();
const logger = require("./middleware/logger");
const { start, shutdown } = require("./bootstrap");

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  void shutdown("startup-failure", 1);
});
