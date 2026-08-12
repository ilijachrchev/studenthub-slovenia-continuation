# Opportunity Hub

The opportunity hub adds organizer and admin tooling for managing student-facing opportunities and the moderation workflow around them.

## Surfaces

- Organizer manage view: list owned opportunities across all statuses, create and edit draft opportunities, and submit, close, or archive them.
- Organizer applicants view: inspect applicant lists for a selected opportunity, open cover notes and history, and move applicants through review, acceptance, or rejection.
- Organizer analytics view: review a selected opportunity's funnel, conversion summary, and timeseries activity.
- Admin moderation queue: filter reports by status, inspect a report, resolve or dismiss it with a note, and optionally archive the related opportunity.

## Frontend structure

- `src/pages/organizer/opps/ManageOpportunities.jsx`
- `src/pages/organizer/opps/OpportunityApplicants.jsx`
- `src/pages/organizer/analytics/OpportunityAnalytics.jsx`
- `src/pages/admin/moderation/ModerationQueue.jsx`
- `src/components/organizer/opps/*`
- `src/components/admin/moderation/*`
- `src/components/shared/StatusBadge.jsx`

## API surface

All requests use `fetch(..., { credentials: "include" })`.

### Organizer opportunities

- `GET /api/organizer/opportunities`
- `POST /api/organizer/opportunities`
- `PATCH /api/organizer/opportunities/:id`
- `POST /api/organizer/opportunities/:id/submit`
- `POST /api/organizer/opportunities/:id/close`
- `POST /api/organizer/opportunities/:id/archive`

### Organizer applicants

- `GET /api/organizer/opportunities/:id/applicants`
- `POST /api/organizer/opportunities/:id/applicants/:applicantId/transition`

Expected transition payload:

```json
{
  "status": "review | accepted | rejected",
  "note": "optional"
}
```

### Organizer analytics

- `GET /api/organizer/opportunities/:id/analytics`

Expected response shape:

```json
{
  "opportunity": { "id": 1, "title": "..." },
  "summary": {
    "views": 0,
    "visits": 0,
    "applications": 0,
    "reviews": 0,
    "accepts": 0,
    "rejects": 0,
    "conversion": 0
  },
  "funnel": [
    { "stage": "views", "count": 0 }
  ],
  "timeseries": [
    { "date": "2026-08-01", "count": 0 }
  ]
}
```

### Admin moderation

- `GET /api/admin/moderation/reports?status=open`
- `GET /api/admin/moderation/reports/:id`
- `POST /api/admin/moderation/reports/:id/resolve`
- `POST /api/admin/moderation/reports/:id/dismiss`

Expected moderation payload:

```json
{
  "note": "moderator note",
  "archive_opportunity": true
}
```

## Validation notes

- Opportunity drafts require a title, description, location, application deadline, start date, and end date.
- Start and end dates are validated in sequence.
- Capacity must be positive when provided.
- Contact email and application URL are validated when present.
- Applicant transitions and moderation decisions are confirmed before submission and update the UI optimistically.

## Accessibility

- All forms use native labels and controls.
- Status, loading, and empty states use live regions or semantic alerts where appropriate.
- Lists and charts remain readable without hover or pointer interaction.
- Actions are available as buttons and do not depend on drag-and-drop or gesture-only interactions.
