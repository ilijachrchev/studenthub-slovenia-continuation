# Trust, Safety & Moderation

Backend implementation for report intake, the moderation queue, safe
concurrent assignment, and an immutable audit trail. Mounted at
`/api/moderation` (`backend/routes/moderation.js`).

## Roles

The platform already has `student` / `organizer` / `admin` as `user.role`
values, plus a separate `admin` table used as a defense-in-depth check
(`requireAdminRecord`). This feature adds a `moderator` role the same way:

- `user.role = 'moderator'` *and* a row in the new `moderator` table.
- Neither `admin` nor `moderator` can be granted through `/api/auth/register`
  (see `routes/auth.js` — registration only accepts `student`/`organizer`).
  They're provisioned directly against the database, exactly like admins are
  today.
- **Session role is never trusted alone.** `requireModerator` /
  `requireModerationAdmin` (`middleware/auth.js`) re-verify the caller against
  the `admin`/`moderator` tables on every request. A user whose session still
  says `role: 'moderator'` after being demoted, or a forged/stale session
  claiming a privileged role, is rejected unless the DB row actually exists.
  `loadModerationActor()` treats an `admin` row as a superset of moderator
  authority everywhere in this feature.

## Report lifecycle

```
        create           claim              resolve/dismiss
 (none) ------> open ------------> under_review ------------> resolved
                 |  \                  |    |                 dismissed
                 |   \ escalate        |    \-- release --> open
                 |    v                v
                 |  escalated <--------+  (admin sign-off required to close)
                 \--------------------------------------------> dismissed
```

- `open` — created, unassigned, actionable.
- `under_review` — claimed by exactly one moderator.
- `escalated` — raised to `severity: critical`; only an **admin** can resolve
  or dismiss it, even if a moderator holds the claim.
- `resolved` / `dismissed` — terminal. Reopening is out of scope; file a new
  report if the problem recurs (the duplicate-report index only blocks
  *active* reports, so this is always possible).

## Concurrency & abuse prevention

| Risk | Mitigation |
|---|---|
| Two moderators claim the same report | `SELECT ... FOR UPDATE` + conditional `UPDATE ... WHERE status='open' AND assigned_moderator_user_id IS NULL`. Loser gets `409`. |
| Two requests resolve/dismiss the same report | Same pattern: `UPDATE ... WHERE status = $expected_status`. `rowCount === 0` → `409`, no double-processing, no double side-effects. |
| Report spam | Per-user DB-backed limit (`MODERATION_REPORTS_PER_HOUR_LIMIT`, default 10/hour) plus a coarse per-IP `express-rate-limit` layer in front of it. |
| Duplicate reports | Partial unique index `uniq_active_moderation_report` on `(target_type, target_id, reporter_user_id)` while `status IN ('open','under_review','escalated')`. |
| Self-reporting | Blocked at the application layer: a report is rejected if the reporter owns the target opportunity's organization. |
| IDOR on report detail | `/reports/:id` and `/queue` require `requireModerator`; a reporter can only ever see their own submissions via the separate, field-limited `/reports/mine`. |
| Mass assignment | Every mutation route reads an explicit whitelist of fields off `req.body` — nothing is spread into a query. |
| Privilege escalation | See "Session role is never trusted alone" above. |
| Unauthorized moderation | `canClose`/`canRelease` in `lib/moderation/reportRules.js` enforce that only the assigned moderator (or an admin) can act on a claimed report. |

## Evidence preservation & audit trail

Every mutating action writes one row to `moderation_audit_log`
(`actor_user_id`, `action`, `target_type`/`target_id`, `report_id`,
`metadata`, `created_at`) inside the same transaction as the state change —
so an audit entry only exists if the action actually committed, and never
exists for a rolled-back attempt.

The table is **append-only at the database layer**: a trigger
(`trg_moderation_audit_log_no_update`) raises on any `UPDATE` or `DELETE`
against `moderation_audit_log`, regardless of which DB role issues the
statement. "Correcting" history means appending a new entry, not rewriting
an old one.

## Endpoints

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/moderation/reports` | any authenticated user | File a report against an opportunity. |
| `GET /api/moderation/reports/mine` | any authenticated user | Your own reports, status only — no moderator notes or identities. |
| `GET /api/moderation/queue` | moderator/admin | Filterable queue (`status`, `severity`, `target_type`, `assigned_to`, `date_from`/`date_to`, pagination). |
| `GET /api/moderation/reports/:id` | moderator/admin | Full detail + audit trail. |
| `GET /api/moderation/reports/:id/history` | moderator/admin | Audit trail only. |
| `POST /api/moderation/reports/:id/claim` | moderator/admin | Atomically assign to self. |
| `POST /api/moderation/reports/:id/release` | assignee or admin | Return to the open queue. |
| `POST /api/moderation/reports/:id/reassign` | admin only | Force-assign to a specific moderator. |
| `POST /api/moderation/reports/:id/resolve` | assignee or admin | Close with `action` (`hide_content`\|`restore_content`\|`no_action`\|`warn_organizer`) + `note`. |
| `POST /api/moderation/reports/:id/dismiss` | assignee or admin | Close with `note`, no content action. |
| `POST /api/moderation/reports/:id/escalate` | assignee or admin | Raise to admin-only, `severity: critical`. |
| `POST /api/moderation/opportunities/:id/hide` | admin only | Direct takedown outside the report workflow. |
| `POST /api/moderation/opportunities/:id/restore` | admin only | Reverse a takedown. |

All error responses are `{ error: "<safe message>" }` — no stack traces, SQL
text, or internal paths (`catchAsync` and every handler here return a fixed
string on unexpected failures).

## Known limitations / integration notes

- `target_type` currently only validates `'opportunity'` (enforced by both a
  DB `CHECK` constraint and the application layer). The schema is polymorphic
  by design so a second target type is a data-only addition later.
- This worktree's base branch has no opportunity CRUD/listing routes mounted
  yet (`routes/applications.js` exists but isn't wired into `app.js`), so
  there's no in-app way to reach an opportunity to report it end-to-end from
  the UI until that lands. The moderation API itself only needs the
  `opportunity` row to exist, which other in-flight branches (e.g.
  `agent-1-opp-lifecycle`) will provide.
- Other branches (`agent-7-moderation-admin`,
  `feature/recommendations-analytics-moderation`) built earlier, explicitly
  "do not merge as-is" prototypes of overlapping tables (`opportunity_report`,
  a differently-shaped `moderation_audit_log`, some keyed against the legacy
  `event` table instead of `opportunity`). This branch does not reuse those
  tables/migrations — reconcile before any merge that would pull in more than
  one of these lineages, per the existing schema-ownership notes on those
  branches.
- No frontend moderation UI is included in this branch (backend-only scope
  for this pass); `agent-7-moderation-admin` has a prior frontend attempt
  that would need to be re-pointed at these endpoints and response shapes.
