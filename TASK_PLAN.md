# TASK_PLAN.md — Student Opportunity Hub

**Author:** Agent 0 (Lead Software Architect & System Designer)
**Repository:** `studenthub-slovenia` (experimental remote `origin`, protected remote `original` — never push/modify `original`)
**Working branch base:** `dev` (integration). Do all feature work on isolated `feature/opp-hub-agent-N` branches / worktrees.
**Status of this document:** Ready to execute. Sections 1–7 are the specification; Section 7 contains ready-to-paste prompts for all 8 agents.

---

## 0. Repository Reality Check (what actually exists today)

Before any new code, understand the concrete conventions this codebase already uses. **Do not invent new patterns; extend these.**

### 0.1 Stack (verified)
- **Backend:** Node/Express 5, CommonJS (`"type": "commonjs"`). Entry `backend/server.js` → `backend/app.js`.
- **Data access:** Raw `pg` `Pool` exported from `backend/db.js` (`pool.query("... $1 ...", [args])`). **Knex is used ONLY for migrations and seeds** (`backend/knexfile.js`, `backend/db/migrations`, `backend/db/seeds`). New runtime queries use the `pg` Pool with `$n` placeholders — **not** the Knex query builder.
- **Async route wrapper:** `backend/middleware/catchAsync.js` wraps every async handler.
- **Auth:** `express-session` cookie sessions. On login/register the session is regenerated and `req.session.user = { id, first_name, last_name, email, role }` is set. Roles: `student`, `organizer`, `admin`.
- **Authorization middleware:** `backend/middleware/auth.js` exports `{ requireAuth, requireRole }`. `requireRole(role)` returns a middleware; used as `requireRole("organizer")`, `requireRole("admin")`.
- **CSRF/Origin:** `backend/middleware/csrf.js` `validateOrigin` (checks Origin/Referer on state-changing methods; bypassed when `NODE_ENV=test`).
- **Logging:** `pino` + `pino-http` (`backend/middleware/logger.js`).
- **Rate limiting:** `express-rate-limit` (see `authLimiter` in `routes/auth.js`).
- **Password hashing:** `bcryptjs` (cost 10).
- **Pagination contract (existing):** `GET /api/events` returns `{ events, page, limit, total }`; `page = max(1, parsed)`, `limit = min(50, max(1, parsed||20))`. Reuse this shape (`{ items, page, limit, total }`) for all new list endpoints.
- **Transactions (existing pattern):** `const client = await pool.connect(); try { await client.query("BEGIN"); ...; await client.query("COMMIT"); } catch { await client.query("ROLLBACK"); ... } finally { client.release(); }` — see `routes/organizer.js` and `routes/admin.js`.
- **Tests (backend):** Jest + supertest. `backend/jest.config.js` → `globalSetup.js` **drops and recreates `studenthub_test`**, runs `knex.migrate.latest()` + `knex.seed.run()`, resets sequences. Integration tests use `request.agent(app)` per role and clean up their own users in `afterAll`. Origin checks are disabled under `NODE_ENV=test`.
- **Frontend:** React 19 + `react-router-dom` 7 + Vite 8. Tests: Vitest 4 + Testing Library + jsdom. Auth via `src/context/AuthContext.jsx` (`GET /api/auth/me`, `useAuth()`). Guards: `components/auth/ProtectedRoute.jsx` (any logged-in user), `components/auth/RoleRoute.jsx` (`allowedRoles`). `fetch(..., { credentials: "include" })`. Pages in `src/pages`, components in `src/components`, page CSS colocated in `css/` subfolders.

### 0.2 Existing tables (do not duplicate)
`university, faculty, tag, user, admin, organization, organizer_profile, event, event_tag, event_target, event_rejection, student_profile, user_interest, bookmark, registration, feedback`.

**Reuse, do not fork:** `user` (quoted — reserved word: `"user"`), `organization`, `organizer_profile` (ownership: `role_in_org = 'owner'`), `tag`, `faculty`. The new Opportunity domain is a **parallel vertical** to `event`; it references `user`, `organization`, and `tag` but introduces its own tables.

### 0.3 Lifecycle precedent already in the code
`event.status`: `draft → submitted → published | rejected`, with organizer-owned transitions guarded by a join to `organizer_profile`, and admin approve/reject writing an audit row (`event_rejection`) inside a transaction. **The Opportunity application state machine must follow this exact house style** (guarded transitions + audit row + transaction).

### 0.4 Naming quirks to respect / avoid
- `bookmark."saved_At"` is mixed-case and must be quoted — an existing wart. **Do not repeat it.** All new columns use `snake_case` lowercase (`created_at`, `updated_at`, `saved_at`).
- `"user"` must always be quoted in raw SQL.

---

## 1. Immediate Working-Tree Diagnostic (must be resolved by Agent 1)

There are two uncommitted modifications on `feature/backend-production-hardening`.

### 1.1 `backend/middleware/auth.js` — **BROKEN, app will not boot**
The working copy replaced the session-based `requireAuth` with an **incomplete JWT experiment**:

```js
// current broken state (abridged)
function validateJWT(req, res, next) {
  ...
  const decoded = jwt.verify(token, process.env.JWT_SECRET); // jwt is never imported
  ...
}
function requireRole(role) { /* still session-based, still correct */ }
module.exports = { requireAuth, requireRole }; // requireAuth no longer exists
```

**Concrete failures (all confirmed):**
1. `module.exports = { requireAuth, requireRole }` references `requireAuth`, which was deleted → **`ReferenceError: requireAuth is not defined`** at module load. Any route importing it (`routes/bookmarks.js`, `routes/feedback.js`, `routes/organizations.js`, `routes/registrations.js`, plus `requireRole` consumers `routes/organizer.js`, `routes/admin.js`, `routes/student.js`) crashes the app on `require`.
2. `validateJWT` uses `jwt.verify` but **`jwt` is never imported and `jsonwebtoken` is not in `backend/package.json`** (verified). The experiment is non-functional.
3. `validateJWT` is neither exported nor consumed anywhere.
4. `requireRole` was left intact and correct (session-based).

**Required resolution (Agent 1):**
- Restore session-based `requireAuth` (identical semantics to the committed version at `HEAD`: 401 `{ error: "Not logged in" }` when `!req.session.user`).
- **The app's auth model is sessions, not JWT.** There is no JWT infrastructure (no secret provisioning, no token issuance, no dependency). Remove the broken `validateJWT` from the module. **Preserve the intent** by extracting it verbatim into `backend/middleware/_experiments/jwt.md` (a parked note, not wired) so no exploratory work is lost, and reference it in the commit message. Do **not** add `jsonwebtoken` or wire JWT into the request path.
- Keep `requireRole` exactly as-is.
- Verify `module.exports = { requireAuth, requireRole }` resolves and the full suite boots.
- Do this **without** `git reset --hard`/`git checkout --` that would discard the intent silently — read the diff, port the good part (the note), fix the breakage.

### 1.2 `backend/config/swagger.js` — trivial churn on an orphaned file
The only change is **removal of the trailing newline** (`\ No newline at end of file`). Additionally, this file is **orphaned**: it `require("swagger-jsdoc")`, which is **not** a dependency (verified), and swagger is **not wired into `app.js`** (verified). It cannot run today.

**Required resolution (Agent 1):**
- Restore the trailing newline (revert the whitespace-only change) so the working tree is clean. Do **not** attempt to wire up Swagger in this feature — out of scope. If desired, leave a one-line TODO note in the plan/commit that Swagger is unwired and `swagger-jsdoc` is missing (informational only).

After 1.1 + 1.2, `git status` for these two files must be clean and `npm --prefix backend test` must boot the app.

