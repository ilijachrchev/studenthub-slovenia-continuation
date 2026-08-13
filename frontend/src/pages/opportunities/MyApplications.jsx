import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import {
  formatDateTime,
  normaliseApplication,
  toArray,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./css/opportunities.css";

async function safeJson(response) {
  return response.json().catch(() => ({}));
}

function MyApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setPageError("");
    setActionError("");
    setActionMessage("");

    try {
      const response = await fetch("/api/opportunities/applications", {
        credentials: "include",
      });
      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(unwrapMessage(data, "Failed to load your applications"));
      }

      setApplications(toArray(data.applications || data.items || data).map(normaliseApplication));
    } catch (err) {
      setPageError(err.message || "Failed to load your applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadApplications();
    });
  }, [loadApplications]);

  const withdrawApplication = async (application) => {
    const confirmed = window.confirm(
      `Withdraw your application for "${application.title}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    const previous = applications;
    setActionError("");
    setActionMessage("");
    setApplications((current) =>
      current.map((item) =>
        item.id === application.id ? { ...item, status: "withdrawn" } : item,
      ),
    );

    try {
      const response = await fetch(`/api/opportunities/${application.opportunityId}/apply`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(unwrapMessage(data, "Failed to withdraw your application"));
      }

      setActionMessage("Application withdrawn.");
    } catch (err) {
      setApplications(previous);
      setActionError(err.message || "Failed to withdraw your application");
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading your applications"
        message="Fetching application history and status updates."
      />
    );
  }

  if (pageError) {
    return (
      <PageState
        variant="error"
        title="My applications"
        message={pageError}
        actionLabel="Retry"
        onAction={loadApplications}
      />
    );
  }

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Applications</div>
        <h1 className="opp-page-title">My applications</h1>
        <p className="opp-page-subtitle">
          Track every opportunity you applied to, review the status history, and withdraw pending
          submissions when needed.
        </p>
      </section>

      {actionError && (
        <InlineState
          variant="error"
          message={actionError}
          actionLabel="Dismiss"
          onAction={() => setActionError("")}
        />
      )}

      {actionMessage && (
        <InlineState
          variant="success"
          message={actionMessage}
          actionLabel="Dismiss"
          onAction={() => setActionMessage("")}
        />
      )}

      {applications.length === 0 ? (
        <PageState
          variant="empty"
          title="No applications yet"
          message="You have not applied to any opportunities yet."
          actionLabel="Browse opportunities"
          onAction={() => navigate("/opportunities")}
        />
      ) : (
        <div className="opp-list">
          {applications.map((application) => {
            const canWithdraw = ["pending", "submitted", "under_review", "in_review"].includes(
              String(application.status).toLowerCase(),
            );

            return (
              <article key={application.id} className="opp-panel">
                <div className="opp-detail-head">
                  <div>
                    <h2 style={{ marginBottom: 6 }}>
                      <Link to={`/opportunities/${application.opportunityId}`} className="opp-link">
                        {application.title}
                      </Link>
                    </h2>
                    <p className="opp-org">by {application.organizationName || "Unknown organization"}</p>
                  </div>

                  <ApplicationStatusBadge status={application.status} />
                </div>

                <div className="opp-detail-meta">
                  {application.appliedAt && <span>Applied: {formatDateTime(application.appliedAt)}</span>}
                  {application.deadline && <span>Deadline: {formatDateTime(application.deadline)}</span>}
                </div>

                {application.history.length > 0 && (
                  <section className="opp-detail-section">
                    <h2>History</h2>
                    <ol className="opp-timeline">
                      {application.history.map((entry, index) => (
                        <li key={`${application.id}-${index}`} className="opp-timeline-item">
                          <div className="opp-timeline-title">
                            <ApplicationStatusBadge status={entry.status} />
                            <span>{entry.status || "update"}</span>
                            {entry.at && <span>{formatDateTime(entry.at)}</span>}
                          </div>
                          {entry.note && <p className="opp-timeline-note">{entry.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                <div className="opp-actions" style={{ marginTop: 16 }}>
                  <Link to={`/opportunities/${application.opportunityId}`} className="opp-secondary-btn">
                    View opportunity
                  </Link>
                  {canWithdraw && (
                    <button
                      type="button"
                      className="opp-secondary-btn"
                      onClick={() => withdrawApplication(application)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MyApplications;
