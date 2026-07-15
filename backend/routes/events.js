const express = require("express");
const pool = require("../db");
const catchAsync = require("../middleware/catchAsync");

const router = express.Router();

function placeHolders(n) {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`);
}

// /api/events GET method
router.get("/", catchAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const sortBy = req.query.sort || "upcoming"; // upcoming, newest, popularity
    const facultyId = parseInt(req.query.faculty, 10) || null;
    const tagId = parseInt(req.query.tag, 10) || null;
    const orgId = parseInt(req.query.organization, 10) || null;
    const location = req.query.location || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let conditions = ["e.status = 'published'", "o.status = 'approved'"];
    let params = [];
    let paramIdx = 1;

    if (facultyId) {
      conditions.push(`e.id IN (SELECT event_id FROM event_target WHERE faculty_id = $${paramIdx})`);
      params.push(facultyId);
      paramIdx++;
    }

    if (tagId) {
      conditions.push(`e.id IN (SELECT event_id FROM event_tag WHERE tag_id = $${paramIdx})`);
      params.push(tagId);
      paramIdx++;
    }

    if (orgId) {
      conditions.push(`e.organization_id = $${paramIdx}`);
      params.push(orgId);
      paramIdx++;
    }

    if (location) {
      conditions.push(`e.location ILIKE $${paramIdx}`);
      params.push(`%${location}%`);
      paramIdx++;
    }

    if (dateFrom) {
      conditions.push(`e.start_datetime >= $${paramIdx}`);
      params.push(dateFrom);
      paramIdx++;
    }

    if (dateTo) {
      conditions.push(`e.end_datetime <= $${paramIdx}`);
      params.push(dateTo);
      paramIdx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    let orderBy;
    switch (sortBy) {
      case "newest":
        orderBy = "e.created_at DESC";
        break;
      case "popularity":
        orderBy = "reg_count DESC, e.start_datetime ASC";
        break;
      case "upcoming":
      default:
        orderBy = "e.start_datetime ASC";
        break;
    }

    // For popularity sort, join with registration counts
    const fromClause = sortBy === "popularity"
      ? `FROM event e
         JOIN organization o ON e.organization_id = o.id
         LEFT JOIN (SELECT event_id, COUNT(*)::int AS reg_count FROM registration GROUP BY event_id) rc ON rc.event_id = e.id`
      : `FROM event e JOIN organization o ON e.organization_id = o.id`;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total ${fromClause} ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    if (total === 0) {
      return res.json({ events: [], page, limit, total: 0 });
    }

    const offset = (page - 1) * limit;
    const { rows: events } = await pool.query(
      `SELECT e.id, e.title, e.description, e.location,
              e.start_datetime, e.end_datetime, e.capacity,
              e.registration_type, e.external_url,
              o.id AS organization_id, o.name AS organization_name
       ${fromClause}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    const eventIds = events.map((event) => event.id);
    let result = events;

    if (eventIds.length > 0) {
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

      result = events.map((event) => ({
        ...event,
        tags: tagsByEvent[event.id] || [],
        score: 0,
      }));

      // personalization (only for paginated results)
      if (req.session.user && sortBy === "upcoming") {
        const userId = req.session.user.id;

        const { rows: profileRows } = await pool.query(
          "SELECT faculty_id FROM student_profile WHERE user_id = $1",
          [userId]
        );

        const { rows: interestRows } = await pool.query(
          "SELECT tag_id FROM user_interest WHERE user_id = $1",
          [userId]
        );

        const { rows: targetRows } = await pool.query(
          `SELECT event_id, faculty_id FROM event_target WHERE event_id IN (${ph})`,
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
          const facultyMatch = userFacultyId && targetsByEvent[event.id]?.includes(userFacultyId) ? 1 : 0;
          return { ...event, score: tagMatches + facultyMatch };
        });
      }
    }

    res.json({ events: result, page, limit, total });
}));

// /api/events/:id GET method
router.get("/:id", catchAsync(async (req, res) => {
    const eventId = req.params.id;

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
