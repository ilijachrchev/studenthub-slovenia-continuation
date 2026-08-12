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

function ApplicantList({ applicants, selectedId, onSelect }) {
  return (
    <div className="applicant-list" role="list" aria-label="Applicants">
      {applicants.map((applicant) => (
        <button
          key={applicant.id}
          type="button"
          role="listitem"
          className={selectedId === applicant.id ? "applicant-row active" : "applicant-row"}
          onClick={() => onSelect(applicant)}
        >
          <div className="applicant-row-main">
            <div>
              <h3>{applicant.name || applicant.full_name || applicant.email}</h3>
              <p>{applicant.email}</p>
            </div>
            <StatusBadge status={applicant.status} />
          </div>
          <div className="applicant-row-meta">
            <span>Applied {formatDateTime(applicant.applied_at || applicant.created_at)}</span>
            {applicant.source && <span>{applicant.source}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

export default ApplicantList;


