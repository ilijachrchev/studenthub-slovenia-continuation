const express = require("express");
const pool = require("../db");
const { validateEvent } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const notificationService = require("../services/notification");

const router = express.Router();

const requireOrganizer = requireRole("organizer");


// /api/organizer/events GET method
router.get("/events", requireOrganizer, catchAsync(async (req, res) => {

    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.description, e.location,
            e.start_datetime, e.end_datetime, e.capacity,
            e.registration_type, e.external_url, e.status, e.created_at
            FROM event e
            JOIN organizer_profile op ON op.organization_id = e.organization_id
            WHERE op.user_id = $1
            ORDER BY e.start_datetime DESC`,
            [req.session.user.id]
    );

    res.json({events});
}));

// /api/organizer/events POST method
router.post("/events", requireOrganizer, catchAsync(async (req, res) => {

    const { title, description, location, start_datetime, end_datetime,
            registration_type, capacity, external_url, tag_ids, target_faculty_ids, } = req.body;

    if (!title || !location || !start_datetime || !end_datetime) {
        return res.status(400).json({error: "Title, location, start and end datetime are required"});
    }

    const validationErrors = validateEvent(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({error: validationErrors[0]});
    }

    if (!Array.isArray(tag_ids) || tag_ids.length === 0) {
        return res.status(400).json({error: "Select at least one tag"});
    }
    if (!Array.isArray(target_faculty_ids) || target_faculty_ids.length === 0) {
        return res.status(400).json({error: "Select at least one target faculty"});
    }

    const regType = ["built_in", "external", "none"].includes(registration_type)
        ? registration_type
        : "built_in";

    if (regType === "external" && !external_url) {
        return res.status(400).json({error: "An external registration link is required"});
    }

    const { rows: orgs } = await pool.query(
        `SELECT o.id FROM organization o
        JOIN organizer_profile op ON op.organization_id = o.id
        WHERE op.user_id = $1 AND o.status = 'approved'`,
        [req.session.user.id]
    );

    if (orgs.length === 0) {
        return res.status(403).json({ error: "No approved organization found for this account"});
    }

    const organizationId = orgs[0].id;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { rows: [event] } = await client.query(
            `INSERT INTO event
                (organization_id, title, description, location,
                start_datetime, end_datetime, capacity, registration_type, external_url, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
                RETURNING id`,
                [
                    organizationId, title,
                    description || null,
                    location,
                    start_datetime.replace("T", " "),
                    end_datetime.replace("T", " "),
                    regType === "built_in" ? (capacity || null) : null,
                    regType,
                    regType === "external" ? external_url : null,
                ]
        );

        const eventId = event.id;

        for (const tagId of tag_ids) {
            await client.query(
                "INSERT INTO event_tag (event_id, tag_id) VALUES ($1, $2)",
                [eventId, tagId]
            );
        }

        for (const facultyId of target_faculty_ids) {
            await client.query(
                "INSERT INTO event_target (event_id, faculty_id) VALUES ($1, $2)",
                [eventId, facultyId]
            );
        }

        await client.query("COMMIT");
        res.status(201).json({ message: "Event created", eventId});
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ err: error }, "Event creation failed");
        res.status(500).json({error: "Internal server error"});
    } finally {
        client.release();
    }
}));

// /api/organizer/events/:id POST method
router.post("/events/:id/submit", requireOrganizer, catchAsync(async (req, res) => {

    const eventId = req.params.id;

    const { rows } = await pool.query(
        `SELECT e.id, e.status FROM event e
        JOIN organizer_profile op ON op.organization_id = e.organization_id
        WHERE e.id = $1 AND op.user_id = $2`,
        [eventId, req.session.user.id]
    );
    if (rows.length === 0) {
        return res.status(404).json({error: "Event not found"});
    }
    if (rows[0].status !== "draft") {
        return res.status(400).json({error: " Only draft events can be submitted"});
    }

    await pool.query("UPDATE event SET status = 'submitted' WHERE id = $1", [eventId]);

    res.json({message: "Event submitted for approval"});
}));

// POST /api/organizer/events/:id/cancel — cancel own event
router.post("/events/:id/cancel", requireOrganizer, catchAsync(async (req, res) => {
    const eventId = req.params.id;

    const { rows } = await pool.query(
        `SELECT e.id, e.status, e.title FROM event e
        JOIN organizer_profile op ON op.organization_id = e.organization_id
        WHERE e.id = $1 AND op.user_id = $2`,
        [eventId, req.session.user.id]
    );
    if (rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
    }

    const event = rows[0];
    if (!["draft", "submitted", "published"].includes(event.status)) {
        return res.status(400).json({ error: `Cannot cancel event with status "${event.status}"` });
    }

    await pool.query("UPDATE event SET status = 'cancelled' WHERE id = $1", [eventId]);

    // Notify registered students if event was published
    if (event.status === "published") {
        const { rows: registrations } = await pool.query(
            "SELECT user_id FROM registration WHERE event_id = $1",
            [eventId]
        );
        for (const reg of registrations) {
            await notificationService.create({
                userId: reg.user_id,
                type: notificationService.NOTIFICATION_TYPES.EVENT_CANCELLED,
                title: "Event cancelled",
                message: `The event "${event.title}" has been cancelled by the organizer`,
                relatedId: parseInt(eventId, 10),
            });
        }
    }

    res.json({ message: "Event cancelled" });
}));


module.exports = router;
