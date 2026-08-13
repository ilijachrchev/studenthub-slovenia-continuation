const express = require('express');
const pool = require('../db');
const catchAsync = require('../middleware/catchAsync');
const analyticsRoutes = require("./analytics");
const recommendationsRoutes = require("./recommendations");
const moderationRoutes = require("./moderation");

const router = express.Router();

// /api/faculties GET method
router.get("/faculties", catchAsync(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT f.id, f.name, f.university_id, u.name AS university_name
        FROM faculty f
        JOIN university u ON f.university_id = u.id
        ORDER BY u.name, f.name`
    );
    res.json(rows);
}));

// /api/tags GET method
router.get("/tags", catchAsync(async (req, res) => {
    const { rows } = await pool.query("SELECT id, name FROM tag ORDER BY name");
    res.json(rows);
}));

router.use("/", analyticsRoutes);
router.use("/", recommendationsRoutes);
router.use("/", moderationRoutes);

module.exports = router;
