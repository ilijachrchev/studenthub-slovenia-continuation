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

function ReportDetail({ report, onResolve, onDismiss, onSelectOpportunity }) {
  if (!report) {
    return (
      <section className="report-detail empty">
        <h2>Open a report</h2>
        <p>Select a report on the left to review its details and decide whether to resolve or dismiss it.</p>
      </section>
    );
  }

  return (
    <section className="report-detail" aria-labelledby="report-detail-title">
      <div className="report-detail-header">
        <div>
          <p className="report-detail-kicker">Report #{report.id}</p>
          <h2 id="report-detail-title">{report.subject || report.title || "Report details"}</h2>
        </div>
        <StatusBadge status={report.status} />
      </div>

      <dl className="report-detail-grid">
        <div>
          <dt>Reporter</dt>
          <dd>{report.reporter_name || report.reporter_email || "Anonymous"}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(report.created_at)}</dd>
        </div>
        <div>
          <dt>Opportunity</dt>
          <dd>{report.opportunity_title || report.opportunity?.title || "Unknown"}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{report.category || report.type || "General"}</dd>
        </div>
      </dl>

      <p className="report-detail-summary">{report.reason || report.summary || "No report note was supplied."}</p>

      {report.notes && (
        <details className="report-detail-notes">
          <summary>History and notes</summary>
          <p>{report.notes}</p>
        </details>
      )}

      {report.opportunity_id && onSelectOpportunity && (
        <button type="button" className="btn-secondary" onClick={() => onSelectOpportunity(report.opportunity_id)}>
          Open opportunity
        </button>
      )}

      <div className="report-detail-actions">
        <button type="button" className="btn-warning" onClick={() => onResolve(report)}>
          Resolve
        </button>
        <button type="button" className="btn-danger" onClick={() => onDismiss(report)}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

export default ReportDetail;
