const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");
const { organizationLimiter } = require("../middleware/rateLimits");
const {
    validateOrganizationInput,
} = require("../validators/input");

const router = express.Router();

function placeHolders(n) {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`);
}

// /api/organizations POST method
router.post("/", requireAuth, requireRole("organizer"), organizationLimiter, catchAsync(async (req, res) => {
    const validation = validateOrganizationInput(req.body);
    if (validation.errors.length > 0) {
        const firstError = validation.errors[0];
        if (
            firstError.startsWith("Organization name") ||
            firstError.startsWith("Contact email")
        ) {
            return res.status(400).json({ error: "Organization name and contact email are required" });
        }
        return res.status(400).json({ error: firstError });
    }

    const { name, description, logo, website, contact_email, university_id } = validation.value;

    // create org with status = PENDING
    const { rows: [org] } = await pool.query(
        `INSERT INTO organization (name, description, logo, website, contact_email, university_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
        [name, description, logo, website, contact_email, university_id]
    );

    await pool.query(
        "INSERT INTO organizer_profile (user_id, organization_id, role_in_org) VALUES ($1, $2, 'owner')",
        [req.session.user.id, org.id]
    );

    res.status(201).json({
        message: "Organization application submitted",
        organizationId: org.id,
        status: "pending",
    });
}));

// /api/organizations/my-application GET method
router.get("/my-application", requireAuth, catchAsync(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT o.* FROM organization o
        JOIN organizer_profile op ON op.organization_id = o.id
        WHERE op.user_id = $1
        AND op.role_in_org = 'owner'`,
        [req.session.user.id]
    );

    if (rows.length === 0) {
        return res.json({ hasApplication: false });
    }

    res.json({ hasApplication: true, organization: rows[0] });
}));

// /api/organizations GET method
router.get("/:id", catchAsync(async (req, res) => {
    const orgId = req.params.id;

    const { rows: orgRows } = await pool.query(
        `SELECT o.id, o.name, o.description, o.logo, o.website, o.contact_email,
            u.name AS university_name
            FROM organization o
            LEFT JOIN university u ON o.university_id = u.id
            WHERE o.id = $1 AND o.status = 'approved'`,
            [orgId]
    );

    if (orgRows.length === 0) {
        return res.status(404).json({error: "Organization not found"});
    }

    const organization = orgRows[0];

    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.description, e.location,
        e.start_datetime, e.end_datetime, e.registration_type,
        o.name AS organization_name
        FROM event e
        JOIN organization o ON e.organization_id = o.id
        WHERE e.organization_id = $1 AND e.status = 'published'
        ORDER BY e.start_datetime ASC`,
        [orgId]
    );

    let withTags = events.map((event) => ({...event, tags: []}));

    if (events.length > 0) {
        const eventIds = events.map((event) => event.id);
        const ph = placeHolders(eventIds.length);
        const { rows: tagRows } = await pool.query(
            `SELECT et.event_id, t.id, t.name
            FROM event_tag et
            JOIN tag t ON et.tag_id = t.id
            WHERE et.event_id IN (${ph})`,
            eventIds
        );

        const tagsByEvent = {};
        for (const row of tagRows) {
            if (!tagsByEvent[row.event_id]) {
                tagsByEvent[row.event_id] = [];
            }
            tagsByEvent[row.event_id].push({ id: row.id, name:row.name});
        }

        withTags = events.map((event) => ({
            ...event,
            tags: tagsByEvent[event.id] || [],
        }));
    }

    const now = new Date();
    const upcoming = withTags.filter((event) => new Date(event.end_datetime) >= now)
        .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

    const past = withTags.filter((event) => new Date(event.end_datetime) < now)
        .sort((a, b) => new Date(b.start_datetime) - new Date(a.start_datetime));

    res.json({organization, upcoming, past});
}));

module.exports = router;
