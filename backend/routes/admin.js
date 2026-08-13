const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { adminLimiter } = require("../middleware/rateLimits");
const {
    parsePositiveInteger,
    validateRejectionReasonInput,
} = require("../validators/input");

const router = express.Router();

const requireAdmin = requireRole("admin");

// /api/admin/events/pending GET method
router.get("/events/pending", requireAdmin, catchAsync(async (req, res) => {

    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.description, e.location,
        e.start_datetime, e.end_datetime, e.registration_type, e.capacity,
        o.name AS organizer_name
        FROM event e
        JOIN organization o ON o.id = e.organization_id
        WHERE e.status = 'submitted'
        ORDER BY e.created_at ASC`
    );

    res.json({ events });
}));

// /api/admin/events/:id/approve POST method
router.post("/events/:id/approve", requireAdmin, adminLimiter, catchAsync(async (req, res) => {
    const eventId = parsePositiveInteger(req.params.id);
    if (!eventId) {
        return res.status(400).json({ error: "Event not found or not awaiting approval" });
    }
    const { rowCount } = await pool.query(
        "UPDATE event SET status = 'published' WHERE id = $1 AND status = 'submitted'",
        [eventId]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Event not found or not awaiting approval" });
    }

    res.json({ message: "Event published" });
}));

// /api/admin/events/:id/rejected POST method
router.post("/events/:id/reject", requireAdmin, adminLimiter, catchAsync(async (req, res) => {
    const eventId = parsePositiveInteger(req.params.id);
    if (!eventId) {
        return res.status(400).json({ error: "Event not found or not awaiting approval" });
    }

    const validation = validateRejectionReasonInput(req.body);
    if (validation.errors.length > 0) {
        return res.status(400).json({ error: "Rejection reason is required" });
    }

    const { rows: admins } = await pool.query(
        "SELECT id FROM admin WHERE user_id = $1",
        [req.session.user.id]
    );

    if (admins.length === 0) {
        return res.status(403).json({ error: "Admin record not found for this account" });
    }

    const adminId = admins[0].id;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { rowCount } = await client.query(
            "UPDATE event SET status = 'rejected' WHERE id = $1 AND status = 'submitted'",
            [eventId]
        );

        if (rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Event not found or not awaiting approval" });
        }

        await client.query(
            "INSERT INTO event_rejection (event_id, admin_id, reason) VALUES ($1, $2, $3)",
            [eventId, adminId, validation.value.reason]
        );

        await client.query("COMMIT");
        res.json({ message: "Event rejected" });
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ err: error }, "Event rejection failed");
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
}));

// /api/admin/organizations/pending GET method
router.get("/organizations/pending", requireAdmin, catchAsync(async (req, res) => {

    const { rows: organizations } = await pool.query(
        `SELECT o.id, o.name, o.description, o.website,
        o.contact_email, o.university_id,
        u.first_name, u.last_name, u.email AS applicant_email
        FROM organization o
        JOIN organizer_profile op ON op.organization_id = o.id AND op.role_in_org = 'owner'
        JOIN "user" u ON u.id = op.user_id
        WHERE o.status = 'pending'
        ORDER BY o.id ASC`
    );

    res.json({ organizations });
}));

// /api/admin/organizations/:id/approve POST method
router.post("/organizations/:id/approve", requireAdmin, adminLimiter, catchAsync(async (req, res) => {
    const orgId = parsePositiveInteger(req.params.id);
    if (!orgId) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }
    const { rowCount } = await pool.query(
        "UPDATE organization SET status = 'approved', approved_at = NOW() WHERE id = $1 AND status = 'pending'",
        [orgId]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }

    res.json({ message: "Organization approved" });
}));

// /api/admin/organizations/:id/reject POST method
router.post("/organizations/:id/reject", requireAdmin, adminLimiter, catchAsync(async (req, res) => {
    const orgId = parsePositiveInteger(req.params.id);
    if (!orgId) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }
    const { rowCount } = await pool.query(
        "UPDATE organization SET status = 'rejected' WHERE id = $1 AND status = 'pending'",
        [orgId]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }

    res.json({ message: "Organization rejected" });
}));



module.exports = router;
