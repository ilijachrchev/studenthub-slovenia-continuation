# Backend API — Testing Reference

Every endpoint in the StudentHub Slovenia API: method, path, who can call it, the request body to send, and the expected response.

## How to test

- **Base URL:** `http://88.200.63.148:30011`
- Tool: Postman (or `curl`). Keep the **same host** across the login call and the protected call so the session cookie (`connect.sid`) is reused — Postman handles this automatically with its cookie jar.
- **Auth is session-based.** Log in first; the cookie is then sent on every following request. To test logged-out behavior, clear the `connect.sid` cookie or use a fresh tab.
- Send bodies as **raw JSON** (`Content-Type: application/json`).
- Body keys are `snake_case`.
- For local backend tests, use the PostgreSQL service from `docker-compose.yml` or any equivalent instance that exposes `studenti / studentipass` on `localhost:5433` and lets the test database `studenthub_test` be created. The Jest global setup runs the migrations and seeds automatically before the integration suite.

---

## Auth — `routes/auth.js`

### `POST /api/auth/register` 
Register a new student. The email domain is validated against `faculty.email_domain`.
```json
{
  "first_name": "Test",
  "last_name": "Student",
  "email": "test.student@student.upr.si",
  "password": "secret123"
}
```
- **201 / 200** — account created (`role` defaults to `student`).
- **400** — invalid/unverified email domain, or email already registered.
- *Verify the exact field names (and whether `faculty_id` is captured here or later in Setup Feed) against your `auth.js`.*

### `POST /api/auth/login`
```json
{ "email": "admin@studenthub.test", "password": "admin123" }
```
- **200** — `{ user: { id, first_name, last_name, email, role } }`; session cookie set.
- **401** — wrong credentials.

### `POST /api/auth/logout`
No body.
- **200** — session destroyed.

### `GET /api/auth/me`
No body.
- **200** — current `{ user }`.
- **401** — not logged in.

---

## Student profile — `routes/student.js`

### `POST /api/student/setup`
Onboarding: writes `student_profile` + `user_interest`.
```json
{ "faculty_id": 1, "study_year": 2, "tag_ids": [3, 5, 8] }
```
- **200 / 201** — profile + interests saved.
- *Confirm the exact path and whether it's `POST /setup` against your `student.js`.*

### `GET /api/student/profile`
No body.
- **200** — `{ faculty_id, study_year, tag_ids }`.

### `PUT /api/student/profile`
Edit feed preferences (Account Settings). Replaces interests (clear + rewrite).
```json
{ "faculty_id": 1, "study_year": 3, "tag_ids": [2, 4] }
```
- **200** — `{ message: "..." }` (saved).
- **400** — `"Please select a faculty"` (faculty missing).

---

## Lookups — `routes/lookups.js`

### `GET /api/faculties`
- **200** — array of `{ id, name, university_name, email_domain }`.

### `GET /api/tags`
- **200** — array of `{ id, name }`.

*Confirm the mount paths (`/api/faculties`, `/api/tags`) against `server.js` / `lookups.js`.*

---

## Events (public) — `routes/events.js`

### `GET /api/events` (personalized if logged in)
No body. Returns published events from approved orgs. If logged in as a student, each event gets a `score` (interest-tag matches + faculty-target bonus) and the list is sorted by score desc, then start date asc.
- **200** — array of `{ id, title, description, location, start_datetime, end_datetime, capacity, registration_type, external_url, organization_id, organization_name, tags: [...], score }`.

### `GET /api/events/:id`
No body.
- **200** — single event with organization info (`organization_id`, `organization_name`, `organization_description`, `organization_logo`, `organization_website`, `organization_contact_email`) and `tags`.
- **404** — `{ "error": "Event not found" }` (not found, not published, or org not approved).

---

## Search — `routes/search.js`

### `GET /api/search?q=<term>`
Matches **published** events (approved orgs) whose **title** contains `q` (case-insensitive).
- `GET /api/search?q=intro` → **200** array of events (same shape as the feed, with `tags`).
- `GET /api/search?q=` (blank) → **200** `[]`.
- `GET /api/search?q=zzzznomatch` → **200** `[]`.

---

## Organizations — `routes/organizations.js`

### `POST /api/organizations`
Apply to run an organization (status `pending`). Creates the `organization` row + an `organizer_profile` linking the user as `owner`.
```json
{
  "name": "Test Student Org",
  "description": "We run workshops.",
  "logo": null,
  "website": "https://example.org",
  "contact_email": "info@example.org",
  "university_id": 1
}
```
- **201** — `{ message: "Organization application submitted", organizationId, status: "pending" }`.
- **400** — `"Organization name and contact email are required"`.
- **403** — `"Only organizers can create organizations"`.

### `GET /api/organizations/my-application`
No body. The logged-in organizer's application.
- **200** — `{ hasApplication: false }` or `{ hasApplication: true, organization: {...} }`.
- **401** — `"Not logged in"`.

