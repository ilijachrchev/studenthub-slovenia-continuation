const { randomUUID } = require("node:crypto");

function requestIdMiddleware(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.id = requestId;
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}

module.exports = requestIdMiddleware;
