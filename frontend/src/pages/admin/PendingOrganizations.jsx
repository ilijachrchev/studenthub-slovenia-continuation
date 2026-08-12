import { useCallback, useEffect, useState } from "react";
import PendingOrgCard from "../../components/admin/PendingOrgCard";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./css/PendingOrganizations.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

function PendingOrganizations() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadPending = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/organizations/pending", { credentials: "include" });
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data.error || "Failed to load pending organizations");
      }

      const data = await safeJson(res);
      setOrganizations(data.organizations || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        await loadPending();
      } catch (err) {
        if (alive) {
          setError(err.message || "Something went wrong. Please try again.");
        }
      }
    }
    init();

    return () => {
      alive = false;
    };
  }, [loadPending]);

  const handleApprove = async (id) => {
    setError("");
    setActionError("");
    setSuccessMessage("");
    try {
      const res = await fetch(`/api/admin/organizations/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await safeJson(res);
        setActionError(data.error || "Failed to approve organization");
        return;
      }
      setSuccessMessage("Organization approved.");
      await loadPending();
    } catch {
      setActionError("Something went wrong. Please try again.");
    }
  };

  const handleReject = async (id) => {
    setError("");
    setActionError("");
    setSuccessMessage("");
    try {
      const res = await fetch(`/api/admin/organizations/${id}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await safeJson(res);
        setActionError(data.error || "Failed to reject organization.");
        return;
      }
      setSuccessMessage("Organization rejected.");
      await loadPending();
    } catch {
      setActionError("Something went wrong. Please try again.");
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading pending organizations"
        message="Fetching organizations awaiting review."
      />
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Pending Organizations"
        message={error}
        actionLabel="Retry"
        onAction={loadPending}
      />
    );
  }

  return (
    <div className="pending-organizations">
      <div className="pending-header">
        <h1>Pending Organizations</h1>
        <p className="pending-subtitle">
          {organizations.length} application{organizations.length === 1 ? "" : "s"}
        </p>
      </div>

      {actionError && (
        <InlineState
          variant="error"
          message={actionError}
          actionLabel="Dismiss"
          onAction={() => setActionError("")}
        />
      )}

      {successMessage && (
        <InlineState
          variant="success"
          message={successMessage}
          actionLabel="Dismiss"
          onAction={() => setSuccessMessage("")}
        />
      )}

      {organizations.length === 0 ? (
        <PageState
          variant="empty"
          title="Nothing to review"
          message="There are no pending organizations right now."
        />
      ) : (
        <div className="pending-list">
          {organizations.map((org) => (
            <PendingOrgCard
              key={org.id}
              organization={org}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PendingOrganizations;
