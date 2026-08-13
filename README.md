# StudentHub Slovenia

A web application for discovering and registering for campus events at Slovenian universities. Student organizations publish events, an admin moderates them, and students get a personalized, faculty-targeted feed.

Built as the seminar project for **Information Systems III** at the University of Primorska (FAMNIT).

---

## What it does

Three roles share one platform:

- **Student** — registers with an institutional email, sets interests, browses a personalized event feed, searches, saves events, registers for events (getting a QR ticket), and leaves feedback after attending.
- **Organizer** — applies to run an organization, and once approved, creates events, targets them at faculties, tags them, and submits them for review.
- **Admin** — approves or rejects organization applications and event submissions, and manages the verified email-domain and tag lists.

The core loop, end to end:

> Organizer applies → admin approves the org → organizer creates an event (draft) → submits it → admin approves it → it appears in students' feeds → a student registers and gets a QR ticket → after the event, the student leaves feedback.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, `react-router-dom`, plain global CSS |
| Backend | Node.js + Express, `express-session`, `bcryptjs`, `knex`, `pg` |

**Ports:** frontend dev server on **30010**, backend on **30011**.

**Server:** hosted on the shared university server `88.200.63.148`.

---

## Architecture

```
Browser (React, :30010)
   │   fetch("/api/...")  with credentials: "include"
   ▼
Vite dev proxy  ──►  Express API (:30011)
                          │
                          ▼
                   PostgreSQL
                   (primary runtime)
```

- Auth is **session-based**: on login the server stores `req.session.user = { id, first_name, last_name, email, role }` and sets a cookie. Protected routes check the session; there is no JWT/token.
- Login redirects by role: `organizer` → `/organizer`, `admin` → `/admin`, everyone else → `/`.

---

## Features (functional requirements)

- **FR1 — Registration & institutional validation.** Students register with an email whose domain is validated against the `faculty.email_domain` list. Three roles: Student, Organizer, Admin.
- **FR2 — Organization application & administration.** Organizers apply (status `pending`); admins approve (sets `approved_at`) or reject. Only approved orgs can publish events.
- **FR3 — Event creation, targeting & tagging.** Approved organizers create events as drafts (≥1 tag, ≥1 target faculty), then submit for review. Admins approve (→ published) or reject (→ rejected, with a stored reason).
- **FR4 — Event registration & ticketing.** Built-in registration issues a unique QR ticket code; alternatively an event can use an external link or no registration. Capacity and duplicate guards apply.
- **FR5 — Personalized feed, saved events & preferences.** The feed scores published events by interest-tag match + a faculty-targeting bonus, with a "Recommended for you" badge. Students can edit their preferences in Settings and bookmark events.
- **FR6 — Feedback & organization profile.** After a past event they registered for, a student can leave a 1–5 star rating + comment (once). Each approved organization has a public profile page listing its upcoming and past events.

**Plus: search.** A debounced topbar search matches published events by title (`GET /api/search?q=`). The search box edits the URL; the results page reads the URL and refetches. Clearing the box returns to Home (all events).

Event lifecycle status: `draft → submitted → published` or `rejected`.

---

## Database

- **Name:** `SISIII2026_89241041` · **Collation:** `utf8_unicode_ci`
- **16 tables**, singular `snake_case` names:
  `user`, `student_profile`, `organizer_profile`, `admin`, `university`, `faculty`, `organization`, `event`, `event_tag`, `event_target`, `tag`, `registration`, `bookmark`, `feedback`, `event_rejection`, `user_interest`.
- **Migrations:** Managed via Knex.js (`backend/db/migrations/`)
- **Seeds:** Idempotent development data (`backend/db/seeds/`)

---

## Setup

### Prerequisites
Node.js + npm, Docker + Docker Compose (for local DB), and access to the PostgreSQL-backed runtime.

### Quick start with Docker

The fastest way to get a local database running:

```bash
docker compose up -d        # starts the PostgreSQL-backed stack and backend
cd frontend && npm run dev  # frontend on :30010
```

The Docker backend automatically:
1. Waits for PostgreSQL to be healthy
2. Runs all pending migrations (`npm run db:migrate`)
3. Seeds development data (`npm run db:seed`)
4. Starts the server