### `GET /api/organizations/:id`
No body. Public profile of an **approved** org + its published events split into upcoming/past.
- **200** — `{ organization: { id, name, description, logo, website, contact_email, university_name }, upcoming: [...], past: [...] }`.
- **404** — `{ "error": "Organization not found" }` (missing or not approved — won't leak pending/rejected orgs).

---

## Organizer events — `routes/organizer.js`

### `GET /api/organizer/events`
No body. All events of the organizer's organization.
- **200** — `{ events: [...] }`.
- **401** `"Not logged in"` · **403** `"Only organizers can access this"`.

### `POST /api/organizer/events`
Create an event as a **draft**. Requires the org to be approved. Inserts `event` + `event_tag` + `event_target` in a transaction.
```json
{
  "title": "Intro to Computer Vision",
  "description": "Creating own game.",
  "location": "FAMNIT Lab 1, Koper",
  "start_datetime": "2026-06-10 17:00:00",
  "end_datetime": "2026-06-10 19:00:00",
  "registration_type": "built_in",
  "capacity": 40,
  "external_url": null,
  "tag_ids": [3, 5],
  "target_faculty_ids": [1]
}
```
- `capacity` is used only when `registration_type` is `built_in`; `external_url` only when `external`. `registration_type` ∈ `built_in | external | none`.
- **201 / 200** — `{ eventId }`.
- **400** — `"Title, location, start and end date/time are required"` · `"Select at least one tag"` · `"Select at least one target faculty"`.
- **403** — `"Only organizers can create events"`.

### `POST /api/organizer/events/:id/submit`
No body. Moves the organizer's own draft from `draft` → `submitted`.
- **200** — submitted.
- **400** — not a draft / not theirs.

---

## Admin — `routes/admin.js`

### `GET /api/admin/events/pending`
No body. Events awaiting approval (`status = 'submitted'`), with org name.
- **200** — `{ events: [...] }`.
- **401** `"Not logged in"` · **403** `"Only admins can access this"`.

### `POST /api/admin/events/:id/approve`
No body. `submitted` → `published`.
- **200** — `{ "message": "Event published" }`.
- **400** — `"Event not found or not awaiting approval"`.
- **403** — `"Only admins can approve events"`.

### `POST /api/admin/events/:id/reject`
`submitted` → `rejected`, and writes an `event_rejection` row (reason) in a transaction.
```json
{ "reason": "Location details are incomplete." }
```
- **200** — `{ "message": "Event rejected" }`.
- **400** — `"A rejection reason is required"` · `"Event not found or not awaiting approval"`.
- **403** — `"Only admins can reject events"` · `"No admin record found for this account"`.

### `GET /api/admin/organizations/pending`
No body. Pending organization applications.
- **200** — list of pending orgs.

### `POST /api/admin/organizations/:id/approve`
No body. Sets the org `approved` + `approved_at`.
- **200** — approved.

### `POST /api/admin/organizations/:id/reject`
No body. Flips the org to `rejected` (**no reason stored** for org rejection).
- **200** — rejected.

---

## Registration & tickets — `routes/registrations.js`

### `POST /api/registrations/:eventId` 
Register for a built-in event; issues a unique ticket code (format `YNBD-W9XR-NNZR`). Likely no body (uses the session user).
- **201 / 200** — `{ ticket_code, ... }`; a `registration` row is created.
- **4xx** — already registered (duplicate guard) / event full (capacity guard).
- *Confirm whether a body is required and the exact guard messages/status codes against `registrations.js`.*

### `GET /api/registrations/:eventId`
No body. The user's registration for that event (or null).
- **200** — `{ registration }` or null.

### `DELETE /api/registrations/:eventId`
No body. Cancels the registration.
- **200** — cancelled; the `registration` row is removed.

### `GET /api/registrations`
No body. All of the user's registrations (My Registrations page).
- **200** — array of registrations.

---

## Saved events (bookmarks) — `routes/bookmarks.js`

### `GET /api/bookmarks`
No body. Full saved list for the Saved page (events joined to org name).
- **200** — array.
- **401** — `"Not logged in"`.

### `GET /api/bookmarks/ids`
No body. Saved event ids, for marking feed cards.
- **200** — `{ "ids": [3, 7] }`. Returns `{ "ids": [] }` even when logged out (by design — so the feed still loads).

### `POST /api/bookmarks/:id`
No body. Save an event.
- **201** — `{ "message": "Event saved" }`.
- **409** — `{ "error": "Event already saved" }`.
- **401** — `{ "error": "You must be logged in to save events" }`.

### `DELETE /api/bookmarks/:id`
No body. Unsave an event.
- **200** — `{ "message": "Event removed from saved" }`.
- **404** — `{ "error": "No saved event to remove" }`.
- **401** — `"Not logged in"`.

---

## Feedback — `routes/feedback.js`

### `GET /api/feedback/:eventId`
No body. The logged-in user's feedback for that event.
- **200** — `{ "feedback": { id, rating, comment, submitted_at } }` or `{ "feedback": null }`. Returns `null` even when logged out (by design — doesn't error).

### `POST /api/feedback/:eventId`
Submit feedback. One per user-event, only for a past event the user registered for. `comment` is optional.
```json
{ "rating": 4, "comment": "Great workshop, learned a lot." }
```
- **201** — `{ "message": "Feedback submitted" }`.

Guards fire **in this order** (the first failure wins):
1. **401** — `"You must be logged in to leave feedback"`.
2. **400** — `"Rating must be between 1 and 5"` (checked *before* event existence, so a bad rating on a missing event still returns 400).
3. **404** — `"Event not found"`.
4. **400** — `"You can only leave feedback after the event has ended"` (event not ended yet).
5. **403** — `"You can only leave feedback for events you registered for"`.
6. **409** — `"You have already left feedback for this event"`.

---

## Useful setup SQL (for testing)

```sql
-- An approved org id (for /api/organizations/:id)
SELECT id, name, status FROM organization WHERE status = 'approved';

-- A published event to register/search/save
SELECT id, title, status, capacity, registration_type FROM `event` WHERE status = 'published';

-- Backdate a registered event so feedback is allowed (note original first)
UPDATE `event` SET end_datetime = '2026-01-01 12:00:00' WHERE id = <event_id>;

-- Reset an org to pending to re-test approval
UPDATE organization SET status = 'pending', approved_at = NULL WHERE id = <org_id>;

-- Force capacity-full
UPDATE `event` SET capacity = 1 WHERE id = <event_id>;
```

(`event` and `user` are reserved words — backtick them.)
