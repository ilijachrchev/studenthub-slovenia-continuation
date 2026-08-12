# Opportunity Hub — Task Plan & Architecture Audit

> **Agent 0 (Planner & Auditor)** deliverable.
> Branch: `feature/agent-0-planner`.
> Scope: audit the existing StudentHub Slovenia codebase and produce a self-contained
> execution specification for the **Opportunity Hub** feature set (an internships /
> jobs / volunteering / scholarships board layered onto the existing events platform),
> decomposed across 6 implementation agents.
>
> **This document changes no feature code.** It only records findings and specifications.

---

## Table of Contents

1. [System Audit & Gap Analysis](#1-system-audit--gap-analysis)
2. [Conventions the Feature Must Follow](#2-conventions-the-feature-must-follow)
3. [Domain Rules & State Machine (§3)](#3-domain-rules--state-machine-3)
4. [Database Schema Design (§4)](#4-database-schema-design-4)
5. [API Endpoint Specifications](#5-api-endpoint-specifications)
6. [Frontend Plan](#6-frontend-plan)
7. [6-Agent Decomposed Plan & Prompts (§7)](#7-6-agent-decomposed-plan--prompts-7)
8. [Integration Contract & Merge Order](#8-integration-contract--merge-order)

---

## 1. System Audit & Gap Analysis

### 1.1 Repository shape

```
backend/                Node/Express 5 API (CommonJS)
  app.js                Express app: helmet, cors, session, csrf, routes, error handler
  server.js             HTTP bootstrap
  db.js                 pg Pool (runtime query layer) — NOT Knex
  knexfile.js           Knex config (migrations + seeds only), pg OR mysql2 via DB_CLIENT
  db/migrations/        Knex migrations (timestamp-prefixed)
  db/seeds/             Knex seeds (01_development.js)
  middleware/           auth, catchAsync, csrf, logger, validate
  routes/               auth, lookups, student, events, registrations,
                        organizations, organizer, admin, bookmarks, feedback, search
  __tests__/            Jest + supertest (integration/, migration.test.js, etc.)
frontend/               React 19 + Vite 8 + react-router-dom 7 (ESM)
  src/App.jsx           BrowserRouter route table
  src/context/AuthContext.jsx  session-backed auth context (useAuth)
  src/components/auth/  ProtectedRoute, RoleRoute
  src/pages/            page components (fetch to /api/*)
```

### 1.2 Authentication & authorization — STATUS: ✅ present, session-based

- **Session engine:** `express-session` (`backend/app.js:48`). Cookie is the default
  `connect.sid`, `httpOnly`, `sameSite: "lax"`, `secure` in production, `maxAge` 24h.
- **Session shape:** `req.session.user = { id, first_name, last_name, email, role }`
  (set in `routes/auth.js` login/register). **Session is regenerated on login and
  register** to prevent fixation (`req.session.regenerate`).
- **Middleware** (`middleware/auth.js`):
  - `requireAuth(req,res,next)` → 401 `{ error: "Not logged in" }` if no `req.session.user`.
  - `requireRole(role)` → 401 if unauthenticated, else 403 `{ error: "Only <role>s can access this" }`
    if `req.session.user.role !== role`.
- **Roles:** `student`, `organizer`, `admin` (string column `user.role`, default `student`).
- **CSRF:** custom `validateOrigin` (`middleware/csrf.js`) rejects non-GET requests whose
  `Origin`/`Referer` is not allow-listed. Test env is bypassed.
- **Rate limiting:** `express-rate-limit` on `/api/auth/*` (20 / 15 min).
- **Frontend guards:** `AuthContext` calls `GET /api/auth/me` on mount; `ProtectedRoute`
  requires a user, `RoleRoute allowedRoles={[...]}` requires a role in the array.

> ⚠️ **GAP A — `requireRole` accepts only a single role string.** The frontend
> `RoleRoute` already accepts an **array** of roles. Opportunity Hub needs endpoints
> reachable by *either* organizer *or* admin (e.g. analytics), so **Agent 1 must extend
> the backend to a `requireRole(...roles)` / `requireAnyRole([...])` variant** that is
> backward compatible with the existing single-string call sites.

> ⚠️ **GAP B — In-memory session store.** No session store is configured, so
> `express-session` falls back to the process `MemoryStore`. This is fine for dev/single
> process but leaks memory and does not survive restarts or scale horizontally. Not
> blocking for the feature; flagged for the platform hardening backlog (out of scope
> for these 6 agents unless the team decides otherwise).

### 1.3 Database — STATUS: ✅ established schema, events domain only

- **Runtime queries** go through `db.js` — a raw `pg` `Pool` (`require("../db")`),
  using **positional `$1` placeholders** and `pool.query(...)`. Transactions use
  `pool.connect()` → `BEGIN` / `COMMIT` / `ROLLBACK` / `client.release()`
  (see `routes/organizer.js`, `routes/student.js`, `routes/admin.js`).
- **Schema is created by Knex migrations** (`knexfile.js` → `db/migrations/`):
  - `20260715000001_initial_schema.js` — all base tables via a single dependency-ordered
    loop with a `switch(name)` builder; idempotent (`hasTable` guard); raw
    `CREATE INDEX IF NOT EXISTS` for hot columns.
  - `20260715000002_add_query_indexes.js` — additional composite indexes via `knex.raw`.
- **Existing tables:** `university`, `faculty`, `tag`, `user`, `admin`, `organization`,
  `organizer_profile`, `event`, `event_tag`, `event_target`, `event_rejection`,
  `student_profile`, `user_interest`, `bookmark`, `registration`, `feedback`.
- **Existing status columns / lifecycles:**
  - `organization.status`: `pending → approved | rejected`.
  - `event.status`: `draft → submitted → published | rejected` (approve/reject by admin).
  - `event.registration_type`: `built_in | external | none`.
- **Seeds:** `db/seeds/01_development.js`, idempotent via `onConflict(...).ignore()`,
  seeds three canonical users (`admin@studenthub.test` / `organizer@studenthub.test` /
  `student@famnit.upr.si`).

> ⚠️ **GAP C — Reusable `tag` vocabulary exists.** Opportunity Hub "tags" should
> **reuse the existing `tag` table** via a new `opportunity_tag` join (mirroring
> `event_tag`), not introduce a parallel tag vocabulary.

> ⚠️ **GAP D — `search.js` uses `LIKE` (case-sensitive in PostgreSQL).** Existing event
> search (`routes/search.js:28`) uses `e.title LIKE '%q%'`, which is case-sensitive on
> Postgres. New opportunity search should use `ILIKE`. Not a blocker for this feature,
> noted so Agent 2 does not copy the bug.

> ⚠️ **GAP E — `bookmark.saved_At` has irregular mixed-case casing** requiring quoting
> (`b."saved_At"` in `routes/bookmarks.js:15`). New tables must use plain `snake_case`
> (`saved_at`) to avoid the quoting foot-gun.

### 1.4 Routing & middleware — STATUS: ✅ conventional

`app.js` mounts, in order: `helmet` → `cors(credentials)` → `express.json({limit:512kb})`
→ `session` → `validateOrigin` → `pino-http`, then `/api/health`, `/api`, and the
feature routers under `/api/*`, then optional static SPA serving from `./dist`, then a
**global error handler** that maps `err.status`/`err.statusCode` to JSON and otherwise
returns 500. Every async handler is wrapped in `catchAsync`.

> ℹ️ **Note — `catchAsync` self-handles errors.** `middleware/catchAsync.js` catches and
> responds `500` itself (it does not call `next(err)`), so the global error handler in
> `app.js` is mostly a safety net for synchronous/unwrapped middleware. New routes should
> keep using `catchAsync` and return explicit status codes for expected errors (400/401/
> 403/404/409), matching the existing style.

### 1.5 Frontend — STATUS: ✅ conventional SPA

- **Router:** `react-router-dom@7`, `<BrowserRouter>` wrapping `<AuthProvider>` wrapping
  a flat `<Routes>` table in `App.jsx`. Layout is applied by wrapping the page element in
  `StudentLayout` / `OrganizerLayout` / `AdminLayout`.
- **Auth/state:** `AuthContext` (`useState` + `useContext`, no Redux). `useAuth()` yields
  `{ user, loading, refreshUser }`. Guards: `ProtectedRoute`, `RoleRoute`.
- **Data fetching:** raw `fetch("/api/...", { credentials: "include" })`; Vite dev proxy
  routes `/api` to the backend. Optimistic UI in places (e.g. `Home.jsx` bookmark toggle).
- **Styling:** plain CSS colocated per component/page (`./css/*.css`), no CSS framework.
- **Tests:** Vitest + Testing Library (`src/__tests__/*.test.jsx`, `test-setup.js`).

> ℹ️ **Note — `App.jsx` already imports `ApplicationStatus`** and a `/application-status`
> route (`RoleRoute allowedRoles={["organizer"]}`). This is the **organization
> application status page** (organizer's org-approval state), *not* Opportunity Hub job
> applications. Agent 5 must not collide with this route name; use `/opportunities/...`
> and `/my-applications` namespaces.

### 1.6 Uncommitted / experimental code — STATUS: ⚠️ none found (premise correction)

The Agent 0 brief asks to fix or park "uncommitted working tree diffs or experimental
code (e.g. `auth.js`, `swagger.js`)". Audit result, verified with `git status --porcelain`:

- **Working tree is clean** — there are **no uncommitted diffs** on the base branch.
- **`swagger.js` does not exist** anywhere in the repository (`grep -ri swagger` → no
  matches; no swagger/OpenAPI dependency in either `package.json`). There is therefore
  nothing to fix or park here.
- **`middleware/auth.js` is committed and healthy** — no experimental leftovers. Its only
  actionable limitation is **GAP A** above (single-role signature), which is a planned
  Agent 1 enhancement, not a defect to revert.

**Conclusion:** No parking/cleanup action is required before feature work begins. If an
OpenAPI/Swagger surface is later desired, it should be added deliberately (candidate:
Agent 4 or a follow-up), not resurrected from non-existent code. The remaining audit
findings that *do* need action are GAP A–E above, all folded into the agent scopes below.

---

## 2. Conventions the Feature Must Follow

These are **hard constraints** derived from the audit. Every agent obeys them.

| Area | Rule |
|---|---|
| Runtime DB access | `const pool = require("../db")`; parameterized `$1` placeholders; **never** string-interpolate user input. Transactions via `pool.connect()` + `BEGIN/COMMIT/ROLLBACK/release()`. |
| Schema changes | New Knex migration(s) in `backend/db/migrations/`, timestamp-prefixed **later** than `20260715000002` (e.g. `20260801xxxxxx_opportunity_hub.js`). Idempotent (`await knex.schema.hasTable(...)` guards). Provide a real `down()`. Raw indexes via `CREATE INDEX IF NOT EXISTS`. |
| Naming | `snake_case` columns (no `saved_At`-style casing). Reuse existing `user`, `organization`, `tag`, `faculty` tables via FKs. Quote the reserved table name `"user"` in SQL. |
| Auth | Reuse `requireAuth` / `requireRole`. Store nothing new in the session unless justified. Ownership checks join through `organizer_profile` (see `routes/organizer.js`). |
| Errors | `catchAsync`-wrap all async handlers; return explicit 400/401/403/404/409; log via `require("../middleware/logger")`. |
| Validation | Add validators to `middleware/validate.js` following the existing `validateX(body) → string[]` pattern; length caps like the events domain. |
| Routing | One router file per subdomain in `backend/routes/`; mount in `app.js` under `/api/<subdomain>`. |
| CSRF | Mutating requests already pass through `validateOrigin`; no extra token needed, but keep methods semantically correct (POST/PUT/DELETE). |
| Frontend | `fetch(..., { credentials: "include" })`; guard pages with `ProtectedRoute`/`RoleRoute`; colocated CSS; consume `useAuth()`; no new state library. |
| Seeds | Extend `db/seeds/01_development.js` (or add `02_opportunities.js`) idempotently with `onConflict(...).ignore()`. |
| Tests | Backend: Jest + supertest under `backend/__tests__/`. Frontend: Vitest + Testing Library under `frontend/src/__tests__/`. |

---

## 3. Domain Rules & State Machine (§3)

### 3.1 Entities & statuses

**Opportunity** — a posting created by an organizer, approved by an admin, discoverable
by students.

| Status | Meaning |
|---|---|
| `draft` | Being edited by the organizer. Not visible publicly. |
| `submitted` | Awaiting admin moderation. |
| `published` | Live and discoverable (only while `application_deadline` not passed). |
| `rejected` | Rejected by admin (reason recorded); organizer may edit → resubmit. |
| `closed` | Organizer stopped accepting applications; still visible read-only. |
| `archived` | Removed from listings; terminal. |

**Application** — a student's application to a published opportunity.

| Status | Meaning | Terminal? |
|---|---|---|
| `submitted` | Just applied. | no |
| `under_review` | Organizer is reviewing. | no |
| `shortlisted` | Passed initial screen. | no |
| `interview` | Invited to interview. | no |
| `offer` | Offer extended. | no |
| `accepted` | Offer accepted / hired. | **yes** |
| `rejected` | Declined by organizer. | **yes** |
| `withdrawn` | Withdrawn by applicant. | **yes** |

### 3.2 Transition matrices

**Opportunity** (`from → allowed to`):

| From \ To | draft | submitted | published | rejected | closed | archived |
|---|---|---|---|---|---|---|
| draft | – | ✅ organizer | – | – | – | ✅ organizer |
| submitted | – | – | ✅ admin | ✅ admin | – | – |
| published | – | – | – | – | ✅ organizer | ✅ organizer |
| rejected | ✅ organizer | – | – | – | – | ✅ organizer |
| closed | – | – | ✅ organizer¹ | – | – | ✅ organizer |
| archived | – | – | – | – | – | – |

¹ Reopen a closed (still-approved) opportunity only if the deadline has not passed.

**Application** (`from → allowed to`):

| From \ To | under_review | shortlisted | interview | offer | accepted | rejected | withdrawn |
|---|---|---|---|---|---|---|---|
| submitted | ✅ org | ✅ org | ✅ org | – | – | ✅ org | ✅ applicant |
| under_review | – | ✅ org | ✅ org | ✅ org | – | ✅ org | ✅ applicant |
| shortlisted | – | – | ✅ org | ✅ org | – | ✅ org | ✅ applicant |
| interview | – | – | – | ✅ org | – | ✅ org | ✅ applicant |
| offer | – | – | – | – | ✅ org | ✅ org | ✅ applicant |
| accepted / rejected / withdrawn | – | – | – | – | – | – | – |

- **org** = an organizer who owns the opportunity's organization (join `organizer_profile`).
- **applicant** = the user who owns the application. Applicant may `withdraw` from any
  non-terminal state; may not perform any other transition.
- **admin** may perform any opportunity moderation transition (`submitted → published|rejected`)
  and may `archive` any opportunity (moderation override).

### 3.3 Shared state-machine module (Agent 1 deliverable)

`backend/domain/opportunityState.js` — pure, dependency-free, unit-testable:

```js
// Allowed transitions keyed by entity → from → [to...]
const OPPORTUNITY_TRANSITIONS = {
  draft:     ["submitted", "archived"],
  submitted: ["published", "rejected"],
  published: ["closed", "archived"],
  rejected:  ["draft", "archived"],
  closed:    ["published", "archived"],
  archived:  [],
};

const APPLICATION_TRANSITIONS = {
  submitted:    ["under_review", "shortlisted", "interview", "rejected", "withdrawn"],
  under_review: ["shortlisted", "interview", "offer", "rejected", "withdrawn"],
  shortlisted:  ["interview", "offer", "rejected", "withdrawn"],
  interview:    ["offer", "rejected", "withdrawn"],
  offer:        ["accepted", "rejected", "withdrawn"],
  accepted:     [],
  rejected:     [],
  withdrawn:    [],
};

// Which role may drive each application transition.
function applicationActorFor(to) {
  return to === "withdrawn" ? "applicant" : "organizer";
}

function canTransition(map, from, to) {
  return Array.isArray(map[from]) && map[from].includes(to);
}

// Throws an Error with .status = 409 when illegal (matches route error style).
function assertTransition(map, from, to) {
  if (!canTransition(map, from, to)) {
    const err = new Error(`Illegal transition: ${from} → ${to}`);
    err.status = 409;
    throw err;
  }
}

module.exports = {
  OPPORTUNITY_TRANSITIONS, APPLICATION_TRANSITIONS,
  applicationActorFor, canTransition, assertTransition,
};
```

Routes call `assertTransition(...)` before the `UPDATE`, and record the change in
`application_status_history` inside the same transaction (see §4.5).

---

## 4. Database Schema Design (§4)

New migration file: `backend/db/migrations/20260801000001_opportunity_hub.js`.
Follows the repo's idempotent, dependency-ordered style. All tables use `t.increments("id")`
integer PKs (except pure join/singleton tables), FKs to existing tables, and
`snake_case` columns. Reference implementation below (Knex schema builder + raw triggers/
indexes). `down()` drops in reverse dependency order (trigger + function first).

### 4.1 Dependency order

```
opportunity_category        (deps: —)
opportunity                 (deps: organization, user, opportunity_category)
opportunity_tag             (deps: opportunity, tag)              -- reuses existing tag
opportunity_target          (deps: opportunity, faculty)         -- optional audience targeting
opportunity_bookmark        (deps: user, opportunity)
application                 (deps: opportunity, user)
application_status_history  (deps: application, user)  [APPEND-ONLY TRIGGER]
notification_preference     (deps: user)
opportunity_report          (deps: opportunity, user)
opportunity_analytics       (deps: opportunity)
opportunity_view_event      (deps: opportunity, user)  -- raw append log feeding analytics
recommendation              (deps: user, opportunity)
```

### 4.2 Reference migration (`exports.up`)

```js
exports.up = async function (knex) {
  // ---- opportunity_category (lookup / categories) ----
  if (!(await knex.schema.hasTable("opportunity_category"))) {
    await knex.schema.createTable("opportunity_category", (t) => {
      t.increments("id").primary();
      t.string("name", 120).notNullable();
      t.string("slug", 120).notNullable().unique("uniq_opp_category_slug");
      t.text("description").nullable();
    });
  }

  // ---- opportunity ----
  if (!(await knex.schema.hasTable("opportunity"))) {
    await knex.schema.createTable("opportunity", (t) => {
      t.increments("id").primary();
      t.integer("organization_id").notNullable();
      t.integer("posted_by").notNullable();            // user.id (organizer)
      t.integer("category_id").nullable();
      t.string("title", 255).notNullable();
      t.text("description").nullable();
      t.string("type", 30).notNullable();              // internship|job|volunteer|scholarship|research
      t.string("location", 255).nullable();
      t.boolean("is_remote").notNullable().defaultTo(false);
      t.string("application_mode", 20).notNullable().defaultTo("built_in"); // built_in|external
      t.string("external_url", 500).nullable();        // required when application_mode='external'
      t.string("compensation", 120).nullable();
      t.integer("capacity").nullable();                // null = unlimited
      t.timestamp("application_deadline").nullable();
      t.timestamp("starts_at").nullable();
      t.string("status", 30).notNullable().defaultTo("draft");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("organization_id").references("organization.id");
      t.foreign("posted_by").references("user.id");
      t.foreign("category_id").references("opportunity_category.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status ON opportunity (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_org ON opportunity (organization_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_category ON opportunity (category_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status_deadline ON opportunity (status, application_deadline)");
  }

  // ---- opportunity_tag (reuses existing tag table) ----
  if (!(await knex.schema.hasTable("opportunity_tag"))) {
    await knex.schema.createTable("opportunity_tag", (t) => {
      t.integer("opportunity_id").notNullable();
      t.integer("tag_id").notNullable();
      t.primary(["opportunity_id", "tag_id"]);
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("tag_id").references("tag.id");
    });
  }

  // ---- opportunity_target (optional faculty audience) ----
  if (!(await knex.schema.hasTable("opportunity_target"))) {
    await knex.schema.createTable("opportunity_target", (t) => {
      t.integer("opportunity_id").notNullable();
      t.integer("faculty_id").notNullable();
      t.primary(["opportunity_id", "faculty_id"]);
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("faculty_id").references("faculty.id");
    });
  }

  // ---- opportunity_bookmark ----
  if (!(await knex.schema.hasTable("opportunity_bookmark"))) {
    await knex.schema.createTable("opportunity_bookmark", (t) => {
      t.increments("id").primary();
      t.integer("user_id").notNullable();
      t.integer("opportunity_id").notNullable();
      t.timestamp("saved_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["user_id", "opportunity_id"], "uniq_opp_bookmark");
      t.foreign("user_id").references("user.id");
      t.foreign("opportunity_id").references("opportunity.id");
    });
  }

  // ---- application ----
  if (!(await knex.schema.hasTable("application"))) {
    await knex.schema.createTable("application", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("applicant_id").notNullable();         // user.id (student)
      t.text("cover_letter").nullable();
      t.string("resume_url", 500).nullable();
      t.string("status", 30).notNullable().defaultTo("submitted");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["opportunity_id", "applicant_id"], "uniq_application");
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("applicant_id").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_opportunity ON application (opportunity_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_applicant ON application (applicant_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_status ON application (status)");
  }

  // ---- application_status_history (APPEND-ONLY) ----
  if (!(await knex.schema.hasTable("application_status_history"))) {
    await knex.schema.createTable("application_status_history", (t) => {
      t.increments("id").primary();
      t.integer("application_id").notNullable();
      t.string("from_status", 30).nullable();          // null for the initial 'submitted' row
      t.string("to_status", 30).notNullable();
      t.integer("changed_by").notNullable();           // user.id who caused the change
      t.text("note").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("application_id").references("application.id");
      t.foreign("changed_by").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_ash_application ON application_status_history (application_id)");

    // Append-only enforcement: block UPDATE and DELETE at the DB layer.
    await knex.raw(`
      CREATE OR REPLACE FUNCTION prevent_status_history_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'application_status_history is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_ash_no_update_delete
      BEFORE UPDATE OR DELETE ON application_status_history
      FOR EACH ROW EXECUTE FUNCTION prevent_status_history_mutation();
    `);
  }

  // ---- notification_preference (one row per user) ----
  if (!(await knex.schema.hasTable("notification_preference"))) {
    await knex.schema.createTable("notification_preference", (t) => {
      t.integer("user_id").notNullable().primary();
      t.boolean("email_on_status_change").notNullable().defaultTo(true);
      t.boolean("email_on_new_opportunity").notNullable().defaultTo(true);
      t.boolean("email_on_deadline").notNullable().defaultTo(true);
      t.string("digest_frequency", 10).notNullable().defaultTo("weekly"); // none|daily|weekly
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("user_id").references("user.id");
    });
  }

  // ---- opportunity_report (moderation) ----
  if (!(await knex.schema.hasTable("opportunity_report"))) {
    await knex.schema.createTable("opportunity_report", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("reporter_id").notNullable();          // user.id
      t.string("reason", 60).notNullable();            // spam|scam|inappropriate|duplicate|other
      t.text("details").nullable();
      t.string("status", 20).notNullable().defaultTo("open"); // open|reviewing|resolved|dismissed
      t.integer("resolved_by").nullable();             // admin user.id
      t.timestamp("resolved_at").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("reporter_id").references("user.id");
      t.foreign("resolved_by").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_report_status ON opportunity_report (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_report_opportunity ON opportunity_report (opportunity_id)");
  }

  // ---- opportunity_analytics (per-opportunity rollup) ----
  if (!(await knex.schema.hasTable("opportunity_analytics"))) {
    await knex.schema.createTable("opportunity_analytics", (t) => {
      t.integer("opportunity_id").notNullable().primary();
      t.integer("view_count").notNullable().defaultTo(0);
      t.integer("application_count").notNullable().defaultTo(0);
      t.integer("bookmark_count").notNullable().defaultTo(0);
      t.timestamp("last_viewed_at").nullable();
      t.foreign("opportunity_id").references("opportunity.id");
    });
  }

  // ---- opportunity_view_event (raw append log feeding analytics) ----
  if (!(await knex.schema.hasTable("opportunity_view_event"))) {
    await knex.schema.createTable("opportunity_view_event", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("user_id").nullable();                 // null = anonymous view
      t.timestamp("viewed_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("user_id").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_view_event_opportunity ON opportunity_view_event (opportunity_id)");
  }

  // ---- recommendation (precomputed personalized scores) ----
  if (!(await knex.schema.hasTable("recommendation"))) {
    await knex.schema.createTable("recommendation", (t) => {
      t.increments("id").primary();
      t.integer("user_id").notNullable();
      t.integer("opportunity_id").notNullable();
      t.decimal("score", 8, 4).notNullable().defaultTo(0);
      t.string("reason", 255).nullable();              // human-readable "why"
      t.timestamp("generated_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["user_id", "opportunity_id"], "uniq_recommendation");
      t.foreign("user_id").references("user.id");
      t.foreign("opportunity_id").references("opportunity.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_recommendation_user_score ON recommendation (user_id, score)");
  }
};
```

### 4.3 Reference migration (`exports.down`)

```js
exports.down = async function (knex) {
  await knex.raw("DROP TRIGGER IF EXISTS trg_ash_no_update_delete ON application_status_history");
  await knex.raw("DROP FUNCTION IF EXISTS prevent_status_history_mutation()");
  await knex.schema
    .dropTableIfExists("recommendation")
    .dropTableIfExists("opportunity_view_event")
    .dropTableIfExists("opportunity_analytics")
    .dropTableIfExists("opportunity_report")
    .dropTableIfExists("notification_preference")
    .dropTableIfExists("application_status_history")
    .dropTableIfExists("application")
    .dropTableIfExists("opportunity_bookmark")
    .dropTableIfExists("opportunity_target")
    .dropTableIfExists("opportunity_tag")
    .dropTableIfExists("opportunity")
    .dropTableIfExists("opportunity_category");
};
```

### 4.4 Constraint & index summary

| Table | PK | Unique | FKs | Indexes |
|---|---|---|---|---|
| opportunity_category | id | slug | — | — |
| opportunity | id | — | organization, posted_by→user, category | status; org; category; (status, deadline) |
| opportunity_tag | (opportunity_id, tag_id) | (PK) | opportunity, tag | (PK covers) |
| opportunity_target | (opportunity_id, faculty_id) | (PK) | opportunity, faculty | (PK covers) |
| opportunity_bookmark | id | (user_id, opportunity_id) | user, opportunity | uniq covers lookups |
| application | id | (opportunity_id, applicant_id) | opportunity, applicant→user | opportunity; applicant; status |
| application_status_history | id | — | application, changed_by→user | application • **append-only trigger** |
| notification_preference | user_id | — | user | — |
| opportunity_report | id | — | opportunity, reporter→user, resolved_by→user | status; opportunity |
| opportunity_analytics | opportunity_id | — | opportunity | — |
| opportunity_view_event | id | — | opportunity, user | opportunity |
| recommendation | id | (user_id, opportunity_id) | user, opportunity | (user_id, score) |

### 4.5 Append-only history — write pattern

Writes are **transactional**: change the `application.status` and insert the history row in
one transaction. Never `UPDATE`/`DELETE` a history row (the trigger raises and aborts the
transaction).

```js
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "UPDATE application SET status = $1, updated_at = NOW() WHERE id = $2",
    [to, applicationId]
  );
  await client.query(
    `INSERT INTO application_status_history
       (application_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [applicationId, from, to, req.session.user.id, note || null]
  );
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
}
```

The initial `submitted` row is inserted (`from_status = NULL`) inside the same transaction
that creates the application.

---

## 5. API Endpoint Specifications

All routes are `catchAsync`-wrapped, return JSON, and follow existing status-code
conventions. Ownership = the acting organizer has an `organizer_profile` row for the
opportunity's `organization_id`.

### 5.1 `/api/opportunities` — postings (Agent 1 base + Agent 2 discovery)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/opportunities` | public | List `published`, non-expired. Filters: `?category=`, `?type=`, `?tag=`, `?remote=`, `?q=` (ILIKE), `?page=`, `?limit=`. Personalized ordering when logged in (faculty/interest/category match, mirrors `events.js` scoring). |
| GET | `/api/opportunities/categories` | public | List categories (lookup). |
| GET | `/api/opportunities/mine` | organizer | Organizer's own postings (all statuses). |
| GET | `/api/opportunities/:id` | public¹ | Detail (published) + tags + org. Owner/admin may view non-published. |
| POST | `/api/opportunities` | organizer | Create `draft` (must own an **approved** org, mirrors `organizer.js` event create). Body: title, description, type, category_id, location, is_remote, application_mode, external_url, compensation, capacity, application_deadline, starts_at, tag_ids[], target_faculty_ids[]. |
| PUT | `/api/opportunities/:id` | organizer owner | Edit while `draft` or `rejected`. |
| POST | `/api/opportunities/:id/submit` | organizer owner | `draft → submitted` (assertTransition). |
| POST | `/api/opportunities/:id/close` | organizer owner | `published → closed`. |
| POST | `/api/opportunities/:id/reopen` | organizer owner | `closed → published` (deadline check). |

¹ `:id` detail also increments analytics via the view endpoint (§5.5), not as a side effect.

### 5.2 `/api/applications` — application lifecycle (Agent 3)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/opportunities/:id/apply` | student | Create application (opportunity must be `published`, `application_mode='built_in'`, deadline valid, not already applied, capacity not exceeded). Inserts initial history row. |
| GET | `/api/applications/mine` | student | Applicant's own applications + opportunity summary. |
| GET | `/api/applications/:id` | applicant **or** owner org | Single application detail. |
| GET | `/api/applications/:id/history` | applicant **or** owner org | Append-only status timeline. |
| POST | `/api/applications/:id/withdraw` | applicant | `* → withdrawn` (assertTransition; applicant actor). |
| GET | `/api/opportunities/:id/applications` | organizer owner | List applications for an owned opportunity (filter `?status=`). |
| POST | `/api/applications/:id/transition` | organizer owner | Body `{ to_status, note? }`; validates actor = organizer via `applicationActorFor`, then `assertTransition`, then transactional update + history insert. |

### 5.3 `/api/opportunity-bookmarks` — saves (Agent 2)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/opportunity-bookmarks` | required | Saved opportunities (full rows). |
| GET | `/api/opportunity-bookmarks/ids` | optional | `{ ids: [...] }` (empty if anon), mirrors `bookmarks.js`. |
| POST | `/api/opportunity-bookmarks/:id` | required | Save (409 if already saved). |
| DELETE | `/api/opportunity-bookmarks/:id` | required | Unsave (404 if none). |

### 5.4 `/api/notifications` — preferences (Agent 4)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/notifications/preferences` | required | Current user prefs (create-on-read defaults if missing). |
| PUT | `/api/notifications/preferences` | required | Update the four flags + `digest_frequency`. |

> In-app/email *delivery* is out of scope; Agent 4 delivers the **preference store + API**
> and the write-side hooks (status-change transitions read prefs to decide whether an email
> *would* be queued — stubbed/logged, not actually sent).

### 5.5 `/api/analytics` — tracking & reporting (Agent 4)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/opportunities/:id/view` | optional | Append `opportunity_view_event` + upsert `opportunity_analytics.view_count`/`last_viewed_at`. |
| GET | `/api/analytics/opportunities/:id` | organizer owner **or** admin | Rollup for one opportunity (views, applications, bookmarks, funnel by application status). |
| GET | `/api/analytics/overview` | organizer **or** admin | Aggregate across the caller's owned opportunities (admin: platform-wide). |

### 5.6 `/api/recommendations` — personalization (Agent 4)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/recommendations` | required | Top-N precomputed `recommendation` rows joined to published opportunities, ordered by score. Falls back to on-the-fly scoring if none precomputed. |
| POST | `/api/recommendations/refresh` | required | Recompute the caller's recommendations (student faculty + interests + category affinity). |

### 5.7 `/api/moderation` — admin review (Agent 4)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/opportunities/:id/report` | required | File a report (`reason`, `details`). |
| GET | `/api/moderation/queue` | admin | Pending `submitted` opportunities for approval. |
| POST | `/api/moderation/opportunities/:id/approve` | admin | `submitted → published`. |
| POST | `/api/moderation/opportunities/:id/reject` | admin | `submitted → rejected` (reason required). |
| GET | `/api/moderation/reports` | admin | List reports (filter `?status=`). |
| POST | `/api/moderation/reports/:id/resolve` | admin | Set `resolved`/`dismissed` (+ optional `archive` of the opportunity). |

**New `app.js` mounts (Agent 1 adds the router imports & `app.use` lines):**

```js
app.use("/api/opportunities", opportunityRoutes);          // Agent 1 base, Agent 2 extends
app.use("/api/applications", applicationRoutes);           // Agent 3
app.use("/api/opportunity-bookmarks", opportunityBookmarkRoutes); // Agent 2
app.use("/api/notifications", notificationRoutes);         // Agent 4
app.use("/api/analytics", analyticsRoutes);                // Agent 4
app.use("/api/recommendations", recommendationRoutes);     // Agent 4
app.use("/api/moderation", moderationRoutes);              // Agent 4
```

---

## 6. Frontend Plan

New pages/components consuming the APIs, guarded per role, styled with colocated CSS,
using `useAuth()` and `fetch(..., { credentials: "include" })`. New routes in `App.jsx`
(namespaced to avoid the existing `/application-status` organizer route):

| Route | Guard | Page |
|---|---|---|
| `/opportunities` | public (StudentLayout) | `OpportunityList` (filters, cards, save toggle) |
| `/opportunities/:id` | public (StudentLayout) | `OpportunityDetail` (apply / external link / save / report) |
| `/opportunities/new` | `RoleRoute organizer` | `CreateOpportunity` |
| `/opportunities/:id/edit` | `RoleRoute organizer` | `EditOpportunity` |
| `/my-applications` | `ProtectedRoute` | `MyApplications` (status timeline) |
| `/saved-opportunities` | `ProtectedRoute` | `SavedOpportunities` |
| `/organizer/opportunities` | `RoleRoute organizer` | `OrganizerOpportunities` + applicant review board |
| `/settings/notifications` | `ProtectedRoute` | `NotificationSettings` |
| `/admin/opportunities` | `RoleRoute admin` | `OpportunityModeration` (approve/reject queue + reports) |

Shared components mirror existing patterns (`components/home/EventCard.jsx`,
`components/admin/*`, `components/organizer/ChipMultiSelect.jsx`): `OpportunityCard`,
`OpportunityFilters`, `ApplicationStatusBadge`, `StatusTimeline`, `ApplicantRow`.

---

## 7. 6-Agent Decomposed Plan & Prompts (§7)

Each agent works in its **own git worktree/branch**, touches a disjoint file set, and
integrates through the contracts in §3–§6. Merge order and dependencies are in §8.

### Agent 1 — Foundation · `feature/agent-1-foundation`
**Owns:** DB migration, seeds, state-machine module, auth enhancement, base opportunity
CRUD + categories, router mounts.
**Files:** `backend/db/migrations/20260801000001_opportunity_hub.js`,
`backend/db/seeds/02_opportunities.js`, `backend/domain/opportunityState.js`,
`backend/middleware/auth.js` (extend), `backend/middleware/validate.js` (add
`validateOpportunity`), `backend/routes/opportunities.js` (base CRUD + submit/close/reopen
+ categories), `backend/app.js` (imports + all 7 `app.use` mounts, even for routers other
agents fill in — export stub routers so the app boots).

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 1 (Foundation) for the Opportunity Hub feature. Work in a git worktree on
> branch `feature/agent-1-foundation`. Read `TASK_PLAN.md` first; obey §2 conventions
> exactly. Deliver: (1) a new idempotent Knex migration
> `backend/db/migrations/20260801000001_opportunity_hub.js` implementing every table in §4
> including the **append-only trigger** on `application_status_history`, with a working
> `down()`; (2) idempotent seeds `backend/db/seeds/02_opportunities.js` (a few categories,
> 2–3 published opportunities owned by the seeded approved org #1, tags via
> `opportunity_tag`) using `onConflict(...).ignore()`; (3) `backend/domain/opportunityState.js`
> exactly as specified in §3.3 (`canTransition`, `assertTransition`, transition maps,
> `applicationActorFor`); (4) extend `backend/middleware/auth.js` so `requireRole` accepts
> **multiple roles** (e.g. `requireRole("organizer","admin")`) while remaining backward
> compatible with all existing single-string callers — do not break current tests;
> (5) `validateOpportunity(body)` in `middleware/validate.js` following the existing
> `validateX → string[]` pattern; (6) `backend/routes/opportunities.js` with the base
> endpoints from §5.1 (`POST /`, `PUT /:id`, `POST /:id/submit|close|reopen`,
> `GET /categories`, `GET /mine`, `GET /:id`) — enforce approved-org ownership like
> `routes/organizer.js`, use `pool` + `$1` placeholders + transactions for tag/target
> inserts, and drive every status change through `assertTransition`; (7) wire **all seven**
> Opportunity Hub routers into `app.js` per §5 (create minimal stub routers exporting an
> empty `express.Router()` for the ones Agents 2–4 own, so the app boots and mounts
> cleanly). Run `npm test` in `backend/`; the migration test and existing suites must pass.
> Do not touch frontend files or the other agents' route bodies beyond the stubs.

### Agent 2 — Discovery · `feature/agent-2-discovery`
**Owns:** public listing/detail with filtering, search (ILIKE), personalized ordering,
opportunity bookmarks.
**Files:** `backend/routes/opportunities.js` (GET list + detail personalization — extends
Agent 1's file at the marked sections), `backend/routes/opportunityBookmarks.js`.

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 2 (Discovery) for the Opportunity Hub feature. Work in a git worktree on
> branch `feature/agent-2-discovery`, branched from Agent 1's foundation. Read `TASK_PLAN.md`;
> obey §2. Deliver: (1) the public `GET /api/opportunities` list per §5.1 — only
> `published` and non-expired (`application_deadline IS NULL OR application_deadline >= NOW()`),
> supporting `category`, `type`, `tag`, `remote`, `q`, `page`, `limit`; use **ILIKE** for
> `q` (see GAP D — do not copy the case-sensitive `LIKE` from `routes/search.js`); batch-load
> tags with an `IN ($1,$2,...)` query like `routes/events.js`; when `req.session.user`
> exists, compute a relevance `score` from student faculty (`opportunity_target`),
> interests (`user_interest`↔`opportunity_tag`), and category affinity, and sort by
> score then soonest deadline — mirror the scoring approach in `routes/events.js`;
> (2) `GET /api/opportunities/:id` public detail with tags + organization, allowing owner/
> admin to view non-published; (3) `backend/routes/opportunityBookmarks.js` implementing
> §5.3 exactly like `routes/bookmarks.js` (note: use `saved_at`, plain snake_case — GAP E).
> Keep everything parameterized. Add/extend Jest coverage for filters and the anonymous-vs-
> logged-in ordering. Do not modify application, moderation, analytics, notification, or
> recommendation code.

### Agent 3 — Lifecycle · `feature/agent-3-lifecycle`
**Owns:** applications, transactional status history, transitions via the state machine,
organizer review board API.
**Files:** `backend/routes/applications.js`, plus the `POST /api/opportunities/:id/apply`
and `GET /api/opportunities/:id/applications` handlers.

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 3 (Lifecycle) for the Opportunity Hub feature. Work in a git worktree on
> branch `feature/agent-3-lifecycle`, branched from Agent 1's foundation. Read `TASK_PLAN.md`;
> obey §2 and the state machine in §3. Deliver `backend/routes/applications.js` and the
> apply/list endpoints implementing §5.2: (1) `POST /api/opportunities/:id/apply` (student
> only) — reject unless the opportunity is `published`, `application_mode='built_in'`,
> deadline valid, capacity not exceeded, and the student hasn't already applied (unique
> constraint + 409); create the `application` **and** its initial
> `application_status_history` row (`from_status = NULL`, `to_status='submitted'`) in one
> transaction; (2) `GET /api/applications/mine`, `GET /api/applications/:id`,
> `GET /api/applications/:id/history` with correct applicant-or-owner authorization;
> (3) `POST /api/applications/:id/withdraw` (applicant) and
> `POST /api/applications/:id/transition` (organizer owner, body `{to_status, note?}`) — both
> must load the current status, call `applicationActorFor(to)` to verify the caller's role
> matches, call `assertTransition(APPLICATION_TRANSITIONS, from, to)` (409 on illegal), then
> perform the transactional status update + history insert from §4.5. Never UPDATE/DELETE a
> history row. (4) `GET /api/opportunities/:id/applications` (organizer owner, `?status=`
> filter). Use `require("../domain/opportunityState")` from Agent 1. Add Jest integration
> tests covering a legal transition path, an illegal transition (expect 409), withdrawal,
> and that the append-only trigger rejects a direct history UPDATE. Touch only application-
> related code.

### Agent 4 — Platform · `feature/agent-4-platform`
**Owns:** notifications preferences, recommendations, analytics tracking/reporting,
moderation + admin approval/reports.
**Files:** `backend/routes/notifications.js`, `backend/routes/recommendations.js`,
`backend/routes/analytics.js`, `backend/routes/moderation.js`.

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 4 (Platform) for the Opportunity Hub feature. Work in a git worktree on
> branch `feature/agent-4-platform`, branched from Agent 1's foundation. Read `TASK_PLAN.md`;
> obey §2. Fill in the four routers Agent 1 stubbed: (1) `notifications.js` — §5.4
> preferences GET/PUT with create-on-read defaults; (2) `analytics.js` — §5.5:
> `POST /api/opportunities/:id/view` appends `opportunity_view_event` and upserts
> `opportunity_analytics` (use `INSERT ... ON CONFLICT (opportunity_id) DO UPDATE`);
> `GET /api/analytics/opportunities/:id` (owner or admin — use Agent 1's multi-role
> `requireRole("organizer","admin")` plus an ownership check for organizers) returning a
> funnel by application status; `GET /api/analytics/overview`; (3) `recommendations.js` —
> §5.6: `GET /api/recommendations` reads precomputed `recommendation` rows joined to
> published opportunities ordered by score with an on-the-fly fallback;
> `POST /api/recommendations/refresh` recomputes for the caller from faculty + interests +
> category affinity and upserts `recommendation` (respect the unique constraint);
> (4) `moderation.js` — §5.7: report filing (any auth user), admin approval queue,
> approve (`submitted→published`) / reject (`submitted→rejected`, reason required) driven
> through `assertTransition(OPPORTUNITY_TRANSITIONS, ...)`, and report listing/resolution.
> Any status-change that fires a notification should read `notification_preference` and
> **log** the intended email (delivery is out of scope — do not send real email). Add Jest
> tests for preferences round-trip, analytics view increment, and admin approve/reject.
> Touch only these four routers.

### Agent 5 — Frontend · `feature/agent-5-frontend`
**Owns:** all React pages/components/routes for Opportunity Hub.
**Files:** `frontend/src/App.jsx` (add routes per §6), `frontend/src/pages/opportunities/*`,
`frontend/src/pages/MyApplications.jsx`, `frontend/src/pages/SavedOpportunities.jsx`,
`frontend/src/pages/NotificationSettings.jsx`, `frontend/src/pages/admin/OpportunityModeration.jsx`,
`frontend/src/components/opportunities/*`, colocated CSS.

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 5 (Frontend) for the Opportunity Hub feature. Work in a git worktree on
> branch `feature/agent-5-frontend`. Read `TASK_PLAN.md`; obey §2 and §6. Build the React
> UI against the APIs in §5 using the existing conventions: `react-router-dom@7` routes in
> `App.jsx`, `useAuth()` from `AuthContext`, `ProtectedRoute`/`RoleRoute` guards,
> `fetch(url, { credentials: "include" })`, colocated CSS, and component patterns from
> `components/home/EventCard.jsx`, `components/organizer/ChipMultiSelect.jsx`, and
> `components/admin/*`. Deliver the routes/pages/components in the §6 table:
> `OpportunityList` (filters + save toggle with optimistic update like `Home.jsx`),
> `OpportunityDetail` (apply for built-in / external link / save / report), organizer
> `CreateOpportunity`/`EditOpportunity` and an applicant-review board that drives
> `POST /api/applications/:id/transition`, `MyApplications` with a status timeline,
> `SavedOpportunities`, `NotificationSettings`, and admin `OpportunityModeration`
> (approve/reject queue + reports). **Do not** reuse or rename the existing
> `/application-status` organizer route — use the `/opportunities/*`, `/my-applications`,
> and `/admin/opportunities` namespaces. Add Vitest + Testing Library tests for at least the
> list rendering and a guarded route. Touch only `frontend/`.

### Agent 6 — Testing & Hardening · `feature/agent-6-testing`
**Owns:** cross-cutting end-to-end coverage, migration/rollback test, state-machine unit
tests, seed verification, docs.
**Files:** `backend/__tests__/integration/opportunities.test.js`,
`backend/__tests__/integration/applications.test.js`,
`backend/__tests__/integration/moderation.test.js`,
`backend/__tests__/opportunityState.test.js`, `backend/__tests__/migration.test.js`
(extend for new tables + append-only trigger), frontend flow tests, and a short
`docs/opportunity-hub.md`.

> ⬇️ **Ready-to-paste prompt:**
>
> You are Agent 6 (Testing & Hardening) for the Opportunity Hub feature. Work in a git
> worktree on branch `feature/agent-6-testing`, branched after Agents 1–5 have merged (or
> against an integration branch). Read `TASK_PLAN.md`. Deliver comprehensive tests without
> changing feature behavior: (1) unit-test `backend/domain/opportunityState.js` — every
> legal and a sample of illegal transitions for both entities, and `applicationActorFor`;
> (2) extend `backend/__tests__/migration.test.js` to assert the new tables/indexes exist
> and that a direct `UPDATE`/`DELETE` on `application_status_history` **fails** (append-only
> trigger); (3) Jest + supertest integration flows using the seeded users
> (`organizer@studenthub.test`, `student@famnit.upr.si`, `admin@studenthub.test`): create →
> submit → admin approve an opportunity; student apply → organizer transitions → terminal;
> illegal transition returns 409; bookmark save/unsave; report → admin resolve; auth guards
> return 401/403 correctly; (4) Vitest coverage for a key frontend flow (list + apply
> guard); (5) write `docs/opportunity-hub.md` summarizing the model, statuses, and
> endpoints. Ensure `npm test` passes in both `backend/` and `frontend/`. Report any real
> defects you find as findings; fix only test/harness code, not feature logic (raise
> feature bugs back to the owning agent).

---

## 8. Integration Contract & Merge Order

**Dependency graph:**

```
Agent 1 (foundation) ─┬─> Agent 2 (discovery)
                      ├─> Agent 3 (lifecycle)
                      └─> Agent 4 (platform)
Agents 1–4 (backend) ──> Agent 5 (frontend, against live API)
Agents 1–5 ──────────────> Agent 6 (testing & docs)
```

**Recommended merge order:** 1 → 2 → 3 → 4 → 5 → 6.

**Shared-file protocol:**
- `backend/app.js` and `backend/routes/opportunities.js` are **co-edited** by Agents 1–2.
  Agent 1 lands first with stub routers and clearly marked extension points; Agent 2 fills
  the list/detail sections. Rebasing Agent 2 onto merged Agent 1 avoids conflicts.
- `backend/middleware/validate.js` and `backend/middleware/auth.js` are edited **only by
  Agent 1**; other agents consume them.
- `backend/domain/opportunityState.js` is authored by Agent 1 and imported read-only by
  Agents 3 and 4.

**Definition of done (whole feature):**
- Migration applies and rolls back cleanly; append-only trigger enforced.
- All seven routers mounted; every endpoint in §5 implemented and authorized per role.
- State transitions rejected with 409 when illegal; history is append-only and complete.
- Frontend routes guarded and functional end-to-end against the API.
- `npm test` green in `backend/` and `frontend/`; new integration + unit tests included.
- No regressions to the existing events domain.
```