The compose file still includes a legacy MySQL service for compatibility checks, but the backend service is wired to PostgreSQL (`db-pg`).

#### Docker workflow commands

| Command | Description |
|---|---|
| `docker compose up -d` | Start services (migrations + seeds run automatically) |
| `docker compose up -d --build` | Rebuild images and start (use after dependency changes) |
| `docker compose down` | Stop services (preserves database data) |
| `docker compose down -v` | Stop services **and** remove database volume (full reset) |
| `docker compose logs -f backend` | Follow backend logs |
| `docker compose exec backend npm run db:status` | Check migration status inside container |
| `docker compose exec backend npm run db:reset` | Reset database inside container |

#### Fresh start (Docker)

```bash
docker compose down -v      # remove existing volume
docker compose up -d        # recreate with fresh migrations + seeds
cd frontend && npm run dev
```

#### Normal start (Docker, data preserved)

```bash
docker compose up -d        # starts with existing data, applies pending migrations
cd frontend && npm run dev
```

### Database setup

#### Option A: Using migrations (recommended)

1. Create the database:
   ```bash
   createdb SISIII2026_89241041
   ```

2. Configure environment:
   ```bash
   cd backend
   cp .env.example .env    # then fill in your credentials
   ```

3. Run migrations:
   ```bash
   npm run db:migrate      # applies all pending migrations
   ```

4. (Optional) Seed development data:
   ```bash
   npm run db:seed         # inserts idempotent test data
   ```

#### Option B: Docker (automated)

```bash
docker compose up -d       # runs migrations + seeds automatically
```

#### Option C: Using raw SQL (deprecated)

> ⚠️ The raw SQL files in `backend/db/` are retained as a schema snapshot for reference only. Use migrations for all new deployments.

1. Create the database and import the schema:
   ```bash
   mysql -u studenti -p < backend/db/schema.sql
   ```

2. (Optional) Import development seed data:
   ```bash
   mysql -u studenti -p < backend/db/seed.sql
   ```

#### Migration commands

| Command | Description |
|---|---|
| `npm run db:migrate` | Apply all pending migrations |
| `npm run db:rollback` | Rollback the last batch of migrations |
| `npm run db:migrate:make <name>` | Create a new migration file |
| `npm run db:seed` | Run all seed files |
| `npm run db:seed:make <name>` | Create a new seed file |
| `npm run db:verify` | Verify database state (tables, indexes) |
| `npm run db:status` | Show applied and pending migrations |
| `npm run db:reset` | Rollback, re-migrate, and re-seed (dev only) |

#### Seed accounts (dev-only)

| Email | Password | Role |
|---|---|---|
| `admin@studenthub.test` | `admin123` | admin |
| `organizer@studenthub.test` | `organizer123` | organizer |
| `student@famnit.upr.si` | `student123` | student |

### Backend
```bash
cd backend
cp .env.example .env    # then fill in your credentials
npm install
node server.js          # starts on :30011
```

The `.env` file (gitignored) requires:
```
DB_HOST=localhost
DB_USER=studenti
DB_PASSWORD=********
DB_DATABASE=SISIII2026_89241041
DB_PORT=5432
DB_CLIENT=pg
SESSION_SECRET=********
FRONTEND_URL=http://localhost:30010
PORT=30011
```

### Frontend
```bash
cd frontend
npm install
npm run dev             # starts on :30010, proxies /api → :30011
```

Then open the app at the frontend host (e.g. `http://88.200.63.148:30010`).

---

## Dependencies

**Backend:** `express`, `knex`, `pg`, `express-session`, `bcryptjs`, `dotenv`, plus Node's built-in `crypto` (ticket codes). The repository still keeps `mysql2` as a legacy compatibility dependency in configuration, but PostgreSQL is the active runtime target.

**Frontend:** `react`, `react-dom`, `react-router-dom`, `vite`, `qrcode.react`.

---

## Development workflow

- **One feature per branch** → pull request into `dev` (merge commits, so the branch history is visible) → merge `dev` into `main` only at tested milestones.
- Small, incremental, meaningful commits.
- See `backend/README.md` for how to test every endpoint.

---

## API reference

The full endpoint-by-endpoint testing guide (paths, auth, request bodies, expected responses and status codes) lives in **[`backend/README.md`](./backend/README.md)**.
