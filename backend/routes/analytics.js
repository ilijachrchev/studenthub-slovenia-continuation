const express = require("express");
const rateLimit = require("express-rate-limit");
const catchAsync = require("../middleware/catchAsync");
const { recordEvent } = require("../lib/opportunity/analytics");

const router = express.Router();

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many analytics events, please slow down" },
});

const CLIENT_EVENT_TYPES = new Set(["opportunity_viewed", "recommendation_clicked"]);

function firstPresent(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
}

router.post("/analytics/events", analyticsLimiter, catchAsync(async (req, res) => {
  const eventType = firstPresent(req.body, ["eventType", "event_type"]);
  if (!CLIENT_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "Unsupported analytics event type" });
  }

  const opportunityId = firstPresent(req.body, ["opportunityId", "opportunity_id"]);
  if (!opportunityId) {
    return res.status(400).json({ error: "opportunity_id is required" });
  }

  const applicationId = firstPresent(req.body, ["applicationId", "application_id"]);
  const metadata = firstPresent(req.body, ["metadata"]) || {};

  await recordEvent(eventType, {
    actorUserId: req.session.user ? req.session.user.id : null,
    opportunityId,
    applicationId: applicationId || null,
    metadata,
  });

  res.status(204).end();
}));

module.exports = router;


