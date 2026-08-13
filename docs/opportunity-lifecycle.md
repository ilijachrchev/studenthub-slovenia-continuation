# Opportunity Lifecycle

This repository currently treats opportunities as a small state machine with an
append-only status history.

## States

- `draft`
- `submitted`
- `published`
- `rejected`
- `closed`
- `archived`

## Observed behavior

- New opportunities are created as `draft`.
- Organizer-owned drafts can be submitted.
- Admin review publishes or rejects submitted opportunities.
- Published opportunities can be closed.
- Closed opportunities can be reopened if the application deadline still allows it.
- Rejected opportunities can be reopened to draft by the organizer and edited again.
- Admin moderation operates on submitted opportunities and records the actor in history.
- Archived opportunities are terminal.

## History

Every persisted transition should record:

- opportunity id
- previous state
- new state
- actor user id
- optional reason
- timestamp

This makes lifecycle changes auditable without duplicating state logic in routes.
