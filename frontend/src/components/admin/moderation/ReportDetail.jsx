import StatusBadge from "../../shared/StatusBadge";

function formatDateTime(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_LABELS = {
  report_created: "Report submitted",
  report_claimed: "Claimed by moderator",
  report_released: "Returned to queue",
  report_reassigned: "Reassigned",
  report_resolved: "Resolved",
  report_dismissed: "Dismissed",
  report_escalated: "Escalated to admin",
  opportunity_hidden: "Listing hidden",
  opportunity_restored: "Listing restored",
};

function ReportDetail({ report, currentUser, isAdmin, onClaim, onRelease, onDecide, busy }) {
  if (!report) {
    return (
      <section className="report-detail empty">
        <h2>Open a report</h2>
        <p>Select a report on the left to review the evidence and take action.</p>
      </section>
    );
  }

  const isAssignedToMe = report.assigned_moderator_user_id === currentUser?.id;
  const isOpen = report.status === "open";
  const isUnderReview = report.status === "under_review";
  const isEscalated = report.status === "escalated";
  const isClosed = report.status === "resolved" || report.status === "dismissed";
  const canAct = (isUnderReview && isAssignedToMe) || (isEscalated && isAdmin);

  return (
    <section className="report-detail" aria-labelledby="report-detail-title">
      <div className="report-detail-header">
        <div>
          <p className="report-detail-kicker">Report #{report.id}</p>
          <h2 id="report-detail-title">{report.opportunity_title || "Report details"}</h2>
        </div>
        <div className="report-detail-badges">
          <StatusBadge status={report.status} />
          <StatusBadge status={report.severity} />
        </div>
      </div>

      <dl className="report-detail-grid">
        <div>
          <dt>Reporter</dt>
          <dd>{report.reporter_name || report.reporter_email || "Unknown"}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(report.created_at)}</dd>
        </div>
        <div>
          <dt>Organization</dt>
          <dd>{report.organization_name || "Unknown"}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{report.category || "other"}</dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd>{report.assigned_moderator_email || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Listing status</dt>
          <dd>{report.opportunity_status || "unknown"}</dd>
        </div>
      </dl>

      <div className="report-detail-summary">
        <h3>Reporter's evidence</h3>
        <p>{report.reason || "No reason was supplied."}</p>
      </div>

      {isClosed && (
        <div className="report-detail-summary">
          <h3>Resolution</h3>
          <p>
            <strong>{report.resolution_action || "No action"}</strong> — {report.resolution_note}
          </p>
          <p className="report-detail-kicker">
            By {report.resolved_by_email || "unknown"} on {formatDateTime(report.resolved_at)}
          </p>
        </div>
      )}

      {isEscalated && !isAdmin && (
        <p className="opp-inline-error" role="status">
          This report was escalated and can only be resolved or dismissed by an admin.
        </p>
      )}

      <div className="report-detail-actions">
        {isOpen && (
          <button type="button" className="btn-primary" onClick={() => onClaim(report)} disabled={busy}>
            Claim report
          </button>
        )}
        {isUnderReview && isAssignedToMe && (
          <button type="button" className="btn-secondary" onClick={() => onRelease(report)} disabled={busy}>
            Release back to queue
          </button>
        )}
        {canAct && (
          <>
            <button type="button" className="btn-warning" onClick={() => onDecide(report, "resolve")} disabled={busy}>
              Resolve
            </button>
            <button type="button" className="btn-danger" onClick={() => onDecide(report, "dismiss")} disabled={busy}>
              Dismiss
            </button>
            {!isEscalated && (
              <button type="button" className="btn-secondary" onClick={() => onDecide(report, "escalate")} disabled={busy}>
                Escalate to admin
              </button>
            )}
          </>
        )}
      </div>

      {Array.isArray(report.audit_trail) && report.audit_trail.length > 0 && (
        <details className="report-detail-notes" open>
          <summary>Audit trail</summary>
          <ul className="audit-trail-list">
            {report.audit_trail.map((entry) => (
              <li key={entry.id}>
                <span>{ACTION_LABELS[entry.action] || entry.action}</span>
                <span className="report-detail-kicker">{formatDateTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default ReportDetail;
