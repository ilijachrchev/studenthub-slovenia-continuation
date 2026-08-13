# StudentHub Slovenia Engineering Program Plan

## Purpose
Keep the StudentHub Slovenia program coherent while implementation progresses. This plan is the source of truth for work packages, dependency order, ownership, and acceptance criteria.

## Current Program Picture
- PostgreSQL migration is present in code and CI, but still carries legacy compatibility and validation gaps.
- The opportunity-hub UI exists in the repository, but the app router does not mount it and the backend does not expose the matching `/api/organizer/opportunities` or `/api/admin/moderation` surfaces yet.
- The legacy event/admin flow remains the only fully mounted moderation path in the live app.
- The requested `AI_ENGINEERING_PLAN.md` and `AI_ENGINEERING_PROGRESS.md` files were absent at inspection time and are now reconstructed in the repo.

## Work Packages
| Work package | Owner | Depends on | Current state | Verification rule |
|---|---|---|---|---|
| Program docs and status board | Program architect | Repository tree, current routes, migration docs | Complete | Files exist and reflect actual repo state |
| PostgreSQL infrastructure | Backend/infrastructure | Knex config, compose, CI, migrations, tests | Code-complete, live validation unverified | DB stack boots and tests run against PostgreSQL |
| Opportunity hub backend API | Backend | Opportunity schema, application flow, moderation contract | Missing | Mounted routes match the frontend pages and docs |
| Opportunity hub frontend wiring | Frontend | Backend API parity | Built but inactive | Routes are mounted and pages render without dead links |
| Legacy event/admin path | Product/backend | None | Live and mounted | Existing flows still work until cutover is explicit |
| Canonical README / architecture docs | Program architect | Current repository state | Stale in places | Docs match the actual runtime and infra defaults |

## Wave Sequencing
### Wave 0: Truth capture
- Reconcile docs with the current repository.
- Record ownership, dependencies, and blockers.
- Mark unverified claims explicitly.

### Wave 1: Backend parity
- Expose the opportunity-hub API surface.
- Align route mounting with the documented contracts.
- Keep the legacy event/admin path intact until parity is verified.

### Wave 2: Frontend activation
- Mount the opportunity-hub routes in the app shell.
- Wire organizer/admin navigation to the active pages.
- Remove or relabel dead links that point at unmounted surfaces.

### Wave 3: Verification and cleanup
- Run integration and route-smoke coverage against the active stack.
- Retire duplicated implementations once replacement paths are verified.
- Remove stale compatibility or documentation drift only after validation.

## Architectural Decisions
- Use PostgreSQL as the primary runtime database.
- Keep MySQL compatibility references only when they are explicitly documented as legacy fallbacks.
- Treat the opportunity hub as a distinct program surface from the legacy event/admin flow.
- Do not count UI files as complete until the corresponding backend routes and mounted navigation are present.
- Do not mark work complete unless it has been verified against the actual repository state.

## Acceptance Criteria
- The plan and progress docs can be read without contradicting the repository.
- Each work package has an owner, dependency chain, and verification rule.
- Live routes, mounted frontend navigation, and documented API contracts agree.
- No stale status claims remain in the program docs.
- All unresolved items are labeled unverified rather than assumed complete.

## Blockers
- Opportunity-hub frontend routes exist but are not mounted.
- The backend does not yet expose the documented opportunity-hub API surface.
- Some PG migration claims are code-complete but still unverified in a live environment.

## Cross-Agent Coordination Notes
- Backend changes must not invalidate the legacy event/admin path until the new opportunity-hub path is verified.
- Frontend route work depends on the backend contract being present first.
- Documentation updates should always be checked against the current tree before marking any implementation complete.
- Any future agent must update the progress doc and status board when changing route ownership or dependency order.
