const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { insertAnalyticsEvents } = require("../lib/opportunity/analytics");

const router = express.Router();

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.events)) return value.events;
  if (value && typeof value === "object" && value.event) return [value];
  return [];
}

router.post("/events", catchAsync(async (req, res) => {
  const client = await pool.connect();
  try {
    const events = asArray(req.body);
    const visitorKey = req.session.user?.id ? `user:${req.session.user.id}` : req.sessionID || null;
    const inserted = await insertAnalyticsEvents(client, events, req.session.user?.id || null, visitorKey);
    res.status(201).json({ inserted });
  } finally {
    client.release();
  }
}));

module.exports = router;
