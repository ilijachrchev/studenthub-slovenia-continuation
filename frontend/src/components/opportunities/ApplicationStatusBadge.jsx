import "./css/opportunities.css";

const STATUS_LABELS = {
  pending: "Pending",
  submitted: "Submitted",
  under_review: "Under review",
  in_review: "In review",
  shortlisted: "Shortlisted",
  approved: "Approved",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Withdrawn",
};

function ApplicationStatusBadge({ status = "pending" }) {
  const normalized = String(status || "pending").toLowerCase();
  const label = STATUS_LABELS[normalized] || normalized.replace(/_/g, " ");

  return <span className={`app-status-badge ${normalized}`}>{label}</span>;
}

export default ApplicationStatusBadge;