---

## 2. Feature Architecture & System Design

### 2.1 Domain summary
The **Student Opportunity Hub** is a lifecycle discovery system for **opportunities** (types: `internship`, `project`, `workshop`, `volunteering`, `competition`). It spans:
- **Discovery:** browse/search/filter/paginate published opportunities; view detail; bookmark.
- **Lifecycle management (organizer):** create → submit → publish → close/archive; edit while draft.
- **Applications state machine (student↔organizer):** `pending → reviewing → accepted | rejected | withdrawn`, with an **append-only** status-history audit.
- **Notifications:** in-app notifications emitted on lifecycle/application events, with per-user preferences.
- **Deterministic recommendations:** transparent scoring over the user's own activity signals (bookmarks, applies, viewed categories/tags, recency). **No external AI/ML APIs.**
- **Analytics:** organizer dashboards (funnel per opportunity) and admin oversight, built from an `analytics_events` log.
- **Moderation:** users report opportunities; admins review/resolve reports.

### 2.2 Component boundaries (backend)
```
routes/opportunities.js        → public discovery + organizer CRUD/lifecycle (Agent 2)
routes/applications.js         → student apply/withdraw + organizer review transitions (Agent 3)
routes/notifications.js        → list/mark-read + preferences (Agent 3)
routes/recommendations.js      → GET personalized ranked list + explanations (Agent 4)
routes/analytics.js            → event ingestion (POST) + organizer analytics (GET) (Agent 4)
routes/moderation.js           → user report submit + admin queue/resolve (Agent 4)

lib/opportunity/statusMachine.js   → pure transition table + guard fns (Agent 1 contract, Agent 3 impl)
lib/opportunity/notifications.js   → emit(userId, type, payload, client?) service (Agent 3)
lib/opportunity/recommend.js       → deterministic scorer + explainer (Agent 4)
lib/opportunity/analytics.js       → recordEvent(...) helper (Agent 4)
lib/opportunity/contracts.js       → shared enums/constants (Agent 1)
middleware/validateOpportunity.js  → body validators, mirrors validate.js style (Agent 1 skeleton)
models/opportunity.js (optional thin data-access helpers) (Agent 1)
```

**Router registration is centralized in `app.js` and owned exclusively by Agent 1** (it mounts all new routers as stubs in the foundation commit). Downstream agents fill in the body of their own route file and **never edit `app.js`** → zero merge conflicts on the app entrypoint.

### 2.3 Component boundaries (frontend)
```
src/api/opportunities.js       → typed fetch helpers (Agent 1 stub: shared client + endpoints map)
src/pages/opportunities/*      → Discovery, Detail, MyApplications, Saved (Agent 5)
src/pages/notifications/*      → Notifications center (Agent 5)
src/pages/organizer/opps/*     → Manage opportunities, applicants, analytics (Agent 6)
src/pages/admin/moderation/*   → Report queue, resolve (Agent 6)
src/components/opportunities/* → cards, filters, status badges (Agent 5 owns student, Agent 6 owns org/admin)
```
**`src/App.jsx` route registration and `src/context` are owned by Agent 1** (adds all new `<Route>` entries pointing at lazy placeholder components in the foundation commit). Agents 5 and 6 implement the page components behind those routes and **never edit `App.jsx`**.

### 2.4 End-to-end data flow (apply example)
```
Student UI (Agent 5)
  → POST /api/opportunities/:id/apply  (credentials: include)
    → validateOrigin (CSRF) → requireAuth → requireRole("student")
      → BEGIN
        → insert opportunity_applications (status='pending')  [unique(user,opportunity) guard]
        → insert opportunity_status_history (null → pending, actor=student)
        → notifications.emit(organizerOwner, 'application.received', {...}, client)
        → analytics.recordEvent('application_created', {...}, client)
      → COMMIT
    → 201 { application }
  ← UI updates "My Applications"; organizer sees a notification badge (poll GET /api/notifications)
```

### 2.5 Security rules (non-negotiable, enforced server-side)
1. **Server-side RBAC only.** UI guards (`RoleRoute`) are UX, never the security boundary. Every mutating route re-checks `req.session.user` + role.
2. **Ownership checks (IDOR prevention).** An organizer may only read/mutate opportunities and applications belonging to an organization they own (`organizer_profile.user_id = session.user.id`). Never trust an `organization_id` from the request body for authorization — derive it from the session's owned orgs.
3. **Application privacy.** A student sees only their own applications. An organizer sees applications only for their own opportunities. Admins see aggregates for moderation, not private application notes unless explicitly required by a report.
4. **State transitions are guarded by both role AND valid prior state** (Section 3 matrix), inside a transaction, with an audit row. Reject invalid transitions with `409`.
5. **History is append-only.** No route ever `UPDATE`s or `DELETE`s `opportunity_status_history`. (Enforced by convention + code review + optional DB revoke — see §2.6.)
6. **CSRF/Origin** applies to all POST/PUT/PATCH/DELETE (already global via `validateOrigin`).
7. **Rate limiting** on application submission and report submission (reuse `express-rate-limit` pattern) to prevent spam.
8. **Parameterized queries only** (`$n`). No string interpolation of user input into SQL.
9. **Input validation** on every write (length caps, enum whitelists, integer coercion), mirroring `middleware/validate.js`.
10. **No secrets, no external AI.** Recommendations are pure deterministic SQL/JS.

### 2.6 Immutability enforcement for status history
- App layer: only `INSERT` is ever issued against `opportunity_status_history`; no UPDATE/DELETE code paths exist.
- DB layer (belt-and-suspenders, added by Agent 1 migration): a Postgres `BEFORE UPDATE OR DELETE` trigger on `opportunity_status_history` that `RAISE EXCEPTION`s. The migration's `down()` drops the trigger and function. This makes tampering fail loudly even outside the app.

---

## 3. Application State Machine & Notifications

### 3.1 States
`pending`, `reviewing`, `accepted`, `rejected`, `withdrawn`.
- **Initial:** `pending` (on student apply).
- **Terminal:** `accepted`, `rejected`, `withdrawn` (no outgoing transitions).

### 3.2 Transition matrix

| # | From | To | Actor (role) | Guard (prior state + ownership) | Emitted notification(s) | Analytics event |
|---|------|-----|-------------|--------------------------------|-------------------------|-----------------|
| T0 | — | `pending` | `student` (applicant) | opportunity is `published` & not past deadline; no existing non-withdrawn application by this user | `application.received` → organizer owner | `application_created` |
| T1 | `pending` | `reviewing` | `organizer` (owns opp) | prior = `pending` | `application.status_changed` → student | `application_reviewing` |
| T2 | `reviewing` | `accepted` | `organizer` (owns opp) | prior = `reviewing` | `application.accepted` → student | `application_accepted` |
| T3 | `reviewing` | `rejected` | `organizer` (owns opp) | prior = `reviewing` | `application.rejected` → student | `application_rejected` |
| T4 | `pending` | `rejected` | `organizer` (owns opp) | prior = `pending` (fast-reject) | `application.rejected` → student | `application_rejected` |
| T5 | `pending` | `withdrawn` | `student` (applicant) | prior = `pending` | `application.withdrawn` → organizer owner | `application_withdrawn` |
| T6 | `reviewing` | `withdrawn` | `student` (applicant) | prior = `reviewing` | `application.withdrawn` → organizer owner | `application_withdrawn` |

