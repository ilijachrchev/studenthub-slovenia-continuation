const express = require("express");
const pool = require("../db");
const { validateFeedback } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");
const { parsePositiveInt } = require("../middleware/validate");

const router = express.Router();

// /api/feedback/:eventId GET method
router.get("/:eventId", catchAsync(async (req, res) => {
    if (!req.session.user) {
        return res.json({feedback: null});
    }

    const eventId = parsePositiveInt(req.params.eventId);
    if (!eventId) {
        return res.json({feedback: null});
    }

    const { rows } = await pool.query(
        "SELECT id, rating, comment, submitted_at FROM feedback WHERE user_id = $1 AND event_id = $2",
        [req.session.user.id, eventId]
    );

    res.json({feedback: rows.length ? rows[0] : null});
}));

// /api/feedback/:eventId POST method
router.post("/:eventId", requireAuth, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const eventId = parsePositiveInt(req.params.eventId);
    const { rating, comment } = req.body;

    if (!eventId) {
        return res.status(404).json({error: "Event not found"});
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({error: "Rating must be between 1 and 5"});
    }

    const validationErrors = validateFeedback(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({error: validationErrors[0]});
    }

    const { rows: eventRows } = await pool.query(
        `SELECT e.id, e.end_datetime
         FROM event e
         JOIN organization o ON o.id = e.organization_id
         WHERE e.id = $1 AND e.status = 'published' AND o.status = 'approved'`,
        [eventId]
    );
    if (!eventRows.length) {
        return res.status(404).json({error: "Event not found"});
    }
    if (new Date(eventRows[0].end_datetime) > new Date()) {
        return res.status(400).json({error: "You can only leave feedback after the event has ended"});
    }

    const { rows: registered } = await pool.query(
        "SELECT id FROM registration WHERE user_id = $1 AND event_id = $2",
        [userId, eventId]
    );
    if (!registered.length) {
        return res.status(403).json({error: "You can only leave feedback for events you registered for"});
    }

    const { rowCount } = await pool.query(
        `INSERT INTO feedback (user_id, event_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, event_id) DO NOTHING`,
        [userId, eventId, rating, comment ? comment.trim() : null]
    );

    if (rowCount === 0) {
        return res.status(409).json({error: "You have already left feedback for this event"});
    }

    res.status(201).json({message: "Feedback submitted"})
}));

module.exports = router;
