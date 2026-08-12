# StudentHub Production Runbook

This runbook matches the current backend behavior:
- `/api/health` is a liveness check.
- `/api/ready` is the readiness check and returns `503` when the database is unavailable.
- Every request gets an `X-Request-ID` header, and that same ID is included in error responses and logs.
- Production boot fails fast when required configuration is invalid.

## Deploy

Use the production compose file:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Production expectations:
- `NODE_ENV=production`
- `DB_CLIENT=pg`
- `TRUST_PROXY=true`
- `SESSION_SECRET` is set
- `FRONTEND_URL` is an absolute origin
- database credentials are present
- seeds are disabled on startup

## Health checks

Check liveness:

```bash
curl http://localhost:30011/api/health
```

Check readiness:

```bash
curl http://localhost:30011/api/ready
```

Interpretation:
- `200` from `/api/health` means the process is up.
- `200` from `/api/ready` means the backend can reach the database.
- `503` from `/api/ready` means the process is running but should not receive traffic.

## Logs and correlation

Follow backend logs:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

Every response carries `X-Request-ID`. When an error happens:
- check the client response body for `requestId`
- search the backend logs for the same request ID
- use that ID to trace the request through the middleware and route logs

## Database operations

Migration status:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run db:status
```

Apply pending migrations manually if needed:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run db:migrate
```

Rollback the last migration batch only if the change is safe to revert:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run db:rollback
```

## Failure modes

### Invalid production config at boot

Symptoms:
- backend container exits immediately
- logs mention invalid production configuration

Check:
- `SESSION_SECRET`
- `FRONTEND_URL`
- `DB_CLIENT`
- `DB_HOST`
- `DB_USER`
- `DB_PASS` or `DB_PASSWORD`
- `DB_DATABASE`
- `DB_PORT`
- `TRUST_PROXY`

### Readiness returns 503

Symptoms:
- `/api/health` returns `200`
- `/api/ready` returns `503`

Meaning:
- the process is alive but cannot reach the database

Check:
- database container health
- DB credentials
- network wiring between backend and database containers

### Request-level 5xx

Symptoms:
- client receives `{ error, requestId }`
- backend logs contain `Request failed`

Action:
- capture the `requestId`
- inspect the backend log line with the same ID
- confirm whether the failure came from a route, middleware, or database query

### Graceful shutdown

On `SIGTERM` or `SIGINT`, the backend:
- stops accepting new HTTP connections
- closes the database pool
- exits after a bounded timeout if shutdown stalls

This is the expected behavior during deploys and container restarts.

## Recovery

If a deployment fails:
1. Inspect backend logs and readiness status.
2. Confirm the database volume still exists.
3. Fix the config or rollback the migration that caused the break.
4. Restart the stack after the issue is corrected.

Do not remove the persistent database volume unless you intend to reset the environment.