**Rules:**
- Any transition not in the table → `409 { error: "Invalid transition" }`.
- Transition from a terminal state → `409`.
- Actor role mismatch → `403`. Ownership mismatch → `403` (never `404`-leak the existence via different codes for owned vs not-owned when the caller is an organizer of a different org; return `404` for "not your opportunity" to avoid enumeration, `403` for wrong role — document this choice: **wrong role = 403, resource not visible to this owner = 404**).
- Every accepted transition: within ONE transaction — (a) `UPDATE opportunity_applications SET status=?, updated_at=now() WHERE id=? AND status=?` (the `AND status=?` is the **optimistic concurrency / TOCTOU guard**; if `rowCount===0`, ROLLBACK → `409`), (b) `INSERT` history row, (c) `emit` notification, (d) `recordEvent`.

### 3.3 State machine module contract (`lib/opportunity/statusMachine.js`)
```js
// Pure, no I/O. Owned as contract by Agent 1, implemented by Agent 3.
const APPLICATION_STATUSES = ["pending","reviewing","accepted","rejected","withdrawn"];
const TERMINAL = ["accepted","rejected","withdrawn"];
// transitions[from] = [{ to, actorRole }]
function canTransition(from, to, actorRole) -> boolean
function assertTransition(from, to, actorRole) -> void | throws { status:409|403 }
module.exports = { APPLICATION_STATUSES, TERMINAL, canTransition, assertTransition, TRANSITIONS };
```

### 3.4 Notifications subsystem
- **Table `notifications`** (Section 4). In-app only (no email in this feature).
- **`notifications.emit(recipientUserId, type, payload, client?)`**: inserts a row; if a DB `client` is passed, participates in the caller's transaction (so a rolled-back transition emits no notification). Respects `notification_preferences`: if the recipient disabled that `type` category, **do not insert** (or insert with `suppressed=true` — chosen design: **skip insert** to keep the table lean; preference read happens in the same transaction).
- **Notification types:** `application.received`, `application.status_changed`, `application.accepted`, `application.rejected`, `application.withdrawn`, `opportunity.published`, `opportunity.closing_soon`, `report.resolved`.
- **API:** `GET /api/notifications?unread=1&page=&limit=` → `{ items, page, limit, total, unread_count }`; `POST /api/notifications/:id/read`; `POST /api/notifications/read-all`; `GET/PUT /api/notifications/preferences`.
- **Delivery to UI:** client polls `GET /api/notifications?unread=1` (no websockets in scope). Document the polling interval (e.g., 60s) in the frontend.

---

## 4. Domain Model & Database Schema

All new tables via **one reversible Knex migration** authored by Agent 1: `db/migrations/20260812000001_opportunity_hub.js` (timestamp must sort after existing `20260715*`). Follow the existing migration file's defensive style (`hasTable` guards, dependency order, `up`/`down`). Use `knex.fn.now()` for timestamps, `t.timestamps` avoided in favor of explicit `created_at`/`updated_at` to match house style. Foreign keys reference existing tables where noted.

> **Indexing philosophy:** every column used in a `WHERE`/`ORDER BY`/join for discovery filters gets an index; composite indexes match the exact filter+sort combinations of Section 2/Agent 2 queries. Every FK gets an index (Postgres does not auto-index FKs).

### 4.1 `opportunities`
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| organization_id | int | NOT NULL, FK → `organization.id` |
| created_by | int | NOT NULL, FK → `"user".id` |
| category_id | int | NOT NULL, FK → `opportunity_categories.id` |
| title | varchar(255) | NOT NULL |
| description | text | NULL |
| location | varchar(255) | NULL (remote allowed) |
| is_remote | boolean | NOT NULL default false |
| positions | int | NULL (slots available) |
| application_deadline | timestamp | NULL |
| starts_at | timestamp | NULL |
| ends_at | timestamp | NULL |
| external_url | varchar(500) | NULL |
| status | varchar(20) | NOT NULL default `'draft'` — enum: `draft, submitted, published, closed, archived, rejected` |
| published_at | timestamp | NULL |
| created_at | timestamp | NOT NULL default now() |
| updated_at | timestamp | NOT NULL default now() |

Indexes: `idx_opp_status_published (status, published_at DESC)`, `idx_opp_org (organization_id)`, `idx_opp_category (category_id)`, `idx_opp_deadline (application_deadline)`, `idx_opp_created_by (created_by)`.
**Lifecycle:** `draft → submitted → published → closed → archived`; `submitted → rejected`. Only `published` (and before deadline) accepts applications.

### 4.2 `opportunity_categories`
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| slug | varchar(50) | NOT NULL, UNIQUE (`internship, project, workshop, volunteering, competition`) |
| name | varchar(100) | NOT NULL |

Seeded by Agent 1 with the five categories.

### 4.3 `opportunity_tags` (join, reuses existing `tag`)
| column | type | constraints |
|---|---|---|
| opportunity_id | int | NOT NULL, FK → `opportunities.id` ON DELETE CASCADE |
| tag_id | int | NOT NULL, FK → `tag.id` |
| PK | (opportunity_id, tag_id) | composite |

Index: `idx_opp_tags_tag (tag_id)` for reverse lookup in recommendations.

### 4.4 `opportunity_applications`
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| opportunity_id | int | NOT NULL, FK → `opportunities.id` |
| user_id | int | NOT NULL, FK → `"user".id` (the applicant) |
| status | varchar(20) | NOT NULL default `'pending'` — enum per §3.1 |
| cover_note | text | NULL (student message, ≤2000 chars) |
| created_at | timestamp | NOT NULL default now() |
| updated_at | timestamp | NOT NULL default now() |

Constraints/Indexes:
- **UNIQUE `uniq_application (opportunity_id, user_id)`** — one active application row per (student, opportunity). (Re-apply after withdrawal is a product decision: **allow re-apply by keeping the same row and transitioning is not possible from terminal; instead** we keep the unique constraint and treat withdrawn as terminal → a re-apply attempt returns `409`. Documented limitation; revisit later.)
- `idx_appl_opp_status (opportunity_id, status)` — organizer applicant lists & funnel counts.
- `idx_appl_user (user_id)` — student "My Applications".

### 4.5 `opportunity_status_history` (append-only audit)
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| application_id | int | NOT NULL, FK → `opportunity_applications.id` |
| from_status | varchar(20) | NULL (null for initial `T0`) |
| to_status | varchar(20) | NOT NULL |
| actor_user_id | int | NOT NULL, FK → `"user".id` |
| actor_role | varchar(20) | NOT NULL |
| reason | text | NULL |
| created_at | timestamp | NOT NULL default now() |

Index: `idx_history_application (application_id, created_at)`.
**Immutability:** `BEFORE UPDATE OR DELETE` trigger raises exception (see §2.6). No unique constraint (multiple rows per application = the trail).

### 4.6 `opportunity_bookmarks`
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| user_id | int | NOT NULL, FK → `"user".id` |
| opportunity_id | int | NOT NULL, FK → `opportunities.id` |
| saved_at | timestamp | NOT NULL default now() |
| UNIQUE | (user_id, opportunity_id) | `uniq_opp_bookmark` |

Index: `idx_opp_bookmark_user (user_id)`. (Note: lowercase `saved_at` — do **not** copy the legacy `"saved_At"` wart.)

### 4.7 `notifications`
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| user_id | int | NOT NULL, FK → `"user".id` (recipient) |
| type | varchar(50) | NOT NULL (see §3.4) |
| payload | jsonb | NOT NULL default '{}' (e.g., `{opportunityId, applicationId, title}`) |
| read_at | timestamp | NULL |
| created_at | timestamp | NOT NULL default now() |

Indexes: `idx_notif_user_unread (user_id, read_at)`, `idx_notif_user_created (user_id, created_at DESC)`.

