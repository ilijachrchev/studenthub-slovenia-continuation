# Opportunity Lifecycle & Intelligence Layer

This document describes the backend lifecycle system for the `opportunity` and
`application` entities: the explicit state machines, authorization rules, audit
trail, idempotency/concurrency guarantees, and the analytics they expose.

It complements `docs/opportunity-hub.md` (frontend surface contract for a
different, in-progress `/api/organizer/opportunities` API — see
[API surface note](#api-surface-note-vs-opportunity-hubmd) at the bottom).

## Domain model

Two related but independent lifecycles:

- **Opportunity** — the listing itself (owned by an organization).
- **Application** — a student's application against a published opportunity.

```
Opportunity:  draft ──▶ published ──▶ closed ──▶ archived
                │                        │            ▲
                └───────────▶ archived   └────────────┘ (reopen: closed → published)

Application:  pending ──▶ under_review ──▶ shortlisted ──▶ accepted
                │              │                │
                └──────────────┴────────────────┴──▶ withdrawn (student only)
                                                  ╲──▶ rejected (organizer/admin)
```

Application status aliases accepted on input: `submitted→pending`,
`approved→accepted`, `declined→rejected`, `cancelled|canceled→withdrawn`,
`reviewing→under_review` (see `lib/opportunity/statusMachine.js`).

## Opportunity states

| Status      | Meaning                                                        |
|-------------|-----------------------------------------------------------------|
| `draft`     | Only visible to the organization's members. Fully editable.     |
| `published` | Publicly listed; accepts applications until `deadline`.         |
| `closed`    | No longer accepts applications; still visible to owners/admins. |
| `archived`  | Terminal. Hidden from every listing.                             |

### Allowed transitions (`lib/opportunity/opportunityStatusMachine.js`)

| From \ To  | draft | published | closed | archived |
|------------|:-----:|:---------:|:------:|:--------:|
| **draft**     |   —   |  organizer/admin | — | organizer/admin |
| **published** |   —   |     —     | organizer/admin | admin only |
| **closed**    |   —   | organizer/admin (reopen) | — | organizer/admin |
| **archived**  |   —   |     —     |   —    |    —     |

Notes:
- `published → archived` is reserved for **admin** (moderation takedown);
  an organizer must go through `closed` first.
- `closed → published` allows an organizer to reopen a listing (e.g. after
  extending the deadline via `PATCH` is *not* currently allowed post-publish —
  reopening only reinstates visibility/applications, it does not change other
  fields).
- Every other transition is rejected with `409 Conflict` and a message naming
  the disallowed `from -> to` pair. Unknown status values are rejected with
  `400`. An unrecognized actor role is rejected with `403`.

## Authorization

- **Organizer**: any user with an `organizer_profile` row in the opportunity's
  organization (any `role_in_org`) can create opportunities and drive their
  lifecycle. Cross-organization access is denied with **404** (not 403) to
  avoid confirming that another organization's opportunity exists.
- **Admin**: can transition any opportunity, including the moderation-only
  `published → archived` shortcut, and can view any opportunity's audit
  history/analytics.
- **Student**: cannot create or transition opportunities. Can only view
  `published` opportunities and manage their own applications
  (`routes/applications.js`).

## Transactional integrity & concurrency

Every mutating endpoint (`POST /api/opportunities`,
`PATCH /api/opportunities/:id`, `POST /api/opportunities/:id/transition`) runs
inside a single DB transaction:

1. `BEGIN`
2. `SELECT ... FOR UPDATE` locks the target row, so two concurrent requests
   against the same opportunity serialize instead of racing.
3. The state machine validates the transition against the **locked, current**
   status (an optional client-supplied `from_status` is checked first and
   rejected with `409` if it's already stale).
4. The `UPDATE` itself is additionally guarded with `WHERE status = $from` —
   belt-and-suspenders in case future code paths mutate the row outside this
   lock.
5. The audit row (`opportunity_history`) is written in the same transaction
   as the status change, so a crash or rollback can never leave a status
   change without a corresponding history entry (or vice versa).
6. `COMMIT` (or `ROLLBACK` on any failure, including validation errors).

Under concurrent duplicate transition requests, exactly one succeeds (`200`);
the other observes either the now-current status via the lock (rejected by
the state machine, `409`) or a `0`-row conditional update (`409`).

## Idempotency

Any mutating request may include an `Idempotency-Key` header
(`lib/opportunity/idempotency.js`):

- First request with a given key: processed normally; the `(scope, key,
  user_id)` triple plus a hash of the request body is stored **in the same
  transaction** as the mutation.
- Repeated request with the **same** key and **same** body: short-circuited —
  the original response is replayed verbatim, no new history row is written.
- Repeated request with the **same** key but a **different** body: rejected
  with `422` (key reuse across different operations is treated as a client
  bug, not a retry).
- No key supplied: request is processed normally every time (idempotency is
  opt-in, matching how retries are typically implemented by clients).

## Audit history

`opportunity_history` is an append-only log: `action`, `from_status`,
`to_status`, `actor_user_id`, `actor_role`, optional `reason`, `created_at`.
Readable via `GET /api/opportunities/:id/history` by the opportunity's
managers or an admin. This mirrors the existing `application_history` model
used by `routes/applications.js`.

## Notifications

- Admin-initiated transitions always notify the organization owner
  (`opportunity.status_changed`, includes `reason` when given).
- Transitioning to `closed` or `archived` notifies every applicant whose
  application is still in a non-terminal status (`pending`, `under_review`,
  `shortlisted`) — `opportunity.closed` — since the opportunity's fate
  directly affects their outcome. Applicants who already reached a terminal
  status (`accepted`/`rejected`/`withdrawn`) are not re-notified.
- Delivery respects `notification_preferences` per recipient/type (existing
  `lib/opportunity/notifications.js`, unchanged).

## Analytics

Only metrics that can be computed correctly and cheaply from existing tables
are exposed — no invented/estimated numbers.

### `GET /api/opportunities/:id/analytics` (owner/manager or admin)

```json
{
  "opportunityId": 1,
  "status": "published",
  "activity": { "created_at": "...", "published_at": "...", "closed_at": null, "archived_at": null },
  "applications": {
    "total": 12,
    "status_distribution": { "pending": 5, "under_review": 3, "accepted": 2, "rejected": 2 },
    "conversion_rate": 0.1667,
    "avg_seconds_to_review": 3600.0,
    "avg_seconds_to_decision": 172800.0
  }
}
```

- `conversion_rate` = accepted / total applications (`null` if there are no
  applications yet — never divide by zero).
- `avg_seconds_to_review` = average time between an application's creation
  and its first recorded status transition (`application_history`).
- `avg_seconds_to_decision` = average time between creation and the first
  transition into a terminal `accepted`/`rejected` status.

### `GET /api/opportunities/analytics/summary` (organizer, own organization)

Aggregate opportunity-status distribution and application-status
distribution/conversion rate across every opportunity the organizer's
organization owns — an organizer performance rollup.

## API surface note (vs. `opportunity-hub.md`)

`docs/opportunity-hub.md` documents a frontend contract against
`/api/organizer/opportunities/*` with an application status vocabulary of
`review|accepted|rejected`. That surface does not exist in this backend
branch. This document describes the actual implemented surface:
`/api/opportunities/*` (opportunity lifecycle) and `/api/applications/*`
(application lifecycle, pre-existing). Reconciling the two API shapes is a
frontend/backend integration decision for whoever merges this branch — see
the final report's "Recommended integration order" for a suggested path.
