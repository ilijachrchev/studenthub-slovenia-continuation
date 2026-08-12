# Security Boundaries

This project uses session-based auth and server-side authorization checks. The current boundaries are:

- `req.session.user` is the source of truth for authentication.
- `requireAuth` gates logged-in access.
- `requireRole("student" | "organizer" | "admin")` gates role-specific areas.
- State-changing requests are subject to origin/referer validation in `backend/middleware/csrf.js`.
- Cookies are `httpOnly`, `sameSite: "lax"`, and `secure` in production.
- Passwords are stored as bcrypt hashes and compared with `bcrypt.compare()`.
- Error handlers return generic 500 responses for unexpected failures and avoid sending stack traces to clients.

Resource ownership rules currently enforced in code:

- Students can only act on their own bookmarks, registrations, feedback, notifications, and applications.
- Organizers can only create and manage events for their approved organization.
- Admin routes are restricted to logged-in admins, with additional database checks where a separate admin record is required.
- Public read routes only expose approved organizations and published events.

Areas that require careful testing:

- Numeric path parameters used in SQL queries.
- Organizer and admin moderation endpoints.
- Application state transitions.
- Notification read/update operations.
- Search and pagination inputs.
