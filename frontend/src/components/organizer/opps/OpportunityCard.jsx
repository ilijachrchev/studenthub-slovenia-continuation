import StatusBadge from "../../shared/StatusBadge";

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OpportunityCard({
  opportunity,
  onEdit,
  onSubmit,
  onClose,
  onArchive,
  onViewApplicants,
  onViewAnalytics,
  busy,
}) {
  return (
    <article className="opp-card">
      <div className="opp-card-main">
        <div className="opp-card-head">
          <div>
            <h3>{opportunity.title}</h3>
            <p className="opp-card-subtitle">
              {opportunity.organization_name || opportunity.organization || "Owned opportunity"}
            </p>
          </div>
          <StatusBadge status={opportunity.status} />
        </div>

        {opportunity.summary && <p className="opp-card-summary">{opportunity.summary}</p>}

        <dl className="opp-card-meta">
          <div>
            <dt>Location</dt>
            <dd>{opportunity.location || "Not set"}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{formatDateTime(opportunity.application_deadline || opportunity.deadline)}</dd>
          </div>
          <div>
            <dt>Starts</dt>
            <dd>{formatDateTime(opportunity.start_date || opportunity.starts_at)}</dd>
          </div>
        </dl>

        {opportunity.tags?.length > 0 && (
          <div className="opp-card-tags" aria-label="Opportunity tags">
            {opportunity.tags.map((tag) => (
              <span key={tag} className="opp-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="opp-card-actions">
        <button type="button" className="btn-secondary" onClick={() => onEdit(opportunity)} disabled={busy}>
          Edit
        </button>
        <button type="button" className="btn-secondary" onClick={() => onViewApplicants(opportunity)} disabled={busy}>
          Applicants
        </button>
        <button type="button" className="btn-secondary" onClick={() => onViewAnalytics(opportunity)} disabled={busy}>
          Analytics
        </button>
        {opportunity.status === "draft" && (
          <button type="button" className="btn-primary btn-primary-inline" onClick={() => onSubmit(opportunity)} disabled={busy}>
            Submit
          </button>
        )}
        {opportunity.status !== "closed" && opportunity.status !== "archived" && (
          <button type="button" className="btn-warning" onClick={() => onClose(opportunity)} disabled={busy}>
            Close
          </button>
        )}
        {opportunity.status !== "archived" && (
          <button type="button" className="btn-danger" onClick={() => onArchive(opportunity)} disabled={busy}>
            Archive
          </button>
        )}
      </div>
    </article>
  );
}

export default OpportunityCard;


