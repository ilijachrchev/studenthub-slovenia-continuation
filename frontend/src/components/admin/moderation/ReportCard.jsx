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
        <h3>{report.subject || report.title || `Report #${report.id}`}</h3>
        <StatusBadge status={report.status} />
      </div>
      <p className="report-card-summary">{report.reason || report.summary || "No summary provided."}</p>
      <div className="report-card-meta">
        <span>{report.reporter_name || report.reporter_email || "Anonymous reporter"}</span>
        <span>{formatDateTime(report.created_at)}</span>
      </div>
    </button>
  );
}

export default ReportCard;


