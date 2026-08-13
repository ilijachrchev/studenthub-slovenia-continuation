const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { organizerEventLimiter } = require("../middleware/rateLimits");
const {
    validateEventInput,
    parsePositiveInteger,
} = require("../validators/input");

const router = express.Router();

const requireOrganizer = requireRole("organizer");

async function getOwnedOrganizationId(client, userId) {
    const { rows } = await client.query(
        `SELECT o.id
         FROM organization o
         JOIN organizer_profile op ON op.organization_id = o.id
         WHERE op.user_id = $1
           AND op.role_in_org = 'owner'
           AND o.status = 'approved'
         ORDER BY o.id ASC
         LIMIT 1`,
        [userId]
    );

    return rows[0] ? rows[0].id : null;
}


// /api/organizer/events GET method
router.get("/events", requireOrganizer, catchAsync(async (req, res) => {
    const organizationId = await getOwnedOrganizationId(pool, req.session.user.id);
    if (!organizationId) {
        return res.status(403).json({ error: "No approved organization found for this account" });
    }

    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.description, e.location,
            e.start_datetime, e.end_datetime, e.capacity,
            e.registration_type, e.external_url, e.status, e.created_at
            FROM event e
            JOIN organizer_profile op ON op.organization_id = e.organization_id
            JOIN organization o ON o.id = e.organization_id
            WHERE op.user_id = $1
            AND op.role_in_org = 'owner'
            AND o.status = 'approved'
            AND e.organization_id = $2
            ORDER BY e.start_datetime DESC`,
            [req.session.user.id, organizationId]
    );

    res.json({events});
}));

// /api/organizer/events POST method
router.post("/events", requireOrganizer, organizerEventLimiter, catchAsync(async (req, res) => {
    const validation = validateEventInput(req.body);
    if (validation.errors.length > 0) {
        const firstError = validation.errors[0];
        if (firstError === "Registration type must be one of: built_in, external, none") {
            return res.status(400).json({error: "Registration type must be built_in, external, or none"});
        }
        if (firstError.startsWith("Tag IDs")) {
            return res.status(400).json({error: "Select at least one tag"});
        }
        if (firstError.startsWith("Target faculty IDs")) {
            return res.status(400).json({error: "Select at least one target faculty"});
        }
        if (
            firstError.startsWith("Title") ||
            firstError.startsWith("Location") ||
            firstError.startsWith("Start datetime") ||
            firstError.startsWith("End datetime")
        ) {
            return res.status(400).json({error: "Title, location, start and end datetime are required"});
        }
        return res.status(400).json({error: firstError});
    }

    const {
        title,
        description,
        location,
        start_datetime,
        end_datetime,
        registration_type,
        capacity,
        external_url,
        tag_ids,
        target_faculty_ids,
    } = validation.value;

    const regType = registration_type || "built_in";

    if (regType === "external" && !external_url) {
        return res.status(400).json({error: "An external registration link is required"});
    }

    const organizationId = await getOwnedOrganizationId(pool, req.session.user.id);
    if (!organizationId) {
        return res.status(403).json({ error: "No approved organization found for this account"});
    }

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
                    description,
                    location,
                    start_datetime.replace("T", " "),
                    end_datetime.replace("T", " "),
                    regType === "built_in" ? capacity : null,
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
router.post("/events/:id/submit", requireOrganizer, organizerEventLimiter, catchAsync(async (req, res) => {
    const eventId = parsePositiveInteger(req.params.id);
    if (!eventId) {
        return res.status(404).json({error: "Event not found"});
    }

    const { rows } = await pool.query(
        `SELECT e.id, e.status FROM event e
        JOIN organizer_profile op ON op.organization_id = e.organization_id
        JOIN organization o ON o.id = e.organization_id
        WHERE e.id = $1 AND op.user_id = $2 AND op.role_in_org = 'owner' AND o.status = 'approved'`,
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


module.exports = router;
