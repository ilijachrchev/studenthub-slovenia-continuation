# Test Coverage Map

This repository currently has a small but meaningful mix of backend integration tests, validation unit tests, migration checks, and a couple of frontend route tests.

## Authentication

- Covered in `backend/__tests__/integration/auth.test.js`
- Areas covered:
  - Registration success
  - Duplicate email rejection
  - Missing field validation
  - Invalid email format
  - Weak password rejection
  - Login success
  - Wrong password and unknown email failures
  - Session lookup via `GET /api/auth/me`
  - Logout
  - Password reset success and invalid-password failures

## Authorization

- Covered in `backend/__tests__/integration/authorization.test.js`
- Areas covered:
  - Anonymous access to protected routes
  - Student, organizer, and admin role boundaries
  - Session behavior
  - Oversized body rejection

## Opportunities / Events

- Covered in `backend/__tests__/integration/events.test.js`
- Areas covered:
  - Public event listing
  - Event detail retrieval
  - Pagination parameters
  - Organizer event creation
  - Registration create/delete/list behavior

## Moderation

- Partially covered in `backend/__tests__/integration/events.test.js`
- Areas covered today:
  - Event creation and submission
  - Public/admin event separation
- Missing dedicated coverage:
  - Approval/rejection flow
  - Repeated moderation attempts
  - Admin failure paths

## Recommendations

- Current recommendation behavior is implemented in `GET /api/events`
- Areas already covered indirectly:
  - Personalized feed ordering by student profile and tag matches
- Missing dedicated coverage:
  - Empty feed edge cases
  - Explicit authorization boundary checks for personalized vs anonymous feed shape
  - Failure-path regression tests

## Analytics

- No backend analytics endpoint exists in this baseline.
- The current analytics surface is frontend-only.
- Backend test coverage is therefore not available yet for this area.

## Database

- Covered in `backend/__tests__/migration.test.js`
- Areas covered:
  - Migration up
  - Required table creation
  - Rollback
  - Re-running migrations after rollback

- Validation helpers are covered in `backend/__tests__/validate.test.js`

## Frontend

- Covered in `frontend/src/__tests__/ProtectedRoute.test.jsx`
- Covered in `frontend/src/__tests__/RoleRoute.test.jsx`
- Areas covered:
  - Protected route rendering
  - Role-gated rendering
  - Redirect behavior

## Notable Gaps

- No dedicated tests yet for:
  - Opportunity archive/delete/update because the current backend schema and routes do not expose those behaviors
  - Analytics API boundaries because no backend analytics route exists in this baseline
  - Frontend stateful organizer/admin screens beyond the route guards

