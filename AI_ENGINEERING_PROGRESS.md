# Discovery Intelligence Progress

## Status
- `WP-NOTIF-01`: completed
- `WP-REC-01`: completed
- `WP-REC-02`: completed

## Notes
- Root engineering docs were missing and have now been created.
- Notification emission now goes through the shared lifecycle helper, notification preferences use the frontend-facing snake_case keys, and the notification API exposes unread-count compatibility aliases.
- Recommendations are student-only, deterministic, paginated, and exclude already-applied/bookmarked opportunities.
- Analytics capture and organizer reporting are wired to the new append-only event table with organizer ownership checks and empty-dataset handling.
- Integration coverage was added for notifications, recommendations, and analytics, but PostgreSQL could not be brought up in this environment, so the DB-backed suite is still unverified here.
