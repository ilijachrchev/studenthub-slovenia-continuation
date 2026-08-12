# Frontend State and API Boundaries

This document describes the current frontend reliability boundaries for StudentHub Slovenia.

## Route groups

- Public routes: landing page, authentication, password reset, organization profile, event detail, search.
- Student routes: saved events, registrations, settings, opportunity discovery, applications, notifications.
- Organizer routes: organizer dashboard and event creation.
- Admin routes: moderation queues for pending events and organizations.

## State ownership

- Page components own their own server state unless the data is reused by a sibling or shared layout.
- Shared state is limited to auth/session state in `AuthContext` and the notification unread badge in `Topbar`.
- Optimistic mutations must always keep a rollback path and must never be the source of truth for security-sensitive actions.

## API boundaries

- All browser requests must send cookies with `credentials: "include"` when they rely on session state.
- Shared HTTP helpers should live in `src/api/` and normalize response status, network failure, and JSON parsing behavior.
- Domain-specific wrappers can live alongside shared helpers, but they should reuse the same low-level request helper.
- Frontend authorization is only for UX and route presentation. The backend remains authoritative for access control.

## Failure handling rules

- Loading, empty, error, and success states must be visually distinct.
- `401` should redirect to login or clearly prompt the user to authenticate.
- `403` should explain that the action is not allowed in the current session.
- `404` should show a not-found state instead of a generic failure whenever the resource is missing.
- `409` should be surfaced as a conflict, usually for duplicate or already-completed actions.
- `422` should report validation feedback directly to the user.
- `429` should show rate-limit feedback and avoid retry loops.
- `500` and network failures should keep the user on the current page with a retryable error state.

## Stale request rules

- Abort in-flight requests when a route parameter or filter changes.
- Ignore old responses if a newer request has already completed.
- Never let an older response overwrite a newer page state.

## Accessibility rules

- Interactive icons must have labels.
- Modal dialogs must trap focus visually and provide keyboard-dismiss behavior.
- Error and status messages should be announced or placed in semantic live regions when they are the main page outcome.