### 4.8 `notification_preferences`
| column | type | constraints |
|---|---|---|
| user_id | int | PK, FK → `"user".id` |
| applications_enabled | boolean | NOT NULL default true |
| opportunities_enabled | boolean | NOT NULL default true |
| moderation_enabled | boolean | NOT NULL default true |
| updated_at | timestamp | NOT NULL default now() |

Preference category mapping: `application.*` → `applications_enabled`; `opportunity.*` → `opportunities_enabled`; `report.*` → `moderation_enabled`. Missing row = all defaults true (upsert on first PUT).

### 4.9 `opportunity_reports` (moderation)
| column | type | constraints |
|---|---|---|
| id | serial | PK |
| opportunity_id | int | NOT NULL, FK → `opportunities.id` |
| reporter_user_id | int | NOT NULL, FK → `"user".id` |
| reason_code | varchar(50) | NOT NULL (`spam, misleading, inappropriate, expired, other`) |
| details | text | NULL (≤1000 chars) |
| status | varchar(20) | NOT NULL default `'open'` — enum: `open, reviewing, resolved, dismissed` |
| resolved_by | int | NULL, FK → `"user".id` (admin) |
| resolution_note | text | NULL |
| created_at | timestamp | NOT NULL default now() |
| resolved_at | timestamp | NULL |

Constraints/Indexes: **UNIQUE `uniq_open_report (opportunity_id, reporter_user_id)`** to prevent a user spamming reports on the same opportunity; `idx_report_status (status, created_at)` for the admin queue.

### 4.10 `analytics_events`
| column | type | constraints |
|---|---|---|
| id | bigserial | PK |
| event_type | varchar(50) | NOT NULL (taxonomy §5.4) |
| actor_user_id | int | NULL, FK → `"user".id` (null for anonymous views) |
| opportunity_id | int | NULL, FK → `opportunities.id` |
| application_id | int | NULL, FK → `opportunity_applications.id` |
| metadata | jsonb | NOT NULL default '{}' |
| created_at | timestamp | NOT NULL default now() |

Indexes: `idx_analytics_opp_type (opportunity_id, event_type)`, `idx_analytics_type_created (event_type, created_at)`, `idx_analytics_actor (actor_user_id)`.
**Privacy:** analytics never stores PII beyond FKs; aggregates only.

### 4.11 Relationship summary
```
organization 1─* opportunities *─1 opportunity_categories
opportunities *─* tag           (via opportunity_tags)
opportunities 1─* opportunity_applications *─1 "user"(student)
opportunity_applications 1─* opportunity_status_history
"user" 1─* opportunity_bookmarks *─1 opportunities
"user" 1─* notifications
"user" 1─1 notification_preferences
opportunities 1─* opportunity_reports *─1 "user"(reporter)
analytics_events *─? opportunities/applications/"user"  (nullable FKs)
```

