const express = require("express");
const pool = require("../db");
const { validateOrganization } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function placeHolders(n) {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`);
}

// /api/organizations POST method
router.post("/", requireAuth, requireRole("organizer"), catchAsync(async (req, res) => {
    const { name, description, logo, website, contact_email, university_id } = req.body;

    if (!name || !contact_email) {
        return res.status(400).json({ error: "Organization name and contact email are required" });
    }

    const validationErrors = validateOrganization(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0] });
    }

    // create org with status = PENDING
    const { rows: [org] } = await pool.query(
        `INSERT INTO organization (name, description, logo, website, contact_email, university_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
        [name, description || null, logo || null, website || null, contact_email, university_id || null]
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
        WHERE op.user_id = $1`,
        [req.session.user.id]
    );

    if (rows.length === 0) {
        return res.json({ hasApplication: false });
    }

    res.json({ hasApplication: true, organization: rows[0] });
}));

// GET /api/organizations/followed — list followed organizations (MUST be before /:id)
router.get("/followed", requireAuth, catchAsync(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT o.id, o.name, o.logo, o.description, o.status
         FROM organization_follower f
         JOIN organization o ON o.id = f.organization_id
         WHERE f.user_id = $1
         ORDER BY f.created_at DESC`,
        [req.session.user.id]
    );
    res.json({ organizations: rows });
}));

// /api/organizations GET method
router.get("/:id", catchAsync(async (req, res) => {
    const orgId = req.params.id;

    const { rows: orgRows } = await pool.query(
        `SELECT o.id, o.name, o.description, o.logo, o.website, o.contact_email,
            o.facebook, o.instagram, o.linkedin, o.twitter,
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

    // Add follower count
    const { rows: followerRows } = await pool.query(
        "SELECT COUNT(*)::int AS follower_count FROM organization_follower WHERE organization_id = $1",
        [orgId]
    );
    organization.follower_count = followerRows[0].follower_count;

    // Check if current user follows this org
    if (req.session.user) {
        const { rows: followRows } = await pool.query(
            "SELECT 1 FROM organization_follower WHERE user_id = $1 AND organization_id = $2",
            [req.session.user.id, orgId]
        );
        organization.is_following = followRows.length > 0;
    } else {
        organization.is_following = false;
    }

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

// PUT /api/organizations/:id — update organization profile (owner only)
router.put("/:id", requireAuth, requireRole("organizer"), catchAsync(async (req, res) => {
    const orgId = parseInt(req.params.id, 10);

    // Verify ownership
    const { rows: membership } = await pool.query(
        `SELECT 1 FROM organizer_profile
         WHERE user_id = $1 AND organization_id = $2 AND role_in_org = 'owner'`,
        [req.session.user.id, orgId]
    );
    if (!membership.length) {
        return res.status(403).json({ error: "Only the organization owner can update the profile" });
    }

    const { description, logo, website, contact_email,
            facebook, instagram, linkedin, twitter } = req.body;

    const validationErrors = validateOrganization(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0] });
    }

    const { rowCount } = await pool.query(
        `UPDATE organization SET
            description = COALESCE($1, description),
            logo = COALESCE($2, logo),
            website = COALESCE($3, website),
            contact_email = COALESCE($4, contact_email),
            facebook = $5,
            instagram = $6,
            linkedin = $7,
            twitter = $8
         WHERE id = $9 AND status = 'approved'`,
        [description || null, logo || null, website || null, contact_email || null,
         facebook || null, instagram || null, linkedin || null, twitter || null, orgId]
    );

    if (rowCount === 0) {
        return res.status(404).json({ error: "Organization not found or not approved" });
    }

    res.json({ message: "Organization profile updated" });
}));

// GET /api/organizations/:id/members — list organization members (public)
router.get("/:id/members", catchAsync(async (req, res) => {
    const orgId = parseInt(req.params.id, 10);

    const { rows: members } = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, op.role_in_org
         FROM organizer_profile op
         JOIN "user" u ON u.id = op.user_id
         WHERE op.organization_id = $1`,
        [orgId]
    );

    res.json({ members });
}));

// POST /api/organizations/:id/follow — follow an organization
router.post("/:id/follow", requireAuth, catchAsync(async (req, res) => {
    const orgId = parseInt(req.params.id, 10);

    // Check org exists and is approved
    const { rows: org } = await pool.query(
        "SELECT id FROM organization WHERE id = $1 AND status = 'approved'",
        [orgId]
    );
    if (!org.length) {
        return res.status(404).json({ error: "Organization not found" });
    }

    // Upsert follow
    const { rows } = await pool.query(
        `INSERT INTO organization_follower (user_id, organization_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, organization_id) DO NOTHING
         RETURNING id`,
        [req.session.user.id, orgId]
    );

    if (rows.length === 0) {
        return res.json({ message: "Already following" });
    }
    res.status(201).json({ message: "Following" });
}));

// DELETE /api/organizations/:id/follow — unfollow an organization
router.delete("/:id/follow", requireAuth, catchAsync(async (req, res) => {
    const orgId = parseInt(req.params.id, 10);

    const { rowCount } = await pool.query(
        "DELETE FROM organization_follower WHERE user_id = $1 AND organization_id = $2",
        [req.session.user.id, orgId]
    );

    if (rowCount === 0) {
        return res.status(404).json({ error: "Not following this organization" });
    }
    res.json({ message: "Unfollowed" });
}));

module.exports = router;
