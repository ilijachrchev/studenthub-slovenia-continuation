const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const requireAdmin = requireRole("admin");
const requireOrganizer = requireRole("organizer");

// GET /api/analytics/platform — admin: platform-wide stats
router.get("/platform", requireAdmin, catchAsync(async (req, res) => {
    const [userCount, eventCount, orgCount, regCount] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM "user"'),
        pool.query("SELECT COUNT(*)::int AS count FROM event"),
        pool.query("SELECT COUNT(*)::int AS count FROM organization WHERE status = 'approved'"),
        pool.query("SELECT COUNT(*)::int AS count FROM registration"),
    ]);

    const { rows: eventStatuses } = await pool.query(
        `SELECT status, COUNT(*)::int AS count FROM event GROUP BY status`
    );

    const { rows: recentUsers } = await pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
         FROM "user"
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
    );

    const { rows: recentRegistrations } = await pool.query(
        `SELECT DATE(registered_at) AS date, COUNT(*)::int AS count
         FROM registration
         WHERE registered_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(registered_at)
         ORDER BY date ASC`
    );

    res.json({
        users: userCount.rows[0].count,
        events: eventCount.rows[0].count,
        organizations: orgCount.rows[0].count,
        registrations: regCount.rows[0].count,
        eventsByStatus: eventStatuses,
        recentUsers,
        recentRegistrations,
    });
}));

// GET /api/analytics/events/:id — event detail stats (organizer of that event)
router.get("/events/:id", requireOrganizer, catchAsync(async (req, res) => {
    const eventId = parseInt(req.params.id, 10);

    // Verify organizer owns this event
    const { rows: ownership } = await pool.query(
        `SELECT 1 FROM event e
         JOIN organizer_profile op ON op.organization_id = e.organization_id
         WHERE e.id = $1 AND op.user_id = $2`,
        [eventId, req.session.user.id]
    );
    if (!ownership.length) {
        return res.status(403).json({ error: "Access denied" });
    }

    const [regCount, viewCount] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM registration WHERE event_id = $1", [eventId]),
        pool.query("SELECT COUNT(*)::int AS count FROM event_view WHERE event_id = $1", [eventId]),
    ]);

    const { rows: dailyViews } = await pool.query(
        `SELECT DATE(viewed_at) AS date, COUNT(*)::int AS count
         FROM event_view
         WHERE event_id = $1 AND viewed_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(viewed_at)
         ORDER BY date ASC`,
        [eventId]
    );

    const { rows: dailyRegs } = await pool.query(
        `SELECT DATE(registered_at) AS date, COUNT(*)::int AS count
         FROM registration
         WHERE event_id = $1 AND registered_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(registered_at)
         ORDER BY date ASC`,
        [eventId]
    );

    res.json({
        registrations: regCount.rows[0].count,
        views: viewCount.rows[0].count,
        dailyViews,
        dailyRegistrations: dailyRegs,
    });
}));

// GET /api/analytics/organizer — organizer: stats across their events
router.get("/organizer", requireOrganizer, catchAsync(async (req, res) => {
    const { rows: events } = await pool.query(
        `SELECT e.id, e.title, e.status, e.start_datetime
         FROM event e
         JOIN organizer_profile op ON op.organization_id = e.organization_id
         WHERE op.user_id = $1
         ORDER BY e.start_datetime DESC`,
        [req.session.user.id]
    );

    if (events.length === 0) {
        return res.json({ events: [], totalRegistrations: 0, totalViews: 0 });
    }

    const eventIds = events.map((e) => e.id);

    const { rows: regCounts } = await pool.query(
        `SELECT event_id, COUNT(*)::int AS count
         FROM registration
         WHERE event_id = ANY($1)
         GROUP BY event_id`,
        [eventIds]
    );

    const { rows: viewCounts } = await pool.query(
        `SELECT event_id, COUNT(*)::int AS count
         FROM event_view
         WHERE event_id = ANY($1)
         GROUP BY event_id`,
        [eventIds]
    );

    const regsByEvent = Object.fromEntries(regCounts.map((r) => [r.event_id, r.count]));
    const viewsByEvent = Object.fromEntries(viewCounts.map((r) => [r.event_id, r.count]));

    const enriched = events.map((e) => ({
        ...e,
        registrations: regsByEvent[e.id] || 0,
        views: viewsByEvent[e.id] || 0,
    }));

    const totalRegistrations = enriched.reduce((sum, e) => sum + e.registrations, 0);
    const totalViews = enriched.reduce((sum, e) => sum + e.views, 0);

    res.json({ events: enriched, totalRegistrations, totalViews });
}));

module.exports = router;
