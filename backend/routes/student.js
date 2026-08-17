const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { normalizePositiveIntArray, parsePositiveInt } = require("../middleware/validate");

const router = express.Router();

const requireStudent = requireRole("student");

// /api/student/setup POST method
router.post("/setup", requireStudent, catchAsync(async (req, res) => {
    const userId = req.session.user.id;

    const { faculty_id, study_year, tag_ids } = req.body;
    const parsedFacultyId = parsePositiveInt(faculty_id);
    if (!parsedFacultyId) {
        return res.status(400).json({ error: "Faculty is required"});
    }

    const { values: parsedTagIds, error: tagError } = normalizePositiveIntArray(tag_ids || [], "Tag IDs");
    if (tagError && (!Array.isArray(tag_ids) || tag_ids.length > 0)) {
        return res.status(400).json({ error: tagError });
    }

    const { rows: facultyRows } = await pool.query(
        "SELECT id FROM faculty WHERE id = $1",
        [parsedFacultyId]
    );
    if (facultyRows.length === 0) {
        return res.status(400).json({ error: "Faculty not found" });
    }

    if (parsedTagIds && parsedTagIds.length > 0) {
        const { rows: tagRows } = await pool.query(
            "SELECT id FROM tag WHERE id = ANY($1::int[])",
            [parsedTagIds]
        );
        if (tagRows.length !== parsedTagIds.length) {
            return res.status(400).json({ error: "One or more tags are invalid" });
        }
    }

    const { rows: existing } = await pool.query(
        "SELECT user_id FROM student_profile WHERE user_id = $1",
        [userId]
    );
    if (existing.length > 0) {
        return res.status(400).json({ error: "You have already set up your feed"});
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { rowCount } = await client.query(
            `INSERT INTO student_profile (user_id, faculty_id, study_year)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, parsedFacultyId, study_year || null]
        );

        if (rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "You have already set up your feed"});
        }

        if (parsedTagIds && parsedTagIds.length > 0) {
            for (const tagId of parsedTagIds) {
                await client.query(
                    "INSERT INTO user_interest (user_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
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
router.put("/profile", requireStudent, catchAsync(async (req, res) => {
    const userId = req.session.user.id;

    const { faculty_id, study_year, tag_ids} = req.body;
    const parsedFacultyId = parsePositiveInt(faculty_id);
    if (!parsedFacultyId) {
        return res.status(400).json({error: "Faculty is required"});
    }

    const { values: parsedTagIds, error: tagError } = normalizePositiveIntArray(tag_ids || [], "Tag IDs");
    if (tagError && (!Array.isArray(tag_ids) || tag_ids.length > 0)) {
        return res.status(400).json({ error: tagError });
    }

    const { rows: facultyRows } = await pool.query(
        "SELECT id FROM faculty WHERE id = $1",
        [parsedFacultyId]
    );
    if (facultyRows.length === 0) {
        return res.status(400).json({ error: "Faculty not found" });
    }

    if (parsedTagIds && parsedTagIds.length > 0) {
        const { rows: tagRows } = await pool.query(
            "SELECT id FROM tag WHERE id = ANY($1::int[])",
            [parsedTagIds]
        );
        if (tagRows.length !== parsedTagIds.length) {
            return res.status(400).json({ error: "One or more tags are invalid" });
        }
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { rowCount } = await client.query(
            "UPDATE student_profile SET faculty_id = $1, study_year = $2 WHERE user_id = $3",
            [parsedFacultyId, study_year || null, userId]
        );

        if (rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Student profile not found" });
        }

        await client.query(
            "DELETE FROM user_interest WHERE user_id = $1",
            [userId]
        );

        if (parsedTagIds && parsedTagIds.length > 0) {
            for (const tagId of parsedTagIds) {
                await client.query(
                    "INSERT INTO user_interest (user_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
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
