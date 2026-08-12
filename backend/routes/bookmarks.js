const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// /api/bookmarks GET method
router.get("/", catchAsync(async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({error: "Not logged in"});
    }

    const { rows } = await pool.query(
        `SELECT b.event_id AS id, b."saved_At",
        e.title, e.description, e.location,
        e.start_datetime, e.end_datetime, e.registration_type,
        o.name AS organization_name
        FROM bookmark b
        JOIN event e ON b.event_id = e.id
        JOIN organization o ON e.organization_id = o.id
        WHERE b.user_id = $1
        ORDER BY e.start_datetime ASC`,
        [req.session.user.id]
    );
    res.json(rows);
}));

// /api/bookmarks/ids GET method
router.get("/ids", catchAsync(async (req, res) => {
    if (!req.session.user) {
        return res.json({ ids: [] });
    }

    const { rows } = await pool.query(
        "SELECT event_id FROM bookmark WHERE user_id = $1",
        [req.session.user.id]
    );

    res.json({ ids: rows.map((row) => row.event_id) });
}));

// /api/bookmarks/:id POST method
router.post("/:id", requireAuth, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const eventId = req.params.id;
    const { rows } = await pool.query(
        `INSERT INTO bookmark (user_id, event_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING id`,
        [userId, eventId]
    );

    if (rows.length === 0) {
        return res.status(409).json({ error: "Event already saved" });
    }

    res.status(201).json({message: "Event saved"});
}));

// /api/bookmarks/:id DELETE method
router.delete("/:id", requireAuth, catchAsync(async (req, res) => {
    const { rowCount } = await pool.query(
        "DELETE FROM bookmark WHERE user_id = $1 AND event_id = $2",
        [req.session.user.id, req.params.id]
    );

    if (rowCount === 0) {
        return res.status(404).json({error: "No saved event to remove"});
    }

    res.json({message: "Event removed from saved"});
}));


module.exports = router;
