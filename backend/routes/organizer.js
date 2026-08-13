const express = require("express");
const pool = require("../db");
const { validateEvent } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");
const { requireRole } = require("../middleware/auth");

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

// /api/organizer/opportunities/:id/analytics GET method
router.get("/opportunities/:id/analytics", requireOrganizer, catchAsync(async (req, res) => {
    const opportunityId = req.params.id;

    const { rows: ownershipRows } = await pool.query(
        `SELECT e.id
         FROM event e
         JOIN organizer_profile op ON op.organization_id = e.organization_id
         WHERE e.id = $1 AND op.user_id = $2`,
        [opportunityId, req.session.user.id]
    );

    if (ownershipRows.length === 0) {
        return res.status(404).json({ error: "Opportunity not found" });
    }

    const [viewRows, clickRows, registrationRows, checkedInRows, reportRows] = await Promise.all([
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM analytics_events
             WHERE opportunity_id = $1 AND event_type = 'opportunity_viewed'`,
            [opportunityId]
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM analytics_events
             WHERE opportunity_id = $1 AND event_type = 'recommendation_clicked'`,
            [opportunityId]
        ),
        pool.query(
            "SELECT COUNT(*)::int AS count FROM registration WHERE event_id = $1",
            [opportunityId]
        ),
        pool.query(
            "SELECT COUNT(*)::int AS count FROM registration WHERE event_id = $1 AND checked_in = TRUE",
            [opportunityId]
        ),
        pool.query(
            "SELECT COUNT(*)::int AS count FROM opportunity_report WHERE opportunity_id = $1",
            [opportunityId]
        ),
    ]);

    const [viewSeries, clickSeries, registrationSeries] = await Promise.all([
        pool.query(
            `SELECT created_at::date AS date, COUNT(*)::int AS views
             FROM analytics_events
             WHERE opportunity_id = $1
               AND event_type = 'opportunity_viewed'
               AND created_at >= NOW() - INTERVAL '30 days'
             GROUP BY created_at::date
             ORDER BY date ASC`,
            [opportunityId]
        ),
        pool.query(
            `SELECT created_at::date AS date, COUNT(*)::int AS clicks
             FROM analytics_events
             WHERE opportunity_id = $1
               AND event_type = 'recommendation_clicked'
               AND created_at >= NOW() - INTERVAL '30 days'
             GROUP BY created_at::date
             ORDER BY date ASC`,
            [opportunityId]
        ),
        pool.query(
            `SELECT registered_at::date AS date, COUNT(*)::int AS registrations
             FROM registration
             WHERE event_id = $1
               AND registered_at >= NOW() - INTERVAL '30 days'
             GROUP BY registered_at::date
             ORDER BY date ASC`,
            [opportunityId]
        ),
    ]);

    const seriesByDate = new Map();
    for (const row of viewSeries.rows) {
        const key = new Date(row.date).toISOString().slice(0, 10);
        seriesByDate.set(key, { date: key, views: row.views, clicks: 0, registrations: 0 });
    }
    for (const row of clickSeries.rows) {
        const key = new Date(row.date).toISOString().slice(0, 10);
        const current = seriesByDate.get(key) || { date: key, views: 0, clicks: 0, registrations: 0 };
        current.clicks = row.clicks;
        seriesByDate.set(key, current);
    }
    for (const row of registrationSeries.rows) {
        const key = new Date(row.date).toISOString().slice(0, 10);
        const current = seriesByDate.get(key) || { date: key, views: 0, clicks: 0, registrations: 0 };
        current.registrations = row.registrations;
        seriesByDate.set(key, current);
    }

    const views = viewRows.rows[0].count;
    const clicks = clickRows.rows[0].count;
    const registrations = registrationRows.rows[0].count;
    const checkedIn = checkedInRows.rows[0].count;
    const reports = reportRows.rows[0].count;

    res.json({
        funnel: [
            { step: "views", count: views },
            { step: "clicks", count: clicks, conversion_rate: views ? clicks / views : 0 },
            { step: "registrations", count: registrations, conversion_rate: views ? registrations / views : 0 },
            { step: "checked_in", count: checkedIn, conversion_rate: registrations ? checkedIn / registrations : 0 },
            { step: "reports", count: reports, conversion_rate: views ? reports / views : 0 },
        ],
        conversion: {
            view_to_click: views ? clicks / views : 0,
            view_to_registration: views ? registrations / views : 0,
            registration_to_check_in: registrations ? checkedIn / registrations : 0,
        },
        timeseries: Array.from(seriesByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    });
}));

// /api/organizer/analytics/summary GET method
router.get("/analytics/summary", requireOrganizer, catchAsync(async (req, res) => {
    const { rows: eventRows } = await pool.query(
        `SELECT e.id, e.status
         FROM event e
         JOIN organizer_profile op ON op.organization_id = e.organization_id
         WHERE op.user_id = $1`,
        [req.session.user.id]
    );

    const eventIds = eventRows.map((row) => row.id);

    if (eventIds.length === 0) {
        return res.json({
            totals: {
                opportunities: 0,
                views: 0,
                clicks: 0,
                registrations: 0,
                checked_in: 0,
                reports: 0,
            },
            by_status: [],
        });
    }

    const ph = eventIds.map((_, index) => `$${index + 1}`);
    const [viewRows, clickRows, regRows, checkInRows, reportRows, statusRows] = await Promise.all([
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM analytics_events
             WHERE opportunity_id IN (${ph.join(",")}) AND event_type = 'opportunity_viewed'`,
            eventIds
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM analytics_events
             WHERE opportunity_id IN (${ph.join(",")}) AND event_type = 'recommendation_clicked'`,
            eventIds
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM registration
             WHERE event_id IN (${ph.join(",")})`,
            eventIds
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM registration
             WHERE event_id IN (${ph.join(",")}) AND checked_in = TRUE`,
            eventIds
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
             FROM opportunity_report
             WHERE opportunity_id IN (${ph.join(",")})`,
            eventIds
        ),
        pool.query(
            `SELECT status, COUNT(*)::int AS count
             FROM event
             WHERE id IN (${ph.join(",")})
             GROUP BY status
             ORDER BY status`,
            eventIds
        ),
    ]);

    res.json({
        totals: {
            opportunities: eventRows.length,
            views: viewRows.rows[0].count,
            clicks: clickRows.rows[0].count,
            registrations: regRows.rows[0].count,
            checked_in: checkInRows.rows[0].count,
            reports: reportRows.rows[0].count,
        },
        by_status: statusRows.rows,
    });
}));


module.exports = router;
