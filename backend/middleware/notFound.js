function notFound(req, res) {
  res.status(404).json({
    error: "Not found",
    requestId: req.id || req.requestId || res.locals.requestId,
  });
}

module.exports = notFound;
