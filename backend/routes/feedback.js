const express = require("express");
const pool = require("../db");
const { validateFeedback } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// /api/feedback/:eventId GET method
router.get("/:eventId", catchAsync(async (req, res) => {
    if (!req.session.user) {
        return res.json({feedback: null});
    }

    const { rows } = await pool.query(
        "SELECT id, rating, comment, submitted_at FROM feedback WHERE user_id = $1 AND event_id = $2",
        [req.session.user.id, req.params.eventId]
    );

    res.json({feedback: rows.length ? rows[0] : null});
}));

// /api/feedback/:eventId POST method
router.post("/:eventId", requireAuth, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const eventId = req.params.eventId;
    const { rating, comment } = req.body;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({error: "Rating must be between 1 and 5"});
    }

    const validationErrors = validateFeedback(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({error: validationErrors[0]});
    }

    const { rows: eventRows } = await pool.query(
        "SELECT id, end_datetime FROM event WHERE id = $1",
        [eventId]
    );
    if (!eventRows.length) {
        return res.status(400).json({error: "Event not found"});
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

    const { rows } = await pool.query(
        `INSERT INTO feedback (user_id, event_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING id`,
        [userId, eventId, rating, comment ? comment.trim() : null]
    );

    if (rows.length === 0) {
        return res.status(409).json({error: "You have already left feedback for this event"});
    }

    res.status(201).json({message: "Feedback submitted"})
}));

module.exports = router;
