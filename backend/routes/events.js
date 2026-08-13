const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");
const { parsePositiveInt } = require("../lib/parseId");

const router = express.Router();

function placeHolders(n) {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`);
}

// /api/events GET method
router.get("/", catchAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const { rows: events } = await pool.query(
      `SELECT e.id, e.title, e.description, e.location,
              e.start_datetime, e.end_datetime, e.capacity,
              e.registration_type, e.external_url,
              o.id AS organization_id, o.name AS organization_name
       FROM event e
       JOIN organization o ON e.organization_id = o.id
       WHERE e.status = 'published' AND o.status = 'approved'
       ORDER BY e.start_datetime ASC`
    );

    if (events.length === 0) {
      return res.json({ events: [], page: 1, limit, total: 0 });
    }

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
      tagsByEvent[row.event_id].push({ id: row.id, name: row.name });
    }

    let result = events.map((event) => ({
      ...event,
      tags: tagsByEvent[event.id] || [],
      score: 0,
    }));

    // personalization
    if (req.session.user) {
      const userId = req.session.user.id;

      const { rows: profileRows } = await pool.query(
        "SELECT faculty_id FROM student_profile WHERE user_id = $1",
        [userId]
      );

      const { rows: interestRows } = await pool.query(
        "SELECT tag_id FROM user_interest WHERE user_id = $1",
        [userId]
      );

      const ph2 = placeHolders(eventIds.length);
      const { rows: targetRows } = await pool.query(
        `SELECT event_id, faculty_id FROM event_target WHERE event_id IN (${ph2})`,
        eventIds
      );

      const userFacultyId = profileRows.length ? profileRows[0].faculty_id : null;
      const userTagIds = interestRows.map((row) => row.tag_id);

      const targetsByEvent = {};
      for (const row of targetRows) {
        if (!targetsByEvent[row.event_id]) {
          targetsByEvent[row.event_id] = [];
        }
        targetsByEvent[row.event_id].push(row.faculty_id);
      }

      result = result.map((event) => {
        const tagMatches = event.tags.filter((tag) => userTagIds.includes(tag.id)).length;
        const facultyMatch = userFacultyId && targetsByEvent[event.id]?.includes(userFacultyId) ? 1: 0;
        return { ...event, score: tagMatches + facultyMatch };
      });

      // most relevant + newest
      result.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return new Date(a.start_datetime) - new Date(b.start_datetime);
      });
    }

    const total = result.length;
    const start = (page - 1) * limit;
    const paged = result.slice(start, start + limit);

    res.json({ events: paged, page, limit, total });
}));

// /api/events/:id GET method
router.get("/:id", catchAsync(async (req, res) => {
    const eventId = parsePositiveInt(req.params.id);
    if (!eventId) {
      return res.status(404).json({ error: "Event not found" });
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.description, e.location,
        e.start_datetime, e.end_datetime, e.capacity,
        e.registration_type, e.external_url,
        o.id AS organization_id, o.name AS organization_name,
        o.description AS organization_description,
        o.logo AS organization_logo, o.website AS organization_website,
        o.contact_email AS organization_contact_email
        FROM event e
        JOIN organization o ON e.organization_id = o.id
        WHERE e.id = $1 AND e.status = 'published' AND o.status = 'approved'`,
      [eventId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }

    const event = rows[0];
    const { rows: tagRows } = await pool.query(
      `SELECT t.id, t.name
       FROM event_tag et
       JOIN tag t ON et.tag_id = t.id
       WHERE et.event_id = $1`,
      [eventId]
    );

    event.tags = tagRows;
    res.json(event);
}));

module.exports = router;
