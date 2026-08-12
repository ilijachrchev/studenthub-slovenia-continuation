# AI Engineering Plan — StudentHub Slovenia

> Master coordination document for a multi-agent, ~1-week continuous engineering program.
> **Owner:** Agent 0 (Principal Architect / Planner). Agents update *status* here; the
> operational log lives in `AI_ENGINEERING_PROGRESS.md`.
>
> **Prime directive:** This plan is derived from an actual repository audit (branch `dev`,
> commit `fdf81aa`). Anything not verified is marked **UNKNOWN** with a verification step.
> Do not invent repository facts. If a work package's evidence no longer matches the code,
> stop and re-verify before implementing.

---

## 0. How to read this document

- Section **A** = architecture assessment. **B** = what already exists (do NOT rebuild it).
- Section **C** = risk register. **D** = agent ownership matrix. **E** = work packages.
- Section **F–I** = dependency graph, branch/commit/review strategy.
- Section **J** = waves (execution order). **K** = quality gates. **L** = phone operating guide.
- Per-agent task queues live in `AI_ENGINEERING_PROGRESS.md` under each agent's heading.

---

## A. Current architecture assessment

**Stack (verified):**
- **Backend:** Node.js, Express **5.2**, `pg` Pool (raw SQL, parameterized), `express-session`
  (default **MemoryStore**), `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `pino`/`pino-http`.
  Knex is used **only** for migrations/seeds (`knexfile.js`), not for query building.
- **Frontend:** React **19**, Vite **8**, `react-router-dom` **7**, plain `fetch`, Context-based auth.
  Testing via Vitest + Testing Library. ESLint configured (`frontend/eslint.config.js`).
- **DB:** PostgreSQL 16 (migrated off MySQL — see `docs/postgresql-migration-*.md`).
  `docker-compose.yml` still starts a legacy **mysql** service alongside `db-pg` (dead weight).
- **CI:** `.github/workflows/test.yml` — backend tests against a Postgres 16 service on port 5433,
  runs migrations + seeds, then Jest; frontend job only runs `vite build` (no tests, no lint).
- **Runtime layout:** `backend/app.js` builds the Express app; `backend/server.js` boots it and
  wires graceful shutdown + startup DB check. Frontend build is served statically if `backend/dist` exists.

**Architectural shape:** Classic layered monolith. Routes contain business logic + SQL inline.
A thin `lib/opportunity/` layer (status machine + notifications emitter) is the only real service layer.
Transactions are used correctly in several mutating routes (`applications.js`, `student.js`,
`organizer.js` events, `admin.js` reject) with `pool.connect()` + `BEGIN/COMMIT/ROLLBACK`;
the application transition path even uses `SELECT ... FOR UPDATE` + guarded `UPDATE ... WHERE status = from`.

**THE HEADLINE FINDING — "Opportunity Hub" is disconnected scaffolding.**
A large feature set was merged into `dev` (commits `4903f9a`, `e3acb84`, `68f66d0`) but was never
wired end to end:
1. `backend/routes/applications.js` and `backend/routes/notifications.js` **exist but are NOT mounted**
   in `app.js` (verified: `app.js` mounts only auth, lookups, student, events, registrations,
   organizations, organizer, admin, bookmarks, feedback, search). Confirmed also on
   `feat/app-state-machine-history` — the wiring was never present, not lost in a merge.
2. The frontend opp-hub pages (`pages/opportunities/*`, `pages/notifications/*`,
   `pages/organizer/opps/*`, `pages/organizer/analytics/*`, `pages/admin/moderation/*`) **exist but are
   NOT registered in `App.jsx`** (verified: `App.jsx` imports none of them).
3. The frontend calls ~20 endpoints that **have no backend route AND no schema**, including
   `/api/opportunities*`, `/api/recommendations`, `/api/organizer/opportunities*`,
   `/api/organizer/opportunities/:id/analytics`, `/api/admin/moderation/reports*`,
   `/api/opportunities/:id/bookmark`, `/api/opportunities/saved`.
4. DB migration `..._add_opportunity_applications_notifications.js` created `opportunity`, `application`,
   `application_history`, `notification`, `notification_preferences`. There is **NO** table for
   moderation reports, analytics events, or opportunity bookmarks.

Net: the state machine, notifications emitter, applications router, notifications router, and the
opportunity/application/notification tables are real and usable; **everything that connects them into
a working product (routing, mounting, discovery, organizer CRUD, recommendations, analytics,
moderation, opportunity bookmarks) is missing.** This dominates the roadmap.

---

## B. Existing functionality map (DO NOT REBUILD)

**Working & wired (leave alone unless a WP says otherwise):**
- Auth: register (student email-domain check against `faculty.email_domain`), login, `/me`, logout,
  reset-password. Session regenerated on login/register (fixation defense), cookie cleared on
  logout/reset. Rate limiter (20 / 15 min) on all auth routes. `auth.test.js` (15 tests).
- AuthZ middleware: `requireAuth`, `requireRole(role)` (single role). `authorization.test.js` (15 tests).
- CSRF: `validateOrigin` middleware — rejects state-changing requests with bad/missing Origin+Referer
  (bypassed in `test` and for GET/HEAD/OPTIONS).
- Events: public list with tag hydration + logged-in personalization scoring (faculty/tag match),
  detail. `events.test.js` (13 tests).
- Registrations, bookmarks (events only), feedback, organizations, lookups (faculties/tags), search.
- Organizer: list own events, create event (tx + tags + target faculties), submit for approval.
- Admin: pending events/orgs, approve/reject (reject writes `event_rejection` in a tx).
- Error handling: global Express error handler (no stack leak); `catchAsync` wrapper.
- Logging: `pino-http` request logging + auth event logs.
- Server lifecycle: startup DB verify, graceful shutdown with 10s force-exit timeout.
- Validation lib: registration, password change, organization, event, feedback.
- DB: 3 migrations (initial schema, query indexes, opportunity/application/notification).
  Idempotent, PG-compatible. Seeds in `db/seeds/01_development.js`. Helper scripts
  `db:verify/reset/status`.
- Frontend: student/organizer/admin layouts, `ProtectedRoute`, `RoleRoute` (both tested),
  home/events/search/settings/saved/feedback/registrations pages.

**Built but DISCONNECTED (integrate, do not duplicate):**
- `routes/applications.js` — apply / mine / list-for-opportunity / transition / history (unmounted).
- `routes/notifications.js` — list / read / read-all / preferences (unmounted).
- `lib/opportunity/statusMachine.js` — role-aware application status transitions + aliases.
- `lib/opportunity/notifications.js` — `emit()` with per-user preference gating.
- Frontend opp-hub pages/components (unrouted): `Discovery`, `OpportunityDetail`, `MyApplications`,
  `SavedOpportunities`, `Notifications`, `ManageOpportunities`, `OpportunityApplicants`,
  `OpportunityAnalytics`, `ModerationQueue`, plus `components/opportunities/*`,
  `components/organizer/opps/*`, `components/admin/moderation/*`, `components/shared/StatusBadge.jsx`.
- `docs/opportunity-hub.md` — the intended API contract (authoritative reference for WPs).

---

## C. Risk register

| ID | Category | Risk | Evidence | Severity |
|----|----------|------|----------|----------|
| R-01 | Integration | Opp-hub non-functional: routers unmounted, pages unrouted, endpoints/schemas missing | §A findings 1–4 | **Critical** |
| R-02 | Reliability | `express-session` uses in-memory MemoryStore → sessions lost on restart, leaks memory, breaks multi-instance | `app.js` session config (no store) | High |
| R-03 | Security | Rate limiting only on auth; apply/transition/feedback/write endpoints unthrottled | grep: only `auth.js` uses `rateLimit` | High |
| R-04 | Security | Single-role `requireRole`; no "admin OR organizer" path; some ownership checks ad hoc | `middleware/auth.js`; `applications.js` transition | Medium |
| R-05 | Data integrity | No CHECK constraints (status enums, `deadline>created_at`, positive capacity, rating range); statuses are free strings | migration 001/003 schema | Medium |
| R-06 | Data integrity | `opportunity` has no `updated_at`; `application.updated_at` not auto-maintained by trigger (set in app code only) | migration 003 | Medium |
| R-07 | Data integrity | Missing `ON DELETE` policy on several FKs (`opportunity.organization_id`, `application.opportunity_id`) | migration 003 | Medium |
| R-08 | Correctness | `application_history` on apply is written but the apply/list endpoints aren't reachable; contract path mismatch (`/api/opportunities/:id/apply` vs router's `/:id/apply` unmounted) | `applications.js`, frontend endpoints | High |
| R-09 | Correctness | Opportunity owner lookup assumes exactly one `role_in_org='owner'`; multi-owner orgs pick lowest user_id | `applications.js getOpportunityOwner` | Low |
| R-10 | Observability | No request-id correlation, no error tracking, health check is liveness-only (no readiness/migration state) | `app.js /api/health` | Medium |
| R-11 | CI/CD | Frontend job has no tests/lint; backend has no lint; no migration up/down validation; no coverage gate | `test.yml`, no backend lint script | Medium |
| R-12 | Config | `docker-compose.yml` still runs legacy MySQL; secrets are inline dev defaults; no boot-time env validation beyond `SESSION_SECRET` | `docker-compose.yml`, `app.js` | Medium |
| R-13 | UX | Opp-hub pages' loading/empty/error quality UNKNOWN (not individually audited); notifications badge polling reliability UNKNOWN | not audited | Medium |
| R-14 | Accessibility | `docs/opportunity-hub.md` claims a11y but it is unverified across pages | not audited | Medium |
| R-15 | Perf | `events.js` sorts/paginates in JS after loading all published events; N+1 avoided but full scan grows unbounded | `events.js` GET `/` | Low→Med |
| R-16 | Backup/DR | No documented backup/restore or migration-rollback runbook | repo has none | Medium |
| R-17 | Security | `helmet` CSP disabled (`contentSecurityPolicy:false`) | `app.js` | Low |

**Missing production capabilities:** persistent session store, readiness probe, config validation,
recommendations engine, analytics capture, moderation workflow, opportunity discovery API,
observability correlation, backup/restore runbook, frontend test coverage in CI.

**Missing tests:** opportunity lifecycle, applications apply/transition (incl. race), notifications,
recommendations, moderation, analytics, and all opp-hub frontend routes/pages.

---

## D. Agent ownership matrix

> **Golden rule:** an agent edits only files in its **Owns** set. Files in **Forbidden** require a
> coordination note in `AI_ENGINEERING_PROGRESS.md` and sign-off from the owning agent (or Agent 1).
> `backend/app.js` is a **shared coordination file**: only **Agent 5** edits it; other agents that need a
> router mounted request it via a `MOUNT-REQUEST` note in the progress log.

| Agent | Role / Domain | Branch | Owns | Forbidden (coordinate) | Work packages | Reviewer |
|------|----------------|--------|------|------------------------|---------------|----------|
| **1** | Integration & Architecture Reviewer | — (reviews all) | `AI_ENGINEERING_PLAN.md` status cells | writing feature code | reviews merges | — |
| **2** | Security & Quality Reviewer | — (reviews all) | security notes | writing feature code | reviews merges | — |
| **3** | Database & Data Integrity | `feature/ai-db-integrity` | `backend/db/**`, `backend/knexfile.js` | route files, `app.js` | WP-DB-01..05 | 1 |
| **4** | Opportunity Lifecycle Backend | `feature/ai-opportunity-lifecycle` | `backend/routes/opportunities.js` (new), `backend/routes/applications.js`, `backend/lib/opportunity/**` | `app.js`, `organizer.js`, migrations | WP-OPP-01..05 | 1,2 |
| **5** | Backend Reliability & Security | `feature/ai-backend-hardening` | `backend/app.js`, `backend/middleware/**`, `backend/server.js` | route business logic | WP-SEC-01..05 | 2 |
| **6** | Discovery Intelligence (recs/analytics/notifs) | `feature/ai-discovery-intel` | `backend/routes/recommendations.js` (new), `backend/routes/notifications.js`, `backend/routes/analytics.js` (new), `backend/lib/opportunity/notifications.js` | `app.js`, migrations, `opportunities.js` | WP-REC-01..02, WP-NOTIF-01 | 1,2 |
| **7** | Moderation & Admin | `feature/ai-moderation-admin` | `backend/routes/moderation.js` (new), `backend/routes/admin.js` | `app.js`, migrations | WP-MOD-01..03 | 1,2 |
| **8** | Frontend Architecture & Routing | `feature/ai-frontend-architecture` | `frontend/src/App.jsx`, `frontend/src/api/**` (new), `frontend/src/context/**` | page internals owned by Agent 9 | WP-FE-01..03 | 1 |
| **9** | Frontend UX & Accessibility | `feature/ai-frontend-ux` | `frontend/src/pages/**`, `frontend/src/components/**` | `App.jsx`, `api/**` | WP-UX-01..03 | 1,2 |
| **10** | Testing & CI/CD | `feature/ai-testing-ci` | `backend/__tests__/**`, `frontend/src/__tests__/**`, `.github/workflows/**`, lint configs | product source (read-only) | WP-TEST-01..04 | 1,2 |
| **11** | Observability & Production | `feature/ai-production-hardening` | `Dockerfile`, `docker-compose.yml`, `backend/Dockerfile`, `backend/config/**`, `docs/runbook*.md`, `.env.example` | route logic | WP-PROD-01..04 | 1,2 |

> **Agents 8 & 9 both touch frontend.** Boundary: Agent 8 owns *routing, the API client, and auth
> context*; Agent 9 owns *page/component internals*. If Agent 9 needs a new route, it files a note and
> Agent 8 adds it. They should generally run in different waves (see §J).

---

## E. Work packages

> Each WP: **Objective · Why · Evidence · Files · DB · API · FE · Security · Tests · Deps ·
> Conflicts · Size · Acceptance · Verify · Branch**. Size = realistic AI-agent focused time.
> Every WP ends with the branch buildable and (where a test target exists) tested.

### Agent 3 — Database & Data Integrity (`feature/ai-db-integrity`)

**WP-DB-01 — Opportunity schema completion (updated_at, FKs, indexes)**
- **Objective:** Add `opportunity.updated_at` (+ auto-update trigger), define `ON DELETE` behavior for
  `opportunity`/`application` FKs, and confirm/repair indexes. Provide a trigger to maintain
  `application.updated_at` at the DB level.
- **Why:** R-06, R-07 — integrity currently depends on app code only.
- **Evidence:** `20260715000003_...js` (no `updated_at` on opportunity; no triggers; FKs lack `onDelete`).
- **Files:** new migration `db/migrations/2026..._opportunity_integrity.js`.
- **DB:** ALTER `opportunity`; CREATE trigger fn `set_updated_at`; indexes as needed.
- **API/FE:** none. **Security:** none.
- **Tests:** extend `migration.test.js` (up/down idempotent; trigger updates timestamp).
- **Deps:** none (foundational). **Conflicts:** other agents must not add opportunity columns.
- **Size:** M (60–90m). **Acceptance:** migrate up+down clean twice; trigger verified; `db:verify` passes.
- **Verify:** `cd backend && npm run db:migrate && npm run db:rollback && npm run db:migrate && npx jest migration`.
- **Branch:** `feature/ai-db-integrity`.

**WP-DB-02 — Schema for moderation, analytics, opportunity bookmarks**
- **Objective:** Create tables the opp-hub frontend needs: `opportunity_report` (moderation),
  `opportunity_event` (analytics: view/visit/etc.), `opportunity_bookmark`.
- **Why:** R-01 — frontend calls `/api/admin/moderation/reports*`, analytics, `/opportunities/:id/bookmark`,
  `/opportunities/saved` with **no** backing tables.
- **Evidence:** frontend endpoint grep; migration set has none of these tables.
- **Files:** new migration `2026..._moderation_analytics_bookmarks.js`.
- **DB:** 3 tables + indexes + FKs + `ON DELETE CASCADE` where correct.
- **API/FE:** unblocks Agents 6 & 7. **Security:** report table stores reporter id (privacy note).
- **Tests:** `migration.test.js` additions.
- **Deps:** WP-DB-01 merged (ordering). **Conflicts:** Agents 6/7 must consume, not define, these tables.
- **Size:** M (60–90m). **Acceptance:** tables exist post-migrate; FKs enforced; down() drops cleanly.
- **Verify:** migrate up/down; `npm run db:status`.
- **Branch:** `feature/ai-db-integrity`.

**WP-DB-03 — Integrity CHECK constraints & enum discipline**
- **Objective:** Add CHECK constraints: opportunity/application/report status ∈ allowed sets,
  `deadline > created_at`, `capacity > 0` when set, `feedback.rating BETWEEN 1 AND 5`.
- **Why:** R-05. **Evidence:** free-string statuses in migrations 001/003.
- **Files:** new migration. **DB:** ALTER ADD CONSTRAINT (guarded/idempotent).
- **Tests:** insert violating rows → expect failure (integration test in Agent 10 scope; ship a smoke test here).
- **Deps:** WP-DB-01/02. **Conflicts:** status value list must match `statusMachine.js` (coordinate w/ Agent 4).
- **Size:** M (45–75m). **Acceptance:** violating inserts rejected; valid seed still loads.
- **Verify:** migrate; run seed; `npm run db:seed` succeeds; ad hoc violating insert fails.
- **Branch:** `feature/ai-db-integrity`.

**WP-DB-04 — Dev/test seed data for opp-hub**
- **Objective:** Seed opportunities (multiple statuses), applications, history, notifications, reports,
  analytics events so local dev and integration tests have realistic fixtures.
- **Why:** enables Agents 4/6/7/9/10 to develop & test against real data.
- **Evidence:** `db/seeds/01_development.js` has no opp-hub rows.
- **Files:** `db/seeds/02_opportunity_hub.js` (new). **DB:** inserts only.
- **Tests:** seed runs idempotently in CI. **Deps:** WP-DB-01/02/03.
- **Conflicts:** none. **Size:** M (45–75m).
- **Acceptance:** `npm run db:seed` idempotent; counts asserted. **Verify:** `npm run db:seed && npm run db:status`.
- **Branch:** `feature/ai-db-integrity`.

**WP-DB-05 — Backup/recovery & migration-safety documentation**
- **Objective:** Document backup/restore (pg_dump/pg_restore), migration rollback policy, and a
  destructive-migration checklist; extend `db/verify.js` to report migration state + row counts.
- **Why:** R-16. **Evidence:** no DR docs.
- **Files:** `docs/db-operations.md`, `backend/db/verify.js`. **DB:** read-only.
- **Tests:** `db:verify` exits 0 on healthy DB. **Deps:** none.
- **Size:** S–M (45–60m). **Acceptance:** doc reviewed; verify script enriched.
- **Verify:** `npm run db:verify`. **Branch:** `feature/ai-db-integrity`.

### Agent 4 — Opportunity Lifecycle Backend (`feature/ai-opportunity-lifecycle`)

**WP-OPP-01 — Student discovery API (`routes/opportunities.js`)**
- **Objective:** New router: `GET /api/opportunities` (published, deadline in future, filters + pagination),
  `GET /api/opportunities/:id`, `GET /api/opportunities/:id/related`.
- **Why:** R-01 — `Discovery.jsx`/`OpportunityDetail.jsx` call these; none exist.
- **Evidence:** frontend endpoints; no route references `opportunity` except `applications.js`.
- **Files:** `backend/routes/opportunities.js` (new). **DB:** reads only.
- **API:** contract per `docs/opportunity-hub.md` + frontend usage. **FE:** unblocks discovery pages.
- **Security:** public list only exposes published; no draft leakage. **MOUNT-REQUEST** to Agent 5.
- **Tests:** integration (Agent 10) — filters, pagination, 404 on unpublished.
- **Deps:** DB tables exist (already do for opportunity). **Conflicts:** shares router file namespace w/ WP-OPP-02/03.
- **Size:** L (90–120m). **Acceptance:** endpoints return documented shapes; no draft leakage.
- **Verify:** `npx jest opportunities` (after Agent 10 tests) / manual curl.
- **Branch:** `feature/ai-opportunity-lifecycle`.

**WP-OPP-02 — Opportunity bookmarks (saved)**
- **Objective:** `POST/DELETE /api/opportunities/:id/bookmark`, `GET /api/opportunities/saved`,
  `GET /api/opportunities/saved/ids`.
- **Why:** R-01 — `SavedOpportunities.jsx` calls these; no table/route.
- **Evidence:** frontend endpoints. **Files:** `routes/opportunities.js`.
- **DB:** consumes `opportunity_bookmark` (WP-DB-02). **Security:** student-owned rows only.
- **Tests:** integration. **Deps:** **WP-DB-02 merged.** **Conflicts:** same file as OPP-01.
- **Size:** M (60–90m). **Acceptance:** idempotent bookmark; saved list scoped to user.
- **Verify:** integration tests. **Branch:** `feature/ai-opportunity-lifecycle`.

**WP-OPP-03 — Applications: reconcile paths + mount + apply/list/history**
- **Objective:** Align `applications.js` to the documented contract (`POST /api/opportunities/:id/apply`,
  `GET /api/opportunities/applications`) — either by re-basing the existing router paths or exposing them
  under `/api/opportunities`. Keep the existing transaction + `application_history` logic.
- **Why:** R-08 — router exists but paths/mount don't match frontend.
- **Evidence:** `applications.js` uses `/:id/apply`, `/mine`; frontend calls `/api/opportunities/:id/apply`,
  `/api/opportunities/applications`.
- **Files:** `routes/applications.js` (+ MOUNT-REQUEST to Agent 5). **DB:** existing tables.
- **Security:** preserve `requireRole("student")`, duplicate-apply 409, ownership checks.
- **Tests:** integration incl. duplicate apply, closed/expired opportunity. **Deps:** OPP-01 path decisions.
- **Conflicts:** Agent 5 owns the actual `app.use(...)` line. **Size:** M (60–90m).
- **Acceptance:** documented paths work; history row written; notification emitted.
- **Verify:** `npx jest applications`. **Branch:** `feature/ai-opportunity-lifecycle`.

**WP-OPP-04 — Organizer opportunity CRUD + lifecycle**
- **Objective:** `GET/POST /api/organizer/opportunities`, `PATCH /api/organizer/opportunities/:id`,
  `POST .../:id/submit|publish|close|archive`, `GET .../:id/applicants`,
  `POST .../:id/applicants/:applicantId/transition`.
- **Why:** R-01 — `ManageOpportunities.jsx`/`OpportunityApplicants.jsx` call these; none exist.
- **Evidence:** frontend endpoints + `docs/opportunity-hub.md`.
- **Files:** **coordinate with Agent 7 & 5** — implement in a dedicated router
  `routes/opportunities.js` (organizer sub-paths) OR extend `organizer.js` (owned by Agent 4 per matrix? — NO,
  `organizer.js` is not in Agent 4's Owns set). **Decision:** put organizer-opportunity endpoints in
  `routes/opportunities.js` mounted under `/api/organizer/opportunities` to keep Agent 4 within its owned
  files. **DB:** writes to `opportunity`, `application`, `application_history`.
- **Security:** owner-only via `organizer_profile`; ownership helper (reuse `getOpportunityOwner`).
  Applicant transitions delegate to the status machine.
- **Tests:** integration — non-owner 404, invalid transition 400, concurrent transition 409.
- **Deps:** WP-OPP-05 (opportunity status machine), WP-DB-01. **Conflicts:** applicant transition overlaps
  application transition logic — reuse, don't duplicate. **Size:** L (110–120m).
- **Acceptance:** full organizer flow per contract; ownership enforced.
- **Verify:** integration suite. **Branch:** `feature/ai-opportunity-lifecycle`.

**WP-OPP-05 — Opportunity status machine + concurrency**
- **Objective:** Add `lib/opportunity/opportunityStatus.js` (draft→published→closed→archived, role-gated),
  mirroring `statusMachine.js`; apply `SELECT ... FOR UPDATE` + guarded update on organizer lifecycle
  transitions.
- **Why:** consistency + race safety (parallels existing application machine).
- **Evidence:** `statusMachine.js` covers applications only; opportunity status is a free string.
- **Files:** `lib/opportunity/opportunityStatus.js` (new). **DB:** none (logic).
- **Tests:** unit tests for allowed/blocked transitions. **Deps:** none. **Conflicts:** value list must match
  WP-DB-03 CHECK constraint. **Size:** M (60–90m).
- **Acceptance:** invalid transitions throw typed errors; unit tests green.
- **Verify:** `npx jest opportunityStatus`. **Branch:** `feature/ai-opportunity-lifecycle`.

### Agent 5 — Backend Reliability & Security (`feature/ai-backend-hardening`)

**WP-SEC-01 — Router mounting & API registration audit**
- **Objective:** Mount `applications`, `notifications`, `opportunities`, `recommendations`, `analytics`,
  `moderation` routers in `app.js` as other agents deliver them (driven by MOUNT-REQUEST notes). Produce
  `docs/api-index.md` listing every route + auth requirement.
- **Why:** R-01/R-08. **Evidence:** `app.js` mounts 11 routers, missing all opp-hub routers.
- **Files:** `backend/app.js`, `docs/api-index.md`. **DB:** none.
- **Security:** ensure each mounted router keeps its guards. **Tests:** health + smoke that routes resolve (404 vs 401).
- **Deps:** consumes other agents' routers (mount as they land). **Conflicts:** **sole editor of `app.js`.**
- **Size:** M (45–75m, iterative across waves). **Acceptance:** all delivered routers reachable; api-index current.
- **Verify:** `npx jest health` + curl each base path. **Branch:** `feature/ai-backend-hardening`.

**WP-SEC-02 — Rate limiting for mutations**
- **Objective:** Add a general limiter + stricter limiters on apply/transition/feedback/report/create.
- **Why:** R-03. **Evidence:** only `auth.js` uses `rateLimit`.
- **Files:** `middleware/rateLimit.js` (new) + applied in `app.js`/routers via exported limiters.
- **Security:** abuse prevention. **Tests:** limiter returns 429 after threshold (integration).
- **Deps:** none. **Conflicts:** routers must import shared limiters (coordinate). **Size:** M (45–75m).
- **Acceptance:** thresholds enforced; auth limiter unchanged. **Verify:** integration test hits 429.
- **Branch:** `feature/ai-backend-hardening`.

**WP-SEC-03 — Validation for opportunity/application payloads**
- **Objective:** Extend `middleware/validate.js` with `validateOpportunity`, `validateApplication`,
  `validateReport`, `validateTransition` (lengths, required fields, date ordering, enum membership).
- **Why:** consistency with existing validators; prevent malformed writes.
- **Evidence:** `validate.js` covers only registration/org/event/feedback.
- **Files:** `middleware/validate.js`. **Tests:** extend `validate.test.js`. **Deps:** none.
- **Conflicts:** Agents 4/6/7 must call these (coordinate signatures). **Size:** M (60–90m).
- **Acceptance:** new validators unit-tested; routers use them. **Verify:** `npx jest validate`.
- **Branch:** `feature/ai-backend-hardening`.

**WP-SEC-04 — Authorization hardening (multi-role + ownership helper)**
- **Objective:** Add `requireAnyRole([...])` and a reusable ownership-assertion helper; standardize
  404-vs-403 semantics for resource access.
- **Why:** R-04. **Evidence:** `requireRole` single-role only; ownership checks duplicated in `applications.js`.
- **Files:** `middleware/auth.js` (+ `middleware/ownership.js` new). **Tests:** extend `authorization.test.js`.
- **Deps:** none. **Conflicts:** routers adopt helpers (coordinate). **Size:** M (60–90m).
- **Acceptance:** helpers tested; no behavior regression in existing authz tests.
- **Verify:** `npx jest authorization`. **Branch:** `feature/ai-backend-hardening`.

**WP-SEC-05 — Persistent session store + session/CSRF review**
- **Objective:** Replace MemoryStore with `connect-pg-simple` (Postgres-backed sessions); document CSRF
  posture; optionally add a double-submit CSRF token for defense in depth.
- **Why:** R-02, R-17. **Evidence:** `app.js` session has no `store`.
- **Files:** `app.js`, `package.json` (add dep), session migration (coordinate w/ Agent 3 for the session table).
- **DB:** session table (via connect-pg-simple). **Security:** durable sessions, multi-instance safe.
- **Tests:** login persists across simulated restart (integration). **Deps:** WP-DB tables; Agent 3 to add
  session table migration (MOUNT/DB coordination). **Conflicts:** touches `app.js` (Agent 5 owns it) + a
  migration (Agent 3 owns migrations) → **joint WP**. **Size:** L (90–120m).
- **Acceptance:** sessions survive restart; existing auth tests pass. **Verify:** integration restart test.
- **Branch:** `feature/ai-backend-hardening` (migration piece via `feature/ai-db-integrity`).

### Agent 6 — Discovery Intelligence (`feature/ai-discovery-intel`)

**WP-REC-01 — Recommendations API**
- **Objective:** `GET /api/recommendations` — published opportunities ranked by student faculty/interest
  match (reuse the scoring idea from `events.js`), with a `RecommendationReason` payload.
- **Why:** R-01 — `RecommendationReason.jsx` + Discovery expect `/api/recommendations`.
- **Evidence:** frontend endpoint; no backend recs.
- **Files:** `routes/recommendations.js` (new) + MOUNT-REQUEST. **DB:** reads.
- **Security:** requires student; only published. **Tests:** integration — ordering, reason payload.
- **Deps:** WP-OPP-01 shapes. **Conflicts:** don't duplicate discovery list (link to it). **Size:** L (90–120m).
- **Acceptance:** ranked results w/ reasons; deterministic ordering tie-breaks. **Verify:** integration tests.
- **Branch:** `feature/ai-discovery-intel`.

**WP-REC-02 — Analytics capture + organizer analytics endpoint**
- **Objective:** Record `opportunity_event` rows (view/visit) and serve
  `GET /api/organizer/opportunities/:id/analytics` returning the `{summary, funnel, timeseries}` shape in
  `docs/opportunity-hub.md`.
- **Why:** R-01 — `OpportunityAnalytics.jsx` calls this; no capture/table/endpoint.
- **Evidence:** docs contract; no analytics route/table.
- **Files:** `routes/analytics.js` (new) or organizer sub-path; consumes `opportunity_event` (WP-DB-02).
- **Security:** owner-only analytics. **Tests:** integration — funnel math, owner-only.
- **Deps:** **WP-DB-02**. **Conflicts:** owner check shared w/ Agent 4 (reuse helper). **Size:** L (90–120m).
- **Acceptance:** documented shape; counts correct against seed. **Verify:** integration tests.
- **Branch:** `feature/ai-discovery-intel`.

**WP-NOTIF-01 — Notifications mount, badge, and lifecycle integration**
- **Objective:** Get `notifications.js` mounted (MOUNT-REQUEST), add an unread-count endpoint if the UI
  needs one, and ensure `emit()` is called from every opportunity/application lifecycle transition.
- **Why:** R-01 — router exists, unmounted; badge polling depends on it.
- **Evidence:** `notifications.js` unmounted; `emit()` only wired inside `applications.js`.
- **Files:** `routes/notifications.js`, `lib/opportunity/notifications.js`. **DB:** existing tables.
- **Security:** recipient-scoped. **Tests:** integration — list/read/read-all/preferences, emit gating.
- **Deps:** WP-OPP-03/04 (emit call sites). **Conflicts:** emit call sites live in Agent 4 files (coordinate).
- **Size:** M (60–90m). **Acceptance:** notifications reachable; preferences gate delivery.
- **Verify:** `npx jest notifications`. **Branch:** `feature/ai-discovery-intel`.

### Agent 7 — Moderation & Admin (`feature/ai-moderation-admin`)

**WP-MOD-01 — Report submission**
- **Objective:** `POST /api/opportunities/:id/report` (student reports an opportunity) writing
  `opportunity_report`.
- **Why:** enables the moderation queue to have inputs.
- **Evidence:** frontend has moderation UI but no report-creation path.
- **Files:** `routes/moderation.js` (new) or `opportunities.js` sub-path (coordinate w/ Agent 4).
- **DB:** consumes `opportunity_report` (WP-DB-02). **Security:** authenticated; rate-limited (Agent 5 limiter).
- **Tests:** integration. **Deps:** **WP-DB-02**. **Conflicts:** path namespace w/ Agent 4. **Size:** M (45–75m).
- **Acceptance:** report persisted; duplicate handling defined. **Verify:** integration tests.
- **Branch:** `feature/ai-moderation-admin`.

**WP-MOD-02 — Admin moderation queue**
- **Objective:** `GET /api/admin/moderation/reports?status=`, `GET .../reports/:id`,
  `POST .../reports/:id/resolve`, `POST .../reports/:id/dismiss` (with optional `archive_opportunity`).
- **Why:** R-01 — `ModerationQueue.jsx` calls these; none exist.
- **Evidence:** docs contract; `admin.js` has no moderation code.
- **Files:** `routes/admin.js` (Agent 7 owns) or `routes/moderation.js`. **DB:** `opportunity_report`,
  and archiving updates `opportunity.status`.
- **Security:** `requireRole("admin")`; archive is a transaction. **Tests:** integration — filter, resolve,
  dismiss, archive side effect. **Deps:** WP-DB-02, WP-OPP-05 (archive transition). **Conflicts:** archive
  mutates opportunity (Agent 4 domain) → use the shared opportunity status machine. **Size:** L (90–120m).
- **Acceptance:** queue lifecycle works; archive flips opportunity + writes audit. **Verify:** integration tests.
- **Branch:** `feature/ai-moderation-admin`.

**WP-MOD-03 — Moderation & admin audit trail**
- **Objective:** Record admin moderation actions (resolve/dismiss/archive/approve/reject) to an audit table
  or `application_history`-style log; expose read for admins.
- **Why:** R-01/accountability; no admin audit today.
- **Evidence:** admin actions write only status changes (except event_rejection).
- **Files:** `routes/admin.js`/`moderation.js`; migration coordination w/ Agent 3 for `admin_audit`.
- **DB:** new `admin_audit` (Agent 3 migration). **Security:** admin-only reads. **Tests:** integration.
- **Deps:** WP-DB-02/DB migration. **Conflicts:** migration owned by Agent 3 (joint). **Size:** M (60–90m).
- **Acceptance:** actions produce audit rows; readable by admin. **Verify:** integration tests.
- **Branch:** `feature/ai-moderation-admin`.

### Agent 8 — Frontend Architecture & Routing (`feature/ai-frontend-architecture`)

**WP-FE-01 — Register opp-hub routes in `App.jsx`**
- **Objective:** Wire all disconnected pages into the router with correct layout + role guards:
  Discovery, OpportunityDetail, MyApplications, SavedOpportunities, Notifications, ManageOpportunities,
  OpportunityApplicants, OpportunityAnalytics, ModerationQueue.
- **Why:** R-01 — pages exist but are unreachable.
- **Evidence:** `App.jsx` imports none of them.
- **Files:** `frontend/src/App.jsx`. **API/DB:** none. **Security:** correct `RoleRoute` per page.
- **Tests:** route tests (Agent 10). **Deps:** ideally after backend endpoints exist (Wave 3); can stub earlier.
- **Conflicts:** sole editor of `App.jsx`. **Size:** M (45–75m).
- **Acceptance:** every page reachable behind correct guard; build passes. **Verify:** `cd frontend && npm run build`.
- **Branch:** `feature/ai-frontend-architecture`.

**WP-FE-02 — Central API client**
- **Objective:** `frontend/src/api/client.js` — `fetch` wrapper (base URL, `credentials:"include"`,
  JSON, unified error shape, 401 handling hook). Provide typed helpers per domain.
- **Why:** scattered `fetch` calls; inconsistent error/credentials handling (R-13 root cause).
- **Evidence:** many raw `/api/...` fetches across `frontend/src`.
- **Files:** `frontend/src/api/**` (new). **Tests:** unit (Agent 10). **Deps:** none.
- **Conflicts:** Agent 9 pages will migrate to it later (coordinate order). **Size:** L (90–120m).
- **Acceptance:** client covers all opp-hub endpoints; errors normalized. **Verify:** `npm run build` + unit tests.
- **Branch:** `feature/ai-frontend-architecture`.

**WP-FE-03 — Auth/session UX (global 401, role nav)**
- **Objective:** Global 401 → redirect to login + clear context; role-aware navigation entries for opp-hub;
  guard against flashing protected content pre-auth.
- **Why:** reliability of the newly-wired app.
- **Evidence:** `AuthContext.jsx` (42 lines) minimal; no global 401 handling.
- **Files:** `frontend/src/context/**`, nav components (coordinate w/ Agent 9 on shared nav). **Deps:** WP-FE-02.
- **Size:** M (60–90m). **Acceptance:** 401 handled globally; nav reflects role. **Verify:** route tests + build.
- **Branch:** `feature/ai-frontend-architecture`.

### Agent 9 — Frontend UX & Accessibility (`feature/ai-frontend-ux`)

**WP-UX-01 — Loading/empty/error state standardization**
- **Objective:** Audit each opp-hub page; add consistent loading spinners/skeletons, empty states, and
  error banners (using the API client's normalized errors).
- **Why:** R-13. **Evidence:** page quality unaudited; pages predate a shared client.
- **Files:** `frontend/src/pages/**`, `frontend/src/components/**`. **Deps:** WP-FE-02 (client), WP-FE-01 (routing).
- **Size:** L (90–120m). **Acceptance:** every opp-hub page shows all three states. **Verify:** component tests + manual.
- **Branch:** `feature/ai-frontend-ux`.

**WP-UX-02 — Accessibility pass**
- **Objective:** Verify/repair labels, roles, live regions, focus management, keyboard operability across
  opp-hub pages (validate the claims in `docs/opportunity-hub.md`).
- **Why:** R-14. **Evidence:** claims unverified.
- **Files:** opp-hub pages/components. **Deps:** WP-FE-01. **Size:** M–L (75–120m).
- **Acceptance:** keyboard-only flow works; forms labeled; alerts announced. **Verify:** manual a11y checklist + tests.
- **Branch:** `feature/ai-frontend-ux`.

**WP-UX-03 — Notifications & realtime-ish reliability**
- **Objective:** Reliable unread badge (polling/backoff), mark-read/read-all, preference toggles wired to
  the backend.
- **Why:** R-13. **Evidence:** `Topbar` unread badge lint fix in history (`95e97ff`) suggests fragility.
- **Files:** `Topbar.jsx`, `pages/notifications/*`. **Deps:** WP-NOTIF-01, WP-FE-02. **Size:** M (60–90m).
- **Acceptance:** badge accurate; no runaway polling. **Verify:** component tests + manual.
- **Branch:** `feature/ai-frontend-ux`.

### Agent 10 — Testing & CI/CD (`feature/ai-testing-ci`)

**WP-TEST-01 — Opportunity/application integration tests (incl. race)**
- **Objective:** Integration tests for discovery, apply (dup 409, expired), organizer CRUD/lifecycle,
  transition happy/blocked, and a concurrent-transition race asserting the `FOR UPDATE` guard.
- **Why:** R-08; no tests exist for these. **Files:** `backend/__tests__/integration/opportunities.test.js` etc.
- **Deps:** Agent 4 endpoints. **Size:** L (90–120m). **Acceptance:** suite green in CI.
- **Verify:** `npm test -- --runInBand`. **Branch:** `feature/ai-testing-ci`.

**WP-TEST-02 — Notifications/recommendations/moderation/analytics tests**
- **Objective:** Integration coverage for Agents 6 & 7 endpoints.
- **Deps:** Agents 6/7. **Size:** L (90–120m). **Acceptance:** green. **Verify:** `npm test`.
- **Branch:** `feature/ai-testing-ci`.

**WP-TEST-03 — Frontend route/page tests (Vitest)**
- **Objective:** Tests for opp-hub routing/guards and page loading/empty/error states + API client.
- **Deps:** Agents 8/9. **Size:** L (90–120m). **Acceptance:** `vitest run` green.
- **Verify:** `cd frontend && npm test`. **Branch:** `feature/ai-testing-ci`.

**WP-TEST-04 — CI/CD hardening**
- **Objective:** Add to CI: frontend `vitest` + `eslint`; backend ESLint (add config + script); migration
  up/down validation job; coverage thresholds; matrix on Node 20. Define failure policy (block merge).
- **Why:** R-11. **Evidence:** `test.yml` frontend job build-only; no backend lint.
- **Files:** `.github/workflows/test.yml`, `frontend` lint wiring, `backend/.eslintrc*` + script.
- **Deps:** none (can start Wave 1). **Size:** M–L (75–120m). **Acceptance:** CI runs all gates; red on failure.
- **Verify:** push branch, observe Actions. **Branch:** `feature/ai-testing-ci`.

### Agent 11 — Observability & Production (`feature/ai-production-hardening`)

**WP-PROD-01 — Observability: request IDs, readiness, error hooks**
- **Objective:** Add request-id correlation to `pino-http`, split `/api/health` (liveness) from
  `/api/ready` (DB + migration state), add an error-reporting seam (pluggable).
- **Why:** R-10. **Evidence:** `app.js` health is liveness-only; no correlation id.
- **Files:** `middleware/logger.js`, `app.js` (coordinate w/ Agent 5), `server.js`. **Deps:** none.
- **Size:** M (60–90m). **Acceptance:** logs carry req-id; readiness reflects DB. **Verify:** curl `/api/ready`.
- **Branch:** `feature/ai-production-hardening`.

**WP-PROD-02 — Docker/compose production profile**
- **Objective:** Multi-stage backend image serving the built frontend; remove/segregate legacy MySQL from
  `docker-compose.yml`; add a production compose/profile; healthchecks.
- **Why:** R-12. **Evidence:** compose runs MySQL + Postgres; backend serves `dist` only if present.
- **Files:** `Dockerfile`(root, new if needed), `backend/Dockerfile`, `docker-compose.yml`. **Deps:** none.
- **Size:** L (90–120m). **Acceptance:** `docker compose up` boots Postgres+backend+frontend; no MySQL in prod path.
- **Verify:** `docker compose config` + boot smoke. **Branch:** `feature/ai-production-hardening`.

**WP-PROD-03 — Boot-time config validation**
- **Objective:** Validate required env at startup (DB_*, SESSION_SECRET, FRONTEND_URL) and fail fast with a
  clear message; centralize config in `backend/config/env.js`.
- **Why:** R-12. **Evidence:** only `SESSION_SECRET` checked (in `app.js`).
- **Files:** `backend/config/env.js` (new), `server.js`/`app.js` (coordinate w/ Agent 5). **Deps:** none.
- **Size:** M (45–75m). **Acceptance:** missing critical env aborts boot with actionable error.
- **Verify:** unset a var → boot fails cleanly. **Branch:** `feature/ai-production-hardening`.

**WP-PROD-04 — Production readiness runbook**
- **Objective:** `docs/production-readiness.md` + `docs/runbook.md`: deploy steps, migration/rollback,
  backup/restore (links WP-DB-05), scaling notes (needs persistent sessions — WP-SEC-05), incident basics.
- **Why:** R-16. **Files:** docs. **Deps:** WP-SEC-05, WP-DB-05. **Size:** M (60–90m).
- **Acceptance:** runbook reviewed by Agent 1. **Verify:** doc review. **Branch:** `feature/ai-production-hardening`.

---

## F. Dependency graph (high level)

```
WP-DB-01 ─┬─> WP-DB-02 ─┬─> WP-DB-03 ─> WP-DB-04
          │             ├─> WP-OPP-02
          │             ├─> WP-REC-02
          │             ├─> WP-MOD-01 ─> WP-MOD-02 ─> WP-MOD-03
          │             └─> WP-SEC-05 (session table)
WP-OPP-05 ─> WP-OPP-04
WP-OPP-01 ─> WP-OPP-03, WP-REC-01
WP-SEC-01 (mounts, ongoing) <── needs routers from Agents 4/6/7
WP-SEC-02/03/04 : independent (Wave 1/4)
WP-FE-02 ─> WP-FE-03 ─> (WP-UX-01/02/03)
WP-FE-01 : needs backend endpoints live (Wave 3)
WP-TEST-04 : independent (Wave 1)
WP-TEST-01/02/03 : follow their feature agents
WP-PROD-01/02/03 : mostly independent ; WP-PROD-04 last
```

---

## G. Branch strategy

- One long-lived branch per agent (names in §D). Cut from `dev`.
- Rebase onto `dev` before opening a review; never force-push a branch another agent tracks.
- Integration target is `dev`; `main` receives `dev` only after a full-suite green + reviewer sign-off.
- `backend/app.js` and DB migrations are coordination chokepoints — respect the ownership rule.

## H. Commit strategy

- 3–8 small, coherent commits per WP. Conventional prefixes: `feat`, `fix`, `refactor`, `test`, `docs`,
  `security`, `perf`, `ci`, `chore`. One concern per commit; branch stays buildable.
- Typical WP shape: `test(...)` (or `docs(...)`) scaffold → `feat(...)` core → `feat(...)` edge cases →
  `refactor(...)` cleanup → `docs(...)` update → `test(...)` finalize.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## I. Review & merge strategy

- **Agent 1 (Integration/Architecture):** verifies ownership respected, no duplicated functionality,
  migrations ordered, `app.js` mounts correct, contracts match `docs/opportunity-hub.md`, docs updated,
  commit quality. **Agent 2 (Security/Quality):** authz/ownership, input validation, rate limiting,
  SQL safety, session/CSRF, race conditions, test adequacy, perf.
- Reviewers **run** the suite (`backend: npm test -- --runInBand`; `frontend: npm run build && npm test`),
  inspect diffs and migrations, and request fixes. No blind merges.
- **Merge order (foundational first):**
  1. `feature/ai-db-integrity` (schema first)
  2. `feature/ai-backend-hardening` (mounting, limiters, validation, authz, session store)
  3. `feature/ai-opportunity-lifecycle`
  4. `feature/ai-discovery-intel`
  5. `feature/ai-moderation-admin`
  6. `feature/ai-frontend-architecture`
  7. `feature/ai-frontend-ux`
  8. `feature/ai-testing-ci` (rebase to cover merged features)
  9. `feature/ai-production-hardening`
  Re-run CI after each merge; a red gate blocks the next merge.

## J. Execution waves

- **Wave 1 — Foundation (parallel):** DB-01/02/03 (Agent 3) · SEC-01 initial + SEC-02/03/04 (Agent 5) ·
  FE-02 (Agent 8) · TEST-04 (Agent 10) · PROD-01/03 (Agent 11).
- **Wave 2 — Core backend (parallel):** OPP-01/05 then OPP-03/04/02 (Agent 4) · REC-01/02 + NOTIF-01
  (Agent 6) · MOD-01/02/03 (Agent 7) · DB-04/05 (Agent 3) · SEC-05 (Agent 5 + Agent 3).
- **Wave 3 — Frontend & tests (parallel):** FE-01/03 (Agent 8) · UX-01/02/03 (Agent 9) ·
  TEST-01/02/03 (Agent 10).
- **Wave 4 — Production hardening & final review:** PROD-02/04 (Agent 11) · full regression · Agents 1&2
  gate `dev → main`.

## K. Quality gates (definition of "done")

A WP is **done** only when: (1) acceptance criteria met; (2) verification commands pass locally;
(3) branch builds; (4) relevant tests green; (5) docs/`AI_ENGINEERING_PROGRESS.md` updated; (6) reviewer
sign-off recorded. Gate types: unit, integration, frontend (vitest), lint (front+back), build,
migration up/down, security/authz, race-condition (where relevant), API-contract, regression, CI.
**On failure:** the agent fixes forward on its branch (new commits), notes the failure + fix in the
progress log, and does not request re-review until the gate is green. Reviewers never merge red.

## L. Architectural decisions (log)

- **AD-01:** Opportunity-hub is completed by *wiring + filling gaps*, not rebuilding; reuse existing
  `statusMachine.js`, `notifications.js`, `applications.js` rather than duplicating.
- **AD-02:** `app.js` has a single editor (Agent 5) to avoid mount-line merge conflicts; others use
  MOUNT-REQUEST notes.
- **AD-03:** All new DB objects come from Agent 3 migrations only; feature agents *consume* schema.
- **AD-04:** Frontend split: Agent 8 = routing/api/auth; Agent 9 = page/component internals.
- **AD-05:** Sessions move to Postgres store (multi-instance readiness) — required before horizontal scaling.

---

*Status board and per-agent task queues: see `AI_ENGINEERING_PROGRESS.md`.*
