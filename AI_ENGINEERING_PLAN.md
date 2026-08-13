# Discovery Intelligence

## Summary
Implement `WP-NOTIF-01`, `WP-REC-01`, and `WP-REC-02` in order against the actual PostgreSQL schema and current route structure.

## Work Packages
- `WP-NOTIF-01`: centralize application notification emission, mount the notification routes, align preference keys, and remove duplicate lifecycle logic.
- `WP-REC-01`: add deterministic opportunity discovery and recommendations on top of the real opportunity model, with pagination and filtering.
- `WP-REC-02`: add lightweight analytics capture and organizer-only analytics reporting with minimal DB load.

## Constraints
- Preserve existing API response compatibility where the frontend already accepts multiple shapes.
- Keep query count bounded and avoid N+1 behavior.
- Update `AI_ENGINEERING_PROGRESS.md` after each completed WP.
