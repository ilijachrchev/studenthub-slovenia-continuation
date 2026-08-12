function formatDateTime(value) {
    return new Date(value).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function PendingEventCard({ event, onApprove, onReject }) {
    return (
        <article className="pending-card">
            <div className="pending-card-body">
                <h3>{event.title}</h3>

                <p className="pending-card-org">{event.organizer_name}</p>
                <p className="pending-card-meta">
                    {formatDateTime(event.start_datetime)} - {formatDateTime(event.end_datetime)}
                </p>
                <p className="pending-card-meta">
                    {event.location} · {event.registration_type}
                </p>

                {event.description && <p className="pending-card-desc">{event.description}</p>}
            </div>

            <div className="pending-card-actions">
                <button type="button" className="btn-approve" onClick={() => onApprove(event.id)}>
                    Approve
                </button>
                <button type="button" className="btn-reject" onClick={() => onReject(event)}>
                    Reject
                </button>
            </div>
        </article>
    );
}

export default PendingEventCard;
