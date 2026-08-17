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

function ReportCard({ report, active, onOpen }) {
  return (
    <button type="button" className={active ? "report-card active" : "report-card"} onClick={() => onOpen(report)}>
      <div className="report-card-top">
        <h3>{report.opportunity_title || `Report #${report.id}`}</h3>
        <StatusBadge status={report.status} />
      </div>
      <p className="report-card-summary">
        {report.organization_name || "Unknown organization"} &middot; {report.category || "other"}
      </p>
      <div className="report-card-meta">
        <StatusBadge status={report.severity} className="severity-badge" />
        <span>{report.assigned_moderator_email || "Unassigned"}</span>
        <span>{formatDateTime(report.created_at)}</span>
      </div>
    </button>
  );
}

export default ReportCard;
