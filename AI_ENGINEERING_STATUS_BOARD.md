# StudentHub Slovenia Status Board

| Wave | Work package | Owner | Dependencies | Status | Notes |
|---|---|---|---|---|---|
| 0 | Program docs and truth capture | Program architect | Current repo tree, current routes, migration docs | Complete | Docs now reflect actual repository state and unverified claims are labeled |
| 1 | PostgreSQL infrastructure | Backend/infrastructure | Knex config, compose, CI, migrations, tests | Code-complete, unverified live | `pg` is wired in the backend and CI, but the stack still has legacy compatibility references |
| 1 | Opportunity hub backend API | Backend | Opportunity schema, application flow, moderation contract | Missing | No mounted `/api/organizer/opportunities` or `/api/admin/moderation` surface yet |
| 2 | Opportunity hub frontend wiring | Frontend | Backend API parity | Built but inactive | Pages exist but are not routed in `App.jsx` |
| 2 | Legacy event/admin path | Product/backend | None | Live | Current moderation path remains the legacy event/admin route set |
| 3 | Verification and cleanup | All | Backend parity, frontend activation, live DB validation | Pending | Cannot be marked complete until the new routes and runtime are verified |

## Coordination Rules
- Do not mark a package complete unless it is confirmed in the repository.
- Do not let frontend route work outrun backend contract work.
- Do not remove legacy paths until replacement paths are live and tested.
- Do not treat historical migration reports as current runtime truth.
