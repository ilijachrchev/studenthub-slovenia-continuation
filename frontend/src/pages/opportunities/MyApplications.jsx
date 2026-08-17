import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import {
  formatDateTime,
  normaliseApplication,
  toArray,
} from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import { getApiErrorMessage, requestJson } from "../../api/http";
import "./css/opportunities.css";

function MyApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [withdrawingIds, setWithdrawingIds] = useState(() => new Set());

  useEffect(() => {
    const controller = new AbortController();

    async function loadApplications() {
      try {
        const data = await requestJson("/api/applications/mine", { signal: controller.signal });
        setApplications(toArray(data.applications || data.items || data).map(normaliseApplication));
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "aborted") return;
        setPageError(getApiErrorMessage(error, "Failed to load your applications"));
      } finally {
        setLoading(false);
      }
    }

    void loadApplications();
    return () => controller.abort();
  }, []);

  const withdrawApplication = async (application) => {
    const confirmed = window.confirm(
      `Withdraw your application for "${application.title}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setActionError("");
    setActionMessage("");
    setWithdrawingIds((current) => new Set(current).add(application.id));

    const previous = applications;
    setApplications((current) =>
      current.map((item) =>
        item.id === application.id ? { ...item, status: "withdrawn" } : item
      )
    );

    try {
      const data = await requestJson(`/api/applications/${application.opportunityId}/apply`, {
        method: "DELETE",
      });

      setActionMessage(data.message || "Application withdrawn.");
      await requestJson("/api/applications/mine").then((next) => {
        setApplications(
          toArray(next.applications || next.items || next).map(normaliseApplication)
        );
      });
    } catch (error) {
      setApplications(previous);
      setActionError(getApiErrorMessage(error, "Failed to withdraw your application"));
    } finally {
      setWithdrawingIds((current) => {
        const next = new Set(current);
        next.delete(application.id);
        return next;
      });
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
        onAction={() => window.location.reload()}
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

      <div className="opp-toolbar">
        <p className="opp-toolbar-meta">
          {applications.length} {applications.length === 1 ? "application" : "applications"}
        </p>
        <Link to="/opportunities" className="opp-link">
          Browse opportunities
        </Link>
      </div>

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
            const canWithdraw = ["pending", "submitted", "under_review", "in_review", "shortlisted"].includes(
              String(application.status).toLowerCase()
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

                <section className="opp-detail-section">
                  <h2>Summary</h2>
                  <p className="opp-detail-desc">
                    {application.opportunity?.description || "No summary is available for this application."}
                  </p>
                </section>

                {application.history.length > 0 && (
                  <section className="opp-detail-section">
                    <h2>History</h2>
                    <ol className="opp-timeline">
                      {application.history.map((entry, index) => (
                        <li key={`${application.id}-${index}`} className="opp-timeline-item">
                          <div className="opp-timeline-title">
                            <ApplicationStatusBadge status={entry.status || entry.to_status} />
                            <span>{entry.action || entry.status || "update"}</span>
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
                      disabled={withdrawingIds.has(application.id)}
                    >
                      {withdrawingIds.has(application.id) ? "Withdrawing..." : "Withdraw"}
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
