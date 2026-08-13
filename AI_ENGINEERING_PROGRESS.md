# AI Engineering Progress

## Wave 1 - Observability & Production

### WP-PROD-01
- Implemented request correlation in `backend/middleware/requestId.js` and wired it into `backend/app.js` before routes.
- Added liveness/readiness split:
  - `GET /api/health` returns process liveness metadata
  - `GET /api/ready` performs a database check and returns `503` when the DB is unreachable
- Replaced inline error responses with centralized error middleware in `backend/middleware/errorHandler.js`.
- `catchAsync` now forwards rejected promises to Express error middleware instead of ending the response itself.
- `backend/bootstrap.js` now owns startup, shutdown, and fatal process hooks.

### WP-PROD-03
- Added strict production validation in `backend/config/runtime.js`.
- Production boot now requires:
  - `SESSION_SECRET`
  - `FRONTEND_URL`
  - `PORT`
  - `TRUST_PROXY=true`
  - Postgres database settings
- Development and test imports remain permissive.
- `mysql2` was removed from the backend dependency graph; the backend is now Postgres-only in runtime config and boot paths.

### WP-PROD-02
- Added `docker-compose.prod.yml` with:
  - Postgres service
  - backend readiness healthcheck
  - persistent volume
  - production env defaults
  - migrations on startup, no automatic seeds
- Kept the dev `docker-compose.yml` workflow intact with migrations + seeds enabled.
- Updated `backend/docker-start.sh` so startup behavior is controlled by env flags instead of always seeding.
- Corrected the GitHub Actions Postgres test service env/healthcheck mismatch.

### WP-PROD-04
- Added `docs/production-runbook.md` covering deploy, health, logs, DB operations, failure modes, and recovery.
- Linked the runbook from the root README and backend README.

## Verification Evidence

- Focused backend tests passed locally:
  - `__tests__/catchAsync.test.js`
  - `__tests__/runtime.test.js`
  - `__tests__/health.test.js`
  - Result: 3 suites, 10 tests passed
- Compose config validation passed:
  - `docker compose -f docker-compose.yml config`
  - `docker compose -f docker-compose.prod.yml config`
- Production config validation passed with explicit env:
  - `node -e "... validateProductionBootstrapConfig() ..."` returned `client: pg`, `trustProxy: true`, `port: 30011`

## Remaining Work

- Run the full backend suite with the repo’s normal Jest global setup against a live PostgreSQL service.
- Run a real `docker compose up -d --build` cycle and confirm backend startup, migrations, readiness, and shutdown in a Docker-capable environment.
- Optional cleanup: the repository still contains historical PostgreSQL migration documentation under `docs/`; it is not part of the operational path and was intentionally left intact.
