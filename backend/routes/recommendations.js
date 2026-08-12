const express = require("express");
const catchAsync = require("../middleware/catchAsync");
const { requireRole } = require("../middleware/auth");
const { getRecommendations } = require("../lib/opportunity/recommend");

const router = express.Router();

const requireStudent = requireRole("student");

router.get("/recommendations", requireStudent, catchAsync(async (req, res) => {
  const items = await getRecommendations(req.session.user.id, req.query.limit);
  res.json({ items });
}));

module.exports = router;


