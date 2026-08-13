const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");
const { transitionOpportunity } = require("../lib/opportunity/lifecycle");

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

    res.json({ message: "Organization rejected" });
}));

// /api/admin/opportunities/pending GET method
router.get("/opportunities/pending", requireAdmin, catchAsync(async (req, res) => {

    const { rows: opportunities } = await pool.query(
        `SELECT o.id, o.title, o.description, o.type, o.location,
                o.is_remote, o.application_mode, o.external_url, o.compensation,
                o.capacity, o.application_deadline, o.starts_at, o.status,
                org.id AS organization_id, org.name AS organization_name,
                c.id AS category_id, c.name AS category_name, c.slug AS category_slug
         FROM opportunity o
         JOIN organization org ON org.id = o.organization_id
         LEFT JOIN opportunity_category c ON c.id = o.category_id
         WHERE o.status = 'submitted'
         ORDER BY o.created_at ASC, o.id ASC`
    );

    res.json({ opportunities });
}));

// /api/admin/opportunities/:id/approve POST method
router.post("/opportunities/:id/approve", requireAdmin, catchAsync(async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await transitionOpportunity(client, {
            opportunityId: req.params.id,
            actorUserId: req.session.user.id,
            actorRole: req.session.user.role,
            toStatus: "published",
            requireOwnership: false,
        });

        await client.query("COMMIT");
        res.json({ message: "Opportunity published" });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        logger.error({ err: error }, "Opportunity approval failed");
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
}));

// /api/admin/opportunities/:id/reject POST method
router.post("/opportunities/:id/reject", requireAdmin, catchAsync(async (req, res) => {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: "Rejection reason is required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await transitionOpportunity(client, {
            opportunityId: req.params.id,
            actorUserId: req.session.user.id,
            actorRole: req.session.user.role,
            toStatus: "rejected",
            reason: String(reason).trim(),
            requireOwnership: false,
        });

        await client.query("COMMIT");
        res.json({ message: "Opportunity rejected" });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        logger.error({ err: error }, "Opportunity rejection failed");
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
}));



module.exports = router;
