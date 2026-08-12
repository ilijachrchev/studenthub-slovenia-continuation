import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import {
  formatDateTime,
  normaliseApplication,
  toArray,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import "./css/opportunities.css";

function MyApplications() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadApplications() {
      try {
        const response = await fetch("/api/opportunities/applications", {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));

        if (!alive) return;

        if (!response.ok) {
          setError(unwrapMessage(data, "Failed to load your applications"));
          return;
        }

        setApplications(toArray(data.applications || data.items || data).map(normaliseApplication));
      } catch {
        if (alive) setError("Failed to load your applications");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadApplications();

    return () => {
      alive = false;
    };
  }, []);

  const withdrawApplication = async (application) => {
    const confirmed = window.confirm(
      `Withdraw your application for "${application.title}"? This cannot be undone.`
    );
    if (!confirmed) return;

    const previous = applications;
    setApplications((current) =>
      current.map((item) =>
        item.id === application.id ? { ...item, status: "withdrawn" } : item
      )
    );

    try {
      const response = await fetch(`/api/opportunities/${application.opportunityId}/apply`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("withdraw-failed");
      }
    } catch {
      setApplications(previous);
    }
  };

  if (loading) {
    return <p className="opp-page-status">Loading your applications...</p>;
  }

  if (error) {
    return <p className="opp-page-status error-text">{error}</p>;
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

      {applications.length === 0 ? (
        <div className="opp-empty">
          You have not applied to any opportunities yet. <Link to="/opportunities">Browse opportunities</Link>
        </div>
      ) : (
        <div className="opp-list">
          {applications.map((application) => {
            const canWithdraw = ["pending", "submitted", "under_review", "in_review"].includes(
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


