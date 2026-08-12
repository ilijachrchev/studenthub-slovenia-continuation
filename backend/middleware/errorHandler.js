const logger = require("./logger");

function getStatusCode(err) {
  if (Number.isInteger(err.statusCode)) {
    return err.statusCode;
  }

  if (Number.isInteger(err.status)) {
    return err.status;
  }

  return 500;
}

function getPublicMessage(err, statusCode) {
  if (statusCode < 500) {
    return err.message || "Request failed";
  }

  if (process.env.NODE_ENV === "production") {
    return "Internal server error";
  }

  return err.message || "Internal server error";
}

function errorHandler(err, req, res, _next) {
  const statusCode = getStatusCode(err);
  const requestId = req.id || req.requestId || res.locals.requestId;
  const message = getPublicMessage(err, statusCode);

  logger.error(
    {
      err: {
        message: err.message,
        stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
        name: err.name,
      },
      requestId,
      statusCode,
      method: req.method,
      path: req.originalUrl,
    },
    "Request failed"
  );

  res.status(statusCode).json({
    error: message,
    requestId,
  });
}

module.exports = errorHandler;
