# StudentHub Slovenia Engineering Progress

## Snapshot
This snapshot reflects the repository as inspected on 2026-08-13. Claims are separated into verified, unverified, and stale.

## Verified Current State
- `frontend/src/App.jsx` mounts the legacy student, organizer, and admin pages, but not the opportunity-hub pages under `frontend/src/pages/organizer/opps/*` or `frontend/src/pages/admin/moderation/*`.
- `backend/app.js` mounts the legacy `events`, `registrations`, `organizations`, `organizer`, and `admin` routers, but not `/api/organizer/opportunities` or `/api/admin/moderation`.
- `frontend/src/pages/organizer/opps/ManageOpportunities.jsx`, `OpportunityApplicants.jsx`, and `frontend/src/pages/organizer/analytics/OpportunityAnalytics.jsx` exist and call `/api/organizer/opportunities/...`.
- `frontend/src/pages/admin/moderation/ModerationQueue.jsx` exists and calls `/api/admin/moderation/reports/...`.
- `backend/routes/applications.js` and `backend/routes/notifications.js` implement the opportunity application flow and notification preferences, but they are separate from the missing organizer/admin opportunity-hub routes.
- `backend/db.js` uses `pg.Pool`.
- `backend/knexfile.js` still defaults to `mysql2` unless `DB_CLIENT=pg` is set.
- `docker-compose.yml` contains both a legacy MySQL service and a PostgreSQL service, while the backend service points at PostgreSQL.
- `.github/workflows/test.yml` is configured for PostgreSQL.
- `README.md` now describes PostgreSQL as the active runtime and leaves MySQL only as legacy compatibility in configuration.

## Work Package Status
| Work package | Status | Evidence |
|---|---|---|
| Program docs reconstruction | Complete | `AI_ENGINEERING_PLAN.md`, `AI_ENGINEERING_PROGRESS.md`, and `AI_ENGINEERING_STATUS_BOARD.md` now exist |
| PostgreSQL migration | Code-complete, unverified in live runtime | PG pool, compose, and CI are present; legacy fallback remains in config |
| Opportunity hub backend API | Missing | No router mount for the documented `/api/organizer/opportunities` or `/api/admin/moderation` surfaces |
| Opportunity hub frontend activation | Built but inactive | Pages exist, but `App.jsx` does not route to them |
| Legacy event/admin path | Live | Existing event/admin routes and pages remain the mounted moderation path |
| Repo docs coherence | Mostly current | Historical migration notes still need contextual framing |

## Duplicated or Conflicting Implementations
- Legacy event moderation and the new moderation queue both exist, but only the legacy admin routes are mounted.
- MySQL-era and PostgreSQL-era infrastructure both exist in the repo, but only PostgreSQL is wired for the backend service and CI.
- The opportunity-hub frontend and the legacy event/admin frontend both target moderator workflows, but only the legacy flow is live.
- The new opportunity application flow in `backend/routes/applications.js` is separate from organizer opportunity management, which remains unimplemented.

## Dependencies
- Frontend opportunity-hub activation depends on backend API parity.
- Backend opportunity-hub parity depends on choosing whether to add new route modules or adapt existing ones without breaking the legacy path.
- PG infra cleanup depends on live validation, not just syntactic migration reports.
- Documentation cleanup depends on the source-of-truth route and service map staying stable.

## Unverified Items
- Whether the PG migration works in a live database environment on this machine.
- Whether any hidden or external deployment still depends on the MySQL compatibility defaults.
- Whether the opportunity hub can be safely activated without first introducing backend parity.

## Completed Since This Inspection
- Reconstructed the missing engineering plan.
- Reconstructed the missing engineering progress snapshot.
- Added a dedicated status board artifact.
- Updated the repository docs to stop presenting MySQL as the only runtime.

## Remaining Blockers
- The opportunity hub is still not production-coherent because the backend API and router surface do not match the frontend pages.
- The status of the PostgreSQL migration remains unverified in a live runtime.
- Historical docs still need contextual framing so they are not read as current implementation state.
