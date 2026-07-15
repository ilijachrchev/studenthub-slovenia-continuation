const express = require("express");
const pool = require("../db");
const crypto = require("crypto");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");
const notificationService = require("../services/notification");

const router = express.Router();


function generateTicketCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  let raw = "";
  for (let i = 0; i < 12; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }

  return `${raw.slice(0, 4)}-${raw.slice(4,8)}-${raw.slice(8, 12)}`;
}


// /api/registration/:id GET method
router.get("/:id", catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.json({registration: null});
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, event_id, registered_at, ticket_code, checked_in
       FROM registration
       WHERE user_id = $1 AND event_id = $2`,
       [req.session.user.id, req.params.id]
    );

    res.json({registration: rows.length ? rows[0] : null});
}));


// /api/register/:id POST method
router.post("/:id", requireAuth, catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const eventId = req.params.id;

    const { rows: eventRows } = await pool.query(
      "SELECT id, capacity, registration_type, status FROM event WHERE id = $1",
      [eventId]
    );

    if (!eventRows.length || eventRows[0].status !== "published") {
        return res.status(404).json({ error: "Event not found" });
    }
    const event = eventRows[0];

    if (event.registration_type !== "built_in") {
      return res.status(400).json({ error: "This event does not use built-in registration" });
    }

    const { rows: existing } = await pool.query(
      "SELECT id FROM registration WHERE user_id = $1 AND event_id = $2",
      [userId, eventId]
    );
    if (existing.length) {
      return res.status(409).json({error: "You are already registered for this event"})
    }

    if (event.capacity != null) {
      const { rows: countRows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM registration WHERE event_id = $1",
        [eventId]
      );
      if (countRows[0].count >= event.capacity) {
        return res.status(409).json({error: "This event is full"});
      }
    }

    // insert with a generated ticket code
    const ticketCode = generateTicketCode();
    const { rows: [registration] } = await pool.query(
      `INSERT INTO registration (user_id, event_id, ticket_code)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, event_id, registered_at, ticket_code, checked_in`,
      [userId, eventId, ticketCode]
    );

    // Notify the event organizer
    const { rows: eventInfo } = await pool.query(
      `SELECT e.title, e.organization_id
       FROM event e WHERE e.id = $1`,
      [eventId]
    );
    if (eventInfo.length) {
      const { rows: owners } = await pool.query(
        `SELECT op.user_id FROM organizer_profile op
         WHERE op.organization_id = $1 AND op.role_in_org = 'owner'`,
        [eventInfo[0].organization_id]
      );
      const { rows: student } = await pool.query(
        'SELECT first_name, last_name FROM "user" WHERE id = $1',
        [userId]
      );
      const studentName = student.length
        ? `${student[0].first_name} ${student[0].last_name}`
        : "A student";
      for (const owner of owners) {
        await notificationService.create({
          userId: owner.user_id,
          type: notificationService.NOTIFICATION_TYPES.REGISTRATION,
          title: "New registration",
          message: `${studentName} registered for "${eventInfo[0].title}"`,
          relatedId: parseInt(eventId, 10),
        });
      }
    }

    res.status(201).json(registration);
}));


// /api/registration/:id DELETE method
router.delete("/:id", requireAuth, catchAsync(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM registration WHERE user_id = $1 AND event_id = $2",
      [req.session.user.id, req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({error: "No registration to cancel"})
    }

    res.json({message:"Registration cancelled"});
}));


// /api/registration/:id GET method
router.get("/", requireAuth, catchAsync(async (req, res) => {
    const { rows } = await pool.query(
        `SELECT r.id, r.event_id, r.registered_at, r.ticket_code, r.checked_in,
                e.title, e.start_datetime, e.end_datetime, e.location,
                o.name AS organization_name
                FROM registration r
                JOIN event e ON r.event_id = e.id
                JOIN organization o ON e.organization_id = o.id
                WHERE r.user_id = $1
                ORDER BY e.start_datetime ASC`,
                [req.session.user.id]
    );
    res.json(rows);
}));


module.exports = router;