### 4.12 Migration & seed responsibilities
- **Migration** (Agent 1): all 10 tables + indexes + unique constraints + history-immutability trigger, fully reversible in `down()` (drop trigger+function first, then tables in reverse FK order).
- **Seed** (Agent 1, extend `db/seeds/01_development.js` or add `02_opportunity_hub.js`): 5 categories; ~6 opportunities across categories/orgs/statuses; a few tags links; 2–3 applications spanning states; matching status-history rows; a couple of bookmarks; one open report; default notification_preferences for seeded users; a handful of `analytics_events`. **Idempotent** (`onConflict().ignore()`), and must keep `globalSetup` sequence-reset happy (add new tables' sequences if their IDs are hard-coded).

---

## 5. Deterministic Recommendation Engine & Analytics Model

### 5.1 Constraints
- **No external AI/ML.** Pure SQL aggregation + JS scoring. Fully explainable and reproducible.
- Operates on the **requesting student's own signals** only. Cold-start (no signals) falls back to recency + global popularity.

### 5.2 Signals (all derived from the student's own rows)
| signal | source | weight |
|---|---|---|
| `w_tag` tag affinity | count of student's bookmarked/applied opportunities per `tag` (and `user_interest`) → overlap with candidate's tags | **5** per matching tag (capped at 3 tags → max 15) |
| `w_category` category affinity | count of student's bookmarks+applies per category → normalized to candidate's category | **4** if candidate category is the student's top category, **2** if in top-3 |
| `w_faculty` faculty targeting | candidate targets the student's faculty (if opportunity targeting is modeled; else skip) | **3** |
| `w_recency` freshness | candidate `published_at` recency, linear decay over 30 days | **0–3** (`3 * max(0, 1 - days_since_publish/30)`) |
| `w_deadline` urgency | application_deadline within 7 days (and not passed) | **+2** |
| `w_popularity` global popularity | count of applications on candidate (log-scaled) — tie-breaker / cold-start | **0–2** (`min(2, ln(1+applies))`) |

**Final score** = `w_tag + w_category + w_faculty + w_recency + w_deadline + w_popularity`.
Only `published`, not-past-deadline, not-already-applied, not-bookmarked-away opportunities are candidates. Deterministic tie-break: higher score, then sooner `application_deadline`, then newer `published_at`, then lower `id`.

### 5.3 Explanation generation
For each recommended item, produce a human-readable, **fact-derived** explanation string built from the top contributing signals (no invented content):
- tag: `"Because you saved 3 opportunities tagged Hackathon"`
- category: `"Matches your most-applied category: Internship"`
- deadline: `"Closing in 4 days"`
- popularity (cold-start): `"Popular with students right now"`
Return structured `reasons: [{ code, weight, label }]` plus a `primary_reason` (highest-weight). The frontend renders `primary_reason`; the array supports transparency ("Why am I seeing this?").

**Endpoint:** `GET /api/recommendations?limit=` → `{ items: [{ ...opportunity, score, primary_reason, reasons }] }`. Auth: `requireAuth` + `requireRole("student")`. Must be a single set of bounded queries (no N+1: batch tag/category lookups like `routes/events.js` does).

### 5.4 Analytics event taxonomy (`analytics_events.event_type`)
| event_type | emitted when | actor | metadata |
|---|---|---|---|
| `opportunity_viewed` | detail page GET | student/anon | `{ source }` |
| `opportunity_bookmarked` | bookmark POST | student | `{}` |
| `opportunity_unbookmarked` | bookmark DELETE | student | `{}` |
| `application_created` | T0 | student | `{ categoryId }` |
| `application_reviewing` | T1 | organizer | `{}` |
| `application_accepted` | T2 | organizer | `{}` |
| `application_rejected` | T3/T4 | organizer | `{}` |
| `application_withdrawn` | T5/T6 | student | `{}` |
| `opportunity_published` | organizer publish | organizer | `{}` |
| `recommendation_clicked` | student clicks a rec | student | `{ position, score }` |
| `report_submitted` | moderation report | student | `{ reasonCode }` |

**Ingestion:** most events are recorded server-side inside the relevant transaction (`analytics.recordEvent(type, {...}, client?)`). Client-only events (`opportunity_viewed` from anon, `recommendation_clicked`) go through `POST /api/analytics/events` (rate-limited, whitelist of allowed client event types, ignores/*does not trust* server-authoritative types).

### 5.5 Organizer analytics (derived, read endpoints)
`GET /api/organizer/opportunities/:id/analytics` (owner-guarded) →
```
{
  funnel: { views, bookmarks, applications, reviewing, accepted, rejected, withdrawn },
  conversion: { view_to_apply, apply_to_accept },   // ratios, guard divide-by-zero
  timeseries: [{ date, views, applications }]        // grouped by day from analytics_events
}
```
`GET /api/organizer/analytics/summary` → totals across all owned opportunities.
Admin: `GET /api/admin/analytics/overview` → platform-wide counts (no PII).

---

## 6. Six Coding Agent Worktree Decomposition (conflict-minimized)

**Design principle:** each agent owns a disjoint set of files. All shared/central files (`app.js`, `App.jsx`, `package.json`, migration, seeds, contracts) are written **once by Agent 1** in the foundation commit; downstream agents only touch files they exclusively own. This drives merge conflicts to ~zero.

| Agent | Domain | Exclusively-owned new files | May read (not edit) | Depends on |
|---|---|---|---|---|
| **1** | Foundation: auth fix, migration, seeds, contracts, stubs, wiring | `middleware/auth.js` (fix), `config/swagger.js` (revert), `db/migrations/2026...opportunity_hub.js`, `db/seeds/02_opportunity_hub.js`, `lib/opportunity/contracts.js`, `lib/opportunity/statusMachine.js` (contract skeleton), `middleware/validateOpportunity.js` (skeleton), **stub** `routes/opportunities.js|applications.js|notifications.js|recommendations.js|analytics.js|moderation.js`, `app.js` (mount stubs), `src/api/opportunities.js` (endpoints map), `src/App.jsx` (route stubs + placeholder pages), `middleware/_experiments/jwt.md` | everything | — |
| **2** | Discovery API + organizer CRUD/lifecycle | `routes/opportunities.js` (impl), `models/opportunity.js`, `middleware/validateOpportunity.js` (fill discovery/CRUD validators), tests `__tests__/integration/opportunities.test.js` | contracts, statusMachine, migration | 1 |
| **3** | Applications + state machine + history + notifications | `routes/applications.js`, `routes/notifications.js`, `lib/opportunity/statusMachine.js` (impl), `lib/opportunity/notifications.js`, tests `__tests__/integration/applications.test.js`, `notifications.test.js`, `__tests__/statusMachine.test.js` | contracts, opportunities table | 1 (and reads Agent 2's opportunity rows via seed) |
| **4** | Recommendations + analytics + organizer/admin analytics + moderation | `routes/recommendations.js`, `routes/analytics.js`, `routes/moderation.js`, `lib/opportunity/recommend.js`, `lib/opportunity/analytics.js`, tests `recommendations.test.js`, `analytics.test.js`, `moderation.test.js` | all tables/contracts | 1 (consumes tables; uses seed data) |
| **5** | Student frontend | `src/pages/opportunities/*`, `src/pages/notifications/*`, `src/components/opportunities/*` (student), colocated CSS, `src/pages/opportunities/__tests__/*` | `src/api/opportunities.js`, AuthContext, guards | 1 (routes/api stubs); contract-compatible with 2/3/4 |
| **6** | Organizer & admin frontend + E2E polish | `src/pages/organizer/opps/*`, `src/pages/admin/moderation/*`, `src/pages/organizer/analytics/*`, org/admin components, their CSS, tests | `src/api/opportunities.js`, guards | 1; contract-compatible with 2/3/4 |

**Ordering:** Agent 1 must merge to `dev` **first**. Agents 2, 3, 4 can then run in parallel (disjoint route files; all import Agent 1's contracts/tables). Agents 5, 6 can start against the stubs in parallel with 2–4 (they code to the API contract in `src/api/opportunities.js`), but their **acceptance tests** and manual E2E verification require 2–4 merged. Recommended merge order into `dev`: **1 → (2,3,4 in any order) → (5,6)**.

**Shared-file conflict guardrails:**
- No agent except 1 edits `app.js`, `src/App.jsx`, `knexfile.js`, `package.json` (if a new dep is truly needed, the agent flags it for Agent 1 / a coordination commit — but none of the six should need new deps; everything uses existing `pg`, `express`, `bcryptjs`, React).
- Each agent adds **new** migration files only if absolutely required; the primary schema is Agent 1's single migration. If Agent 3/4 needs a column, they add a **separate additive migration** with a later timestamp rather than editing Agent 1's file.
- Test files are per-agent and never shared.

---

## 7. Ready-to-Paste Agent Prompts

> Common preamble (applies to every agent): You are working in the `studenthub-slovenia` repo. Remotes: `origin` (experimental, push here), `original` (**never** push/modify). **Never** run `git reset --hard`, `git clean -fd`, or history-rewriting commands. Work in your own worktree/branch off `dev`. Backend uses the raw `pg` Pool (`db.js`, `$n` placeholders) for queries and **Knex only for migrations/seeds**. Wrap async handlers in `catchAsync`. Auth is **session-based** (`req.session.user = {id, role, ...}`); authorize with `requireAuth`/`requireRole` from `middleware/auth.js`. Follow existing patterns in `routes/events.js`, `routes/organizer.js`, `routes/admin.js`. Backend tests: Jest + supertest against the **`studenthub_test`** DB (managed by `__tests__/globalSetup.js`); use `request.agent(app)` per role and clean up your own data. Frontend: React 19 + react-router 7 + Vite, tests in Vitest; `fetch(..., { credentials: "include" })`. Produce a **single logical commit** (Conventional Commits) and end with a structured report (see each prompt). Run the relevant test suite green before committing. Never commit secrets.

---

### AGENT 1 — Core Architecture, Auth Cleanup, Migrations, Contracts, Stubs

**Scope & Deliverables**
1. **Fix `backend/middleware/auth.js`:** The working tree contains a broken, incomplete JWT experiment. Analyze the diff (`git diff backend/middleware/auth.js`). Restore the session-based `requireAuth` (401 `{error:"Not logged in"}` when `!req.session.user`) so `module.exports = { requireAuth, requireRole }` resolves. Keep `requireRole` unchanged. The app is **session-based; do not introduce JWT** (no `jsonwebtoken` dep exists, `jwt` is unimported, `validateJWT` is unused). **Preserve the experiment's intent** by moving the `validateJWT` idea verbatim into `backend/middleware/_experiments/jwt.md` (parked note, not wired) and mention it in the commit body. Do not lose work; do not wire JWT.
2. **Revert `backend/config/swagger.js`:** the only diff is a removed trailing newline on an orphaned file (`swagger-jsdoc` is not a dependency, not wired into `app.js`). Restore the trailing newline so the tree is clean. Do not wire Swagger.
3. **Migration** `backend/db/migrations/20260812000001_opportunity_hub.js`: create all 10 tables from TASK_PLAN §4 with all FKs, indexes, unique constraints, and the append-only `BEFORE UPDATE OR DELETE` trigger on `opportunity_status_history`. Fully reversible `down()` (drop trigger+function, then tables reverse-FK order). Follow the defensive style of `20260715000001_initial_schema.js`.
4. **Seed** `backend/db/seeds/02_opportunity_hub.js`: idempotent (`onConflict().ignore()`) categories (5), sample opportunities across categories/statuses/orgs, tag links, applications spanning states with matching status-history rows, bookmarks, one open report, default notification_preferences, sample analytics_events. Ensure `globalSetup` sequence reset still passes (extend its table list if you hard-code IDs, but prefer letting serials auto-assign where possible).
5. **Contracts** `backend/lib/opportunity/contracts.js`: export enums/constants — `OPPORTUNITY_STATUSES`, `APPLICATION_STATUSES`, `TERMINAL_APPLICATION_STATUSES`, `CATEGORY_SLUGS`, `NOTIFICATION_TYPES`, `ANALYTICS_EVENT_TYPES`, `REPORT_REASON_CODES`, `REPORT_STATUSES`.
6. **State machine skeleton** `backend/lib/opportunity/statusMachine.js`: export `TRANSITIONS`, `canTransition(from,to,role)`, `assertTransition(...)` per §3.3 (implement fully — it's pure and small; Agent 3 will consume it).
7. **Validator skeleton** `backend/middleware/validateOpportunity.js`: mirror `middleware/validate.js` style; export `validateOpportunityInput`, `validateApplicationInput`, `validateReportInput` (implement basic length/enum checks; Agents 2–4 may extend).
8. **Stub routers** for `routes/opportunities.js`, `applications.js`, `notifications.js`, `recommendations.js`, `analytics.js`, `moderation.js` — each an Express router returning `501 { error: "Not implemented" }` for a placeholder route, exporting the router. **Mount all six in `app.js`** under `/api/opportunities`, `/api/applications`, `/api/notifications`, `/api/recommendations`, `/api/analytics`, `/api/moderation` (organizer/admin analytics & moderation sub-routes may also mount under existing `/api/organizer` and `/api/admin` — coordinate by mounting the new routers at their own base paths to avoid editing existing route files).
9. **Frontend stubs:** `frontend/src/api/opportunities.js` (a fetch-helper module exporting the full endpoints map + typed helper functions returning `fetch` promises with `credentials:"include"`), and add all new `<Route>` entries to `src/App.jsx` pointing at lightweight placeholder page components (create `src/pages/opportunities/_Placeholder.jsx` etc., or inline `<div>` placeholders) guarded appropriately (`ProtectedRoute`/`RoleRoute`). Downstream frontend agents will replace placeholders.

**Files Likely Touched:** the files listed in §6 Agent 1 row.
**Files Explicitly Forbidden:** any `routes/*.js` **body** logic beyond stubs; any real business logic in opportunities/applications/etc.; `original` remote; `git reset --hard`/`clean`.
**Dependencies:** none (foundation).
**Test & Acceptance Criteria:**
- `git status` clean for `auth.js` and `swagger.js` intent (auth fixed, swagger newline restored).
- `npm --prefix backend test` boots the app (no `ReferenceError`), existing suites pass, and `globalSetup` runs the new migration + seed without error.
- `npx knex migrate:latest` then `npx knex migrate:rollback` cleanly applies and reverses the new migration (verify trigger created & dropped).
- Add `backend/__tests__/opportunityMigration.test.js`: asserts all 10 tables exist, the unique constraints exist, and that an `UPDATE`/`DELETE` on `opportunity_status_history` **throws** (immutability trigger).
- Add `backend/__tests__/statusMachine.test.js`: covers the full §3.2 transition matrix (valid + invalid + role mismatches).
- Frontend: `npm --prefix frontend run build` and `npm --prefix frontend test` pass with the new routes/stubs.
**Commit:** single commit `feat(opp-hub): foundation — auth fix, schema, contracts, route stubs`. Report: what was fixed in auth.js (and where the JWT note was parked), table/index list, and the exact stub endpoints downstream agents must implement.

---

### AGENT 2 — Backend Opportunity Discovery API (CRUD, Filtering, Pagination, RBAC)

**Scope & Deliverables**
- Implement `backend/routes/opportunities.js`:
  - `GET /api/opportunities` — public discovery. Filters via query: `category` (slug), `tag` (id or name), `q` (title/description ILIKE), `remote` (bool), `deadline_before`, `org` (id), plus `page`/`limit` (reuse §0.1 clamp: limit max 50). Only `status='published'` and org `status='approved'`. Return `{ items, page, limit, total }`. Batch tag lookups (no N+1, mirror `routes/events.js`). Add composite-index-friendly WHERE/ORDER (`published_at DESC`).
  - `GET /api/opportunities/:id` — public detail (published+approved only); include tags, category, org summary. Record `opportunity_viewed` analytics **best-effort** (do not fail the request if analytics insert fails; and only if Agent 4's helper exists — otherwise leave a clearly-marked hook comment `// analytics: recordEvent('opportunity_viewed', ...)` that Agent 4 wires, OR call the helper if merged).
  - `GET /api/organizer/opportunities` (mount within this router under a distinct path e.g. `/mine`) — organizer-owned list (all statuses), guarded by `requireRole("organizer")` + ownership join to `organizer_profile`.
  - `POST /api/opportunities` — organizer create (`status='draft'`), derive `organization_id` from the owner's **approved** org (never trust body), validate input, insert tags in a transaction. `requireRole("organizer")`.
  - `PUT /api/opportunities/:id` — organizer edit, only while `status='draft'`, owner-guarded.
  - `POST /api/opportunities/:id/submit` — `draft → submitted`, owner-guarded.
  - `POST /api/opportunities/:id/publish` — decide policy: either organizer self-publish or admin-approve. **Match the event precedent**: organizer `submit`, admin `approve→published`. Implement organizer `submit` here; admin approve lives in Agent 4's moderation OR keep a `publish` that an admin calls. Document the choice; keep applications gated on `published`.
  - `POST /api/opportunities/:id/close` and `/archive` — owner-guarded lifecycle.
- Extend `middleware/validateOpportunity.js` discovery/CRUD validators as needed (own only the functions you added; do not rewrite Agent 1's).
- `models/opportunity.js`: thin query helpers if useful (optional).

**Files Likely Touched:** `routes/opportunities.js`, `models/opportunity.js`, `middleware/validateOpportunity.js` (additive), `__tests__/integration/opportunities.test.js`.
**Files Explicitly Forbidden:** `app.js`, `src/App.jsx`, `middleware/auth.js`, `db/migrations/*` (use Agent 1's schema; if you truly need a column, add a **new** later-timestamped migration and flag it), applications/notifications/recommendations/analytics/moderation route files.
**Dependencies:** Agent 1 (schema, contracts, stub mounted).
**Test & Acceptance Criteria:** integration tests with `request.agent(app)` covering: public list filters + pagination metadata; detail 404 for unpublished; organizer create derives org from session (rejects body-supplied `organization_id`); non-owner organizer cannot edit another org's opportunity (expect 403/404 per §3.2 policy); student/anon cannot create (401/403); edit blocked when not draft (409). All green against `studenthub_test`.
**Commit:** `feat(opp-hub): opportunity discovery + organizer CRUD API`. Report: endpoints implemented, filter params, index usage, RBAC/ownership decisions, any added migration.

---

### AGENT 3 — Application Lifecycle, State Machine, History Audit, Notifications Backend

**Scope & Deliverables**
- Implement `backend/lib/opportunity/statusMachine.js` fully (if Agent 1 left it as skeleton, complete/verify it) per §3.
- Implement `backend/lib/opportunity/notifications.js`: `emit(recipientUserId, type, payload, client?)` — participates in caller's transaction when `client` passed; checks `notification_preferences` (skip insert if that category disabled); insert into `notifications`.
- Implement `backend/routes/applications.js`:
  - `POST /api/opportunities/:id/apply` (or `/api/applications` with body `{opportunityId}`) — student only; opportunity must be `published` and before deadline; unique-constraint guard (409 on duplicate); transaction: insert application (`pending`) → insert history (`null→pending`) → emit `application.received` to org owner → record `application_created`. Return 201.
  - `GET /api/applications/mine` — student's own applications with opportunity summary + current status. Privacy: only `req.session.user.id`.
  - `GET /api/opportunities/:id/applications` — organizer, owner-guarded: list applicants + statuses for their opportunity (this is the organizer applicant view). Include `cover_note`.
  - `POST /api/applications/:id/transition` (or explicit `/review`, `/accept`, `/reject`, `/withdraw`) — perform a guarded transition: load application + owning opportunity + org ownership; `assertTransition(from,to,role)`; **optimistic UPDATE** `... WHERE id=? AND status=?` (rowCount 0 → 409 TOCTOU guard); insert history; emit notification; record analytics — all in ONE transaction. Students may only `withdraw` their own; organizers may only `review/accept/reject` on owned opportunities.
  - `GET /api/applications/:id/history` — visible to the applicant (own) and the owning organizer; returns the append-only trail.
- Implement `backend/routes/notifications.js`: `GET /api/notifications?unread=&page=&limit=` → `{items,page,limit,total,unread_count}`; `POST /:id/read` (owner-guarded); `POST /read-all`; `GET/PUT /api/notifications/preferences` (upsert).

**Files Likely Touched:** `routes/applications.js`, `routes/notifications.js`, `lib/opportunity/statusMachine.js`, `lib/opportunity/notifications.js`, `__tests__/integration/applications.test.js`, `__tests__/integration/notifications.test.js`, `__tests__/statusMachine.test.js` (if not owned by Agent 1).
**Files Explicitly Forbidden:** `app.js`, `src/App.jsx`, `routes/opportunities.js`, recommendation/analytics/moderation files, `middleware/auth.js`, Agent 1's migration.
**Dependencies:** Agent 1 (schema/contracts/statusMachine skeleton). Reads opportunities seeded/created; if `analytics.recordEvent` (Agent 4) isn't merged yet, guard the call behind a safe optional require or a small local no-op fallback so tests pass independently, and note it for integration.
**Test & Acceptance Criteria:** full transition matrix enforced (valid transitions succeed + write history + notification; invalid → 409; wrong role → 403; cross-owner → 403/404). TOCTOU: concurrent double-transition — second returns 409 (simulate by asserting the `AND status=?` guard). Duplicate apply → 409. Student cannot view another student's application/history (privacy). Notifications respect preferences. Immutability: attempting to modify a history row fails. All green.
**Commit:** `feat(opp-hub): application state machine, audit history & notifications`. Report: transition implementation, TOCTOU/optimistic-lock approach, notification types emitted, privacy checks.

---

### AGENT 4 — Recommendation Engine, Analytics, Organizer Analytics, Admin Moderation

**Scope & Deliverables**
- `backend/lib/opportunity/analytics.js`: `recordEvent(eventType, {actorUserId, opportunityId, applicationId, metadata}, client?)` — insert into `analytics_events`; best-effort (never throws into the caller's response path; if given a `client`, participate; validate `eventType` against taxonomy).
- `backend/routes/analytics.js`: `POST /api/analytics/events` — accept a **whitelist** of client-authoritative event types only (`opportunity_viewed`, `recommendation_clicked`); rate-limited; never accept server-authoritative types from the client. Ignore/authorize actor from session (nullable for anon views).
- `backend/lib/opportunity/recommend.js` + `backend/routes/recommendations.js`: `GET /api/recommendations?limit=` (student only). Implement the deterministic scorer per §5.2/§5.3 with **bounded, batched** queries (no N+1). Return `{ items: [{...opportunity, score, primary_reason, reasons}] }`. Cold-start fallback (recency + popularity). Exclude already-applied/expired/unpublished.
- Organizer analytics (mount under this agent's router or `/api/organizer/...` base owned here): `GET /api/organizer/opportunities/:id/analytics` (owner-guarded funnel/conversion/timeseries per §5.5); `GET /api/organizer/analytics/summary`.
- Admin moderation `backend/routes/moderation.js`: `POST /api/opportunities/:id/report` (student, rate-limited, unique-per-reporter → 409 dupe) recording `report_submitted` analytics; `GET /api/admin/moderation/reports?status=` (admin queue); `POST /api/admin/moderation/reports/:id/resolve` (admin: set `resolved|dismissed`, `resolved_by`, note; emit `report.resolved` to reporter); optional admin action to `archive` a reported opportunity. Admin platform analytics `GET /api/admin/analytics/overview`.

**Files Likely Touched:** `routes/recommendations.js`, `routes/analytics.js`, `routes/moderation.js`, `lib/opportunity/recommend.js`, `lib/opportunity/analytics.js`, tests `recommendations.test.js`, `analytics.test.js`, `moderation.test.js`.
**Files Explicitly Forbidden:** `app.js`, `src/App.jsx`, `routes/opportunities.js`, `routes/applications.js`, `routes/notifications.js`, `middleware/auth.js`, Agent 1's migration.
**Dependencies:** Agent 1 (schema/contracts); benefits from Agents 2 & 3 data but tests should seed their own rows so they run independently.
**Test & Acceptance Criteria:** recommendation determinism (same signals → identical ordering & scores; assert exact tie-break); explanation strings are fact-derived from seeded signals; cold-start path returns popularity/recency ordering; recommendations exclude already-applied. Analytics ingestion rejects server-authoritative/unknown types (400) and is rate-limited. Moderation: duplicate report → 409; only admin can list/resolve (403 otherwise); resolve emits notification and sets `resolved_by`/`resolved_at`. Organizer analytics owner-guarded; divide-by-zero guarded. All green.
**Commit:** `feat(opp-hub): deterministic recommendations, analytics & moderation`. Report: scoring formula as implemented, explanation scheme, analytics whitelist, moderation RBAC.

---

### AGENT 5 — Student Frontend (Discovery, Detail, Bookmarks, Applications, Notifications)

**Scope & Deliverables** (replace Agent 1's placeholders behind existing routes; code against `src/api/opportunities.js`)
- **Discovery page** `src/pages/opportunities/Discovery.jsx`: list published opportunities with filters (category, tag, remote, search, deadline), pagination/load-more (mirror `Home.jsx` pattern), loading/empty/error states, bookmark toggle with optimistic update + rollback (mirror `Home.jsx handleToggleSave`).
- **Detail page** `src/pages/opportunities/OpportunityDetail.jsx`: full info, tags/category, org link, Apply button (with cover note), Save button, Report link. Fire `opportunity_viewed`/`recommendation_clicked` analytics via the api client. Handle apply states (already applied, deadline passed, not logged in → redirect to login).
- **My Applications** `src/pages/opportunities/MyApplications.jsx`: student's applications with status badges and a history/timeline view; withdraw action (guarded to allowed states) with confirm.
- **Saved** `src/pages/opportunities/SavedOpportunities.jsx`.
- **Recommendations widget** on Discovery: render `primary_reason` ("Why am I seeing this?") from `/api/recommendations`.
- **Notifications center** `src/pages/notifications/Notifications.jsx` + a Topbar unread badge (poll `GET /api/notifications?unread=1` ~60s); mark-read / mark-all-read; preferences toggle UI (`GET/PUT /api/notifications/preferences`).
- **Components** `src/components/opportunities/` (student): `OpportunityCard`, `OpportunityFilters`, `ApplicationStatusBadge`, `RecommendationReason`, colocated CSS.

**Files Likely Touched:** the above under `src/pages/opportunities`, `src/pages/notifications`, `src/components/opportunities`, colocated `css/`, component tests in `__tests__`.
**Files Explicitly Forbidden:** `src/App.jsx`, `src/api/opportunities.js` (consume, don't rewrite; if an endpoint helper is missing, flag to Agent 1 rather than editing), `src/context/AuthContext.jsx`, any organizer/admin pages, backend files.
**Dependencies:** Agent 1 (routes/api stubs) to start; Agents 2/3/4 merged for live data & acceptance.
**Test & Acceptance Criteria:** Vitest + Testing Library component tests: Discovery renders list from mocked fetch, applies filters, paginates; bookmark optimistic toggle rolls back on failure; Detail apply flow disables when already applied / not logged in; MyApplications renders statuses and withdraw only for allowed states; Notifications badge reflects unread count. `npm --prefix frontend test` and `run build` and `run lint` pass.
**Commit:** `feat(opp-hub): student opportunity discovery & applications UI`. Report: pages/components added, api endpoints consumed, states handled.

---

### AGENT 6 — Organizer & Admin Frontend + E2E Polish

**Scope & Deliverables** (replace placeholders; code against `src/api/opportunities.js`)
- **Organizer: Manage Opportunities** `src/pages/organizer/opps/ManageOpportunities.jsx`: list owned opportunities (all statuses), create/edit form (draft), submit/close/archive actions, validation mirroring backend.
- **Organizer: Applicants** `src/pages/organizer/opps/OpportunityApplicants.jsx`: applicant list per opportunity, view cover notes + history, perform transitions (review/accept/reject) with confirm + optimistic status update.
- **Organizer: Analytics** `src/pages/organizer/analytics/OpportunityAnalytics.jsx`: funnel/conversion/timeseries from `/api/organizer/opportunities/:id/analytics` and summary. Render with simple accessible charts (no heavy libs; SVG/CSS bars) consistent with the app.
- **Admin: Moderation** `src/pages/admin/moderation/ModerationQueue.jsx`: report queue (filter by status), open a report, resolve/dismiss with note, optional archive of the reported opportunity. Uses existing `AdminLayout`.
- **Admin: Overview** optional platform analytics view from `/api/admin/analytics/overview`.
- **Components** `src/components/organizer/opps/*`, `src/components/admin/moderation/*`, status badges reused from Agent 5's components where shared (import, don't duplicate).
- **E2E polish:** consistent empty/loading/error states, notification consistency across roles, keyboard/focus accessibility on new interactive controls, and a short `docs/opportunity-hub.md` describing the feature + API surface.

**Files Likely Touched:** the above under `src/pages/organizer`, `src/pages/admin`, `src/components/organizer`, `src/components/admin`, colocated CSS, `docs/opportunity-hub.md`, tests.
**Files Explicitly Forbidden:** `src/App.jsx`, `src/api/opportunities.js`, `src/context/*`, student-only pages owned by Agent 5 (may import shared components read-only), backend files.
**Dependencies:** Agent 1 (routes/api); Agents 2/3/4 merged for live data; coordinates shared components with Agent 5 (import, no duplication).
**Test & Acceptance Criteria:** Vitest tests: ManageOpportunities renders owned list and gates edit to draft; Applicants transition buttons only show valid transitions and call the correct endpoint; Analytics renders funnel numbers from mocked data with divide-by-zero safe ratios; ModerationQueue lists reports and resolve updates status. `npm --prefix frontend test`, `run build`, `run lint` pass. Manual E2E: organizer creates→submits→(admin/publish)→student applies→organizer reviews/accepts→student sees notification & status.
**Commit:** `feat(opp-hub): organizer & admin management, moderation & analytics UI`. Report: pages/components, endpoints consumed, E2E flow verified, docs added.

---

### REVIEW AGENT 1 — Backend Deep Dive (Security, IDOR, Races, Constraints)

**Do not write feature code.** Audit the merged backend (Agents 1–4) on `dev`. Produce findings ranked by severity (Critical/High/Medium/Low) with `file:line`, a concrete failure scenario, and a suggested fix. Verify, don't assume.

**Checklist:**
1. **Auth/session:** `requireAuth`/`requireRole` correct and applied to every mutating route; no route relies on client-supplied role/ids for authorization; `req.session.user` shape consistent; no JWT residue in the request path.
2. **RBAC leaks / IDOR:** every organizer read/write is ownership-guarded via `organizer_profile` join (not a body `organization_id`); students can only access their own applications/history/bookmarks/notifications; admins-only routes reject non-admins; consistent 403 (wrong role) vs 404 (not visible) policy — no existence enumeration.
3. **State machine integrity:** transitions match §3.2 exactly; invalid/terminal transitions → 409; every transition writes history + notification + analytics **inside one transaction**; rollback path leaves no partial writes.
4. **Race conditions / TOCTOU:** apply (duplicate under concurrency → unique constraint + 409, not crash); capacity/positions checks not check-then-insert without guard; status transitions use optimistic `WHERE id=? AND status=?`; report uniqueness enforced at DB level.
5. **Transactions:** all multi-write operations use `pool.connect()`+BEGIN/COMMIT/ROLLBACK/`release()` with `release()` in `finally`; no connection leaks; notifications/analytics that must be atomic pass the `client`.
6. **DB constraints:** FKs + indexes + unique constraints present as speced; `opportunity_status_history` immutability trigger actually blocks UPDATE/DELETE; migration `down()` fully reverses (including trigger/function).
7. **Injection & input:** all queries parameterized (`$n`); enum/length validation on writes; `"user"` quoted; analytics ingestion rejects server-authoritative/unknown event types; rate limits on apply/report/analytics.
8. **Recommendations:** deterministic, bounded (no N+1), excludes applied/expired, cold-start safe, explanations fact-derived (no fabricated content), **no external calls**.
9. **Error handling/logging:** no stack-trace leaks (global handler intact); no PII in logs/analytics beyond FKs.
10. **Tests:** target `studenthub_test`; clean up their data; cover the negative/authz/race paths, not just happy path.

**Deliverable:** a review report (findings list + a go/no-go). Re-run `npm --prefix backend test` and report result. Single commit only if applying agreed fixes: `fix(opp-hub): backend review remediations`.

---

### REVIEW AGENT 2 — Final Integration (E2E, Frontend/Backend, UX, Build)

**Do not write feature code** (except tiny agreed integration fixes). Audit the full stack (Agents 1–6) on `dev`.

**Checklist:**
1. **Contract alignment:** `src/api/opportunities.js` endpoints/params match the backend routes exactly (paths, query params, response shapes `{items,page,limit,total}`); no drift.
2. **E2E flows (manual + tests):** organizer create→submit→publish/approve→student discover→apply→organizer review→accept/reject→student notification & status update→withdraw path; moderation report→admin resolve→reporter notification; recommendations reflect real signals.
3. **AuthZ at the edges:** UI guards (`RoleRoute`/`ProtectedRoute`) present but never the only defense; unauthenticated deep-links redirect to login; role-inappropriate pages redirect.
4. **Notifications:** unread badge polls and updates; mark-read/read-all works; preferences suppress the right categories end-to-end.
5. **UX consistency:** loading/empty/error states on every new page; optimistic updates roll back on failure; status badges consistent across student/organizer/admin; accessibility (labels, focus, keyboard) on new controls.
6. **Analytics/observability:** client events fire on view/rec-click; organizer analytics numbers reconcile with underlying data.
7. **Build/lint/tests:** `npm --prefix backend test`, `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` all green; no console errors in dev run.
8. **Docs:** `docs/opportunity-hub.md` accurate; README/API updated if needed; no secrets committed; `.env.example` updated if any new (there should be none).
9. **Migrations on a clean DB:** fresh `knex migrate:latest` + seed produces a working app; rollback clean.
10. **Regression:** existing event/auth/registration flows still pass.

**Deliverable:** integration report (findings + go/no-go for merge to `main`). Report all four suite results. Single commit only for agreed fixes: `fix(opp-hub): integration remediations`.

---

## 8. Acceptance Definition (feature done)
- Working tree diagnostics resolved (auth boots, swagger reverted).
- All 10 tables live via one reversible migration; history immutable; seeds idempotent.
- Discovery, application state machine (with audit + notifications), deterministic recommendations, analytics, and moderation all implemented server-side with strict RBAC/ownership and passing Jest suites against `studenthub_test`.
- Student and organizer/admin UIs complete, guarded, and passing Vitest + build + lint.
- Both review agents return go, existing suites still green, feature documented.
- Everything merged to `dev` via real merge commits; nothing pushed to `original`.
