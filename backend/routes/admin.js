const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const notificationService = require("../services/notification");

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
router.post("/events/:id/approve", requireAdmin, catchAsync(async (req, res) => {

    const { rowCount } = await pool.query(
        "UPDATE event SET status = 'published' WHERE id = $1 AND status = 'submitted'",
        [req.params.id]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Event not found or not awaiting approval" });
    }

    // Notify the event organizer
    const { rows: eventInfo } = await pool.query(
        `SELECT e.title, e.organization_id FROM event e WHERE e.id = $1`,
        [req.params.id]
    );
    if (eventInfo.length) {
        const { rows: owners } = await pool.query(
            `SELECT user_id FROM organizer_profile
             WHERE organization_id = $1 AND role_in_org = 'owner'`,
            [eventInfo[0].organization_id]
        );
        for (const owner of owners) {
            await notificationService.create({
                userId: owner.user_id,
                type: notificationService.NOTIFICATION_TYPES.EVENT_APPROVED,
                title: "Event approved",
                message: `Your event "${eventInfo[0].title}" has been approved and is now published`,
                relatedId: parseInt(req.params.id, 10),
            });
        }
    }

    res.json({ message: "Event published" });
}));

// /api/admin/events/:id/rejected POST method
router.post("/events/:id/reject", requireAdmin, catchAsync(async (req, res) => {

    const {reason} = req.body;
    if (!reason || !reason.trim()) {
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
            [req.params.id]
        );

        if (rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Event not found or not awaiting approval" });
        }

        await client.query(
            "INSERT INTO event_rejection (event_id, admin_id, reason) VALUES ($1, $2, $3)",
            [req.params.id, adminId, reason.trim()]
        );

        await client.query("COMMIT");

        // Notify the event organizer
        const { rows: eventInfo } = await pool.query(
            `SELECT e.title, e.organization_id FROM event e WHERE e.id = $1`,
            [req.params.id]
        );
        if (eventInfo.length) {
            const { rows: owners } = await pool.query(
                `SELECT user_id FROM organizer_profile
                 WHERE organization_id = $1 AND role_in_org = 'owner'`,
                [eventInfo[0].organization_id]
            );
            for (const owner of owners) {
                await notificationService.create({
                    userId: owner.user_id,
                    type: notificationService.NOTIFICATION_TYPES.EVENT_REJECTED,
                    title: "Event rejected",
                    message: `Your event "${eventInfo[0].title}" was rejected: ${reason.trim()}`,
                    relatedId: parseInt(req.params.id, 10),
                });
            }
        }

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
router.post("/organizations/:id/approve", requireAdmin, catchAsync(async (req, res) => {

    const { rowCount } = await pool.query(
        "UPDATE organization SET status = 'approved', approved_at = NOW() WHERE id = $1 AND status = 'pending'",
        [req.params.id]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }

    // Notify the organization owner
    const { rows: owners } = await pool.query(
        `SELECT op.user_id, o.name FROM organizer_profile op
         JOIN organization o ON o.id = op.organization_id
         WHERE op.organization_id = $1 AND op.role_in_org = 'owner'`,
        [req.params.id]
    );
    for (const owner of owners) {
        await notificationService.create({
            userId: owner.user_id,
            type: notificationService.NOTIFICATION_TYPES.EVENT_APPROVED,
            title: "Organization approved",
            message: `Your organization "${owner.name}" has been approved`,
            relatedId: parseInt(req.params.id, 10),
        });
    }

    res.json({ message: "Organization approved" });
}));

// /api/admin/organizations/:id/reject POST method
router.post("/organizations/:id/reject", requireAdmin, catchAsync(async (req, res) => {

    const { rowCount } = await pool.query(
        "UPDATE organization SET status = 'rejected' WHERE id = $1 AND status = 'pending'",
        [req.params.id]
    );

    if (rowCount === 0) {
        return res.status(400).json({ error: "Organization not found or not awaiting approval" });
    }

    // Notify the organization owner
    const { rows: owners } = await pool.query(
        `SELECT op.user_id, o.name FROM organizer_profile op
         JOIN organization o ON o.id = op.organization_id
         WHERE op.organization_id = $1 AND op.role_in_org = 'owner'`,
        [req.params.id]
    );
    for (const owner of owners) {
        await notificationService.create({
            userId: owner.user_id,
            type: notificationService.NOTIFICATION_TYPES.EVENT_REJECTED,
            title: "Organization rejected",
            message: `Your organization "${owner.name}" application was not approved`,
            relatedId: parseInt(req.params.id, 10),
        });
    }

    res.json({ message: "Organization rejected" });
}));



module.exports = router;
