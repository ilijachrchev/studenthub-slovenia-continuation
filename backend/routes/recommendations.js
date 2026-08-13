const express = require("express");
const catchAsync = require("../middleware/catchAsync");
const { requireRole } = require("../middleware/auth");
const { getRecommendations, parseLimit, parsePage } = require("../lib/opportunity/recommendations");

const router = express.Router();

const requireStudent = requireRole("student");

router.get("/", requireStudent, catchAsync(async (req, res) => {
  const limit = parseLimit(req.query.limit, 10);
  const page = parsePage(req.query.page, 1);
  const payload = await getRecommendations(req.session.user.id, limit, page);
  res.json(payload);
}));

module.exports = router;
