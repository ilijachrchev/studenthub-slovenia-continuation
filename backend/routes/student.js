const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { studentProfileLimiter } = require("../middleware/rateLimits");
const {
    validateStudentProfileInput,
} = require("../validators/input");

const router = express.Router();

const requireStudent = requireRole("student");

// /api/student/setup POST method
router.post("/setup", requireStudent, studentProfileLimiter, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const validation = validateStudentProfileInput(req.body);
    if (validation.errors.length > 0) {
        return res.status(400).json({ error: validation.errors[0] });
    }
    const { faculty_id, study_year, tag_ids } = validation.value;

    const { rows: existing } = await pool.query(
        "SELECT * FROM student_profile WHERE user_id = $1",
        [userId]
    );
    if (existing.length > 0) {
        return res.status(400).json({ error: "You have already set up your feed"});
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "INSERT INTO student_profile (user_id, faculty_id, study_year) VALUES ($1, $2, $3)",
            [userId, faculty_id, study_year || null]
        );

        if (Array.isArray(tag_ids) && tag_ids.length > 0) {
            for (const tagId of tag_ids) {
                await client.query(
                    "INSERT INTO user_interest (user_id, tag_id) VALUES ($1, $2)",
                    [userId, tagId]
                );
            }
        }

        await client.query("COMMIT");
        res.status(201).json({message: "Profile setup complete"});
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ err: error }, "Student setup failed");
        res.status(500).json({ error: "Internal server error"});
    } finally {
        client.release();
    }
}));

// /api/student/profile GET method
router.get("/profile", requireStudent, catchAsync(async (req, res) => {
    const userId = req.session.user.id;

    const { rows: profiles } = await pool.query(
        "SELECT faculty_id, study_year FROM student_profile WHERE user_id = $1",
        [userId]
    );

    if (profiles.length === 0) {
        return res.json({ hasProfile: false });
    }

    const { rows: interests } = await pool.query(
        "SELECT tag_id FROM user_interest WHERE user_id = $1",
        [userId]
    );

    res.json({
        hasProfile: true,
        faculty_id: profiles[0].faculty_id,
        study_year: profiles[0].study_year,
        tag_ids: interests.map((row) => row.tag_id),
    });
}));


// /api/student/profile PUT method
router.put("/profile", requireStudent, studentProfileLimiter, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const validation = validateStudentProfileInput(req.body);
    if (validation.errors.length > 0) {
        return res.status(400).json({ error: validation.errors[0] });
    }
    const { faculty_id, study_year, tag_ids } = validation.value;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "UPDATE student_profile SET faculty_id = $1, study_year = $2 WHERE user_id = $3",
            [faculty_id, study_year || null, userId]
        );

        await client.query(
            "DELETE FROM user_interest WHERE user_id = $1",
            [userId]
        );

        if (Array.isArray(tag_ids) && tag_ids.length > 0) {
            for (const tagId of tag_ids) {
                await client.query(
                    "INSERT INTO user_interest (user_id, tag_id) VALUES ($1, $2)",
                    [userId, tagId]
                );
            }
        }

        await client.query("COMMIT");
        res.json({message: "Preferences updated"});
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ err: error }, "Student profile update failed");
        res.status(500).json({ error: "Internal server error"});
    } finally {
        client.release();
    }
}));


module.exports = router;
