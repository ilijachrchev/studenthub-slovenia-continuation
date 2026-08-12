# Backend Request and Error Flow

This document records the request path and error-handling conventions used by the
Express backend.

## Request flow

1. `app.js` applies core middleware in order:
   - `helmet`
   - `cors`
   - `express.json`
   - `express-session`
   - CSRF origin validation
   - `pino-http`
2. Route modules are mounted under `/api/*`.
3. Handlers should:
   - validate input up front
   - return explicit 4xx responses for expected failures
   - use `catchAsync` for async handlers
   - wrap multi-write operations in a transaction

## Error flow

1. Async route handlers are wrapped with `catchAsync`.
2. `catchAsync` forwards rejections to Express with `next(err)`.
3. The app-level error handler converts the error to JSON and strips internal details
   from unexpected failures.
4. Unmatched API routes should return JSON 404 responses.

## Logging

1. `pino-http` logs requests.
2. Domain code uses the shared `logger` for warnings and errors.
3. Best-effort side effects should log failures and continue only when the feature
   explicitly allows degraded behavior.

## Transaction rules

1. Use `pool.connect()` for related writes that must commit together.
2. Call `BEGIN` before the first write.
3. `COMMIT` only after every related write succeeds.
4. `ROLLBACK` and release the client in a `finally` block.

## Pagination rules

1. Clamp request `limit` values to a safe maximum.
2. Clamp page numbers to at least `1`.
3. Prefer deterministic ordering before slicing results.
