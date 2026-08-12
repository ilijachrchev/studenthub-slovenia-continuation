const STATUS_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  pending: "Pending",
  open: "Open",
  in_review: "In review",
  review: "In review",
  accepted: "Accepted",
  rejected: "Rejected",
  closed: "Closed",
  archived: "Archived",
  resolved: "Resolved",
  dismissed: "Dismissed",
  published: "Published",
  cancelled: "Cancelled",
};

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function StatusBadge({ status, label, className = "" }) {
  const normalized = normalizeStatus(status);
  const text = label || STATUS_LABELS[normalized] || (status ? String(status) : "Unknown");

  return (
    <span className={`status-badge status-${normalized || "unknown"} ${className}`.trim()}>
      {text}
    </span>
  );
}

export default StatusBadge;
