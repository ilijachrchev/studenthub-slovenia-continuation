import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import {
  dispatchAnalytics,
  formatDateTime,
  isPastDate,
  normaliseOpportunity,
  normaliseOpportunityList,
} from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import { getApiErrorMessage, requestJson } from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import "./css/opportunities.css";

function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [opportunity, setOpportunity] = useState(null);
  const [related, setRelated] = useState([]);
  const [coverNote, setCoverNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadOpportunity = useCallback(
    async (signal) => {
      setLoading(true);
      setPageError("");
      setActionError("");
      setActionMessage("");

      try {
        const [detailData, relatedData] = await Promise.all([
          requestJson(`/api/opportunities/${id}`, { signal }),
          requestJson(`/api/opportunities/${id}/related`, { signal }).catch((error) => {
            if (error?.status === 404) return { items: [] };
            throw error;
          }),
        ]);

        const item = normaliseOpportunity(detailData.opportunity || detailData);
        setOpportunity(item);
        setRelated(normaliseOpportunityList(relatedData).slice(0, 3));
        dispatchAnalytics("opportunity_view", {
          opportunityId: item.id,
          title: item.title,
        });
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "aborted") return;
        setPageError(getApiErrorMessage(error, "Failed to load opportunity"));
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void loadOpportunity(controller.signal);
    });
    return () => controller.abort();
  }, [loadOpportunity]);

  const deadlinePassed = useMemo(() => isPastDate(opportunity?.deadline), [opportunity]);
  const application = opportunity?.application || null;
  const applicationHistory = Array.isArray(application?.history)
    ? application.history.map((entry) => ({
        ...entry,
        status: entry.status || entry.to_status || entry.state || "",
        at: entry.at || entry.created_at || entry.timestamp || entry.date || null,
        note: entry.note || entry.message || entry.reason || "",
      }))
    : [];
  const applicationStatus = application?.status || opportunity?.applicationStatus || "";
  const alreadyApplied = Boolean(applicationStatus && applicationStatus !== "not_applied");
  const opportunityOpen = opportunity?.status === "published" && !deadlinePassed;

  const saveOpportunity = async () => {
    if (!opportunity) return;

    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
      return;
    }

    const nextSaved = !opportunity.bookmarked;
    setSaving(true);
    setActionError("");
    setActionMessage("");
    setOpportunity((current) => (current ? { ...current, bookmarked: nextSaved } : current));

    try {
      await requestJson(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: nextSaved ? "POST" : "DELETE",
      });
      setActionMessage(nextSaved ? "Opportunity saved." : "Opportunity removed from saved.");
    } catch (error) {
      setOpportunity((current) => (current ? { ...current, bookmarked: !nextSaved } : current));
      setActionError(getApiErrorMessage(error, "Failed to update saved opportunity"));
    } finally {
      setSaving(false);
    }
  };

  const applyOpportunity = async (event) => {
    event.preventDefault();
    if (!opportunity) return;

    if (authLoading) return;

    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
      return;
    }

    if (!opportunityOpen) {
      setActionError("This opportunity is no longer accepting applications.");
      return;
    }

    if (alreadyApplied) {
      setActionError("You have already applied for this opportunity.");
      return;
    }

    setApplying(true);
    setActionError("");
    setActionMessage("");

    try {
      const data = await requestJson(`/api/applications/${opportunity.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_note: coverNote, coverNote }),
      });

      setActionMessage(data.message || "Application submitted.");
      setCoverNote("");
      await loadOpportunity();
    } catch (error) {
      if (error?.status === 409) {
        setActionError("You have already applied for this opportunity.");
        await loadOpportunity();
      } else if (error?.status === 401 || error?.status === 403) {
        navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
      } else {
        setActionError(getApiErrorMessage(error, "Failed to submit application"));
      }
    } finally {
      setApplying(false);
    }
  };

  const withdrawOpportunity = async () => {
    if (!application) return;

    const confirmed = window.confirm(
      `Withdraw your application for "${opportunity?.title || "this opportunity"}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setActionError("");
    setActionMessage("");

    try {
      const data = await requestJson(`/api/applications/${opportunity.id}/apply`, {
        method: "DELETE",
      });
      setActionMessage(data.message || "Application withdrawn.");
      await loadOpportunity();
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Failed to withdraw your application"));
    }
  };

  if (loading && !opportunity) {
    return (
      <PageState
        variant="loading"
        title="Loading opportunity"
        message="Fetching the latest details and your application state."
      />
    );
  }

  if (pageError && !opportunity) {
    return (
      <PageState
        variant="error"
        title="Opportunity details"
        message={pageError}
        actionLabel="Retry"
        onAction={() => loadOpportunity()}
      />
    );
  }

  if (!opportunity) {
    return null;
  }

  return (
    <div className="opp-page opp-detail">
      <Link to="/opportunities" className="opp-back">
        ← Back to discovery
      </Link>

      <article className="opp-detail-card">
        <div className="opp-detail-head">
          <div>
            <div className="opp-chip-row" style={{ marginBottom: 10 }}>
              <span className="opp-chip status">{String(opportunity.status || "published").replace(/_/g, " ")}</span>
              {opportunity.organizationName && <span className="opp-chip">{opportunity.organizationName}</span>}
            </div>

            <h1 className="opp-detail-title">{opportunity.title}</h1>
            <p className="opp-org">
              by{" "}
              {opportunity.organizationId ? (
                <Link to={`/organizations/${opportunity.organizationId}`} className="opp-link">
                  {opportunity.organizationName}
                </Link>
              ) : (
                opportunity.organizationName || "Independent"
              )}
            </p>
          </div>

          <div className="opp-card-actions">
            <button type="button" className="opp-secondary-btn" onClick={saveOpportunity} disabled={saving}>
              {opportunity.bookmarked ? "Saved" : "Save"}
            </button>
            {opportunity.organizationWebsite ? (
              <a
                className="opp-secondary-btn"
                href={opportunity.organizationWebsite}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  dispatchAnalytics("opportunity_organization_clicked", {
                    opportunityId: opportunity.id,
                    title: opportunity.title,
                  });
                }}
              >
                Organization
              </a>
            ) : (
              <Link to={`/organizations/${opportunity.organizationId}`} className="opp-secondary-btn">
                Organization
              </Link>
            )}
          </div>
        </div>

        <div className="opp-detail-meta">
          <span>Location: {opportunity.location || "TBA"}</span>
          <span>Deadline: {formatDateTime(opportunity.deadline)}</span>
          <span>Published: {formatDateTime(opportunity.publishedAt)}</span>
          {applicationStatus && <ApplicationStatusBadge status={applicationStatus} />}
        </div>

        <section className="opp-detail-section">
          <h2>Description</h2>
          <p className="opp-detail-desc">{opportunity.description || "No description has been provided yet."}</p>
        </section>

        <section className="opp-detail-section">
          <h2>Requirements</h2>
          {opportunity.requirements ? (
            <p className="opp-detail-desc">{opportunity.requirements}</p>
          ) : (
            <p className="opp-detail-desc">The organization has not listed specific requirements.</p>
          )}
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

        <section className="opp-detail-section opp-panel">
          <h2>Apply</h2>
          {alreadyApplied ? (
            <div className="opp-actions">
              <ApplicationStatusBadge status={applicationStatus} />
              <span className="opp-page-status" style={{ padding: 0 }}>
                You have already applied for this opportunity.
              </span>
              {applicationHistory.length > 0 && (
                <span className="opp-toolbar-meta">
                  Status history available below.
                </span>
              )}
              {applicationStatus && ["pending", "submitted", "under_review", "in_review", "shortlisted"].includes(String(applicationStatus).toLowerCase()) && (
                <button type="button" className="opp-secondary-btn" onClick={withdrawOpportunity}>
                  Withdraw application
                </button>
              )}
            </div>
          ) : !opportunityOpen ? (
            <p className="opp-page-status" style={{ padding: 0 }}>
              This opportunity is no longer accepting applications.
            </p>
          ) : (
            <form className="opp-apply-form" onSubmit={applyOpportunity}>
              <label className="opp-field">
                <span>Cover note</span>
                <textarea
                  className="opp-detail-note"
                  value={coverNote}
                  onChange={(event) => setCoverNote(event.target.value)}
                  placeholder="Tell the organization why you're interested, what you can contribute, or any relevant experience."
                  maxLength={2000}
                  aria-describedby="cover-note-help"
                />
              </label>

              <p id="cover-note-help" className="opp-toolbar-meta">
                Keep it concise. The note is optional, but useful for context.
              </p>

              <div className="opp-actions">
                <button type="submit" className="opp-primary-btn" disabled={applying}>
                  {applying ? "Submitting..." : "Apply"}
                </button>
                <button
                  type="button"
                  className="opp-secondary-btn"
                  onClick={() => setCoverNote("")}
                  disabled={applying}
                >
                  Clear note
                </button>
              </div>
            </form>
          )}
        </section>

        {applicationHistory.length > 0 && (
          <section className="opp-detail-section">
            <h2>Application history</h2>
            <ol className="opp-timeline">
              {applicationHistory.map((entry, index) => (
                <li key={`${application.id}-${index}`} className="opp-timeline-item">
                  <div className="opp-timeline-title">
                    <ApplicationStatusBadge status={entry.status} />
                    <span>{entry.action || entry.status || "update"}</span>
                    {entry.at && <span>{formatDateTime(entry.at)}</span>}
                  </div>
                  {(entry.from_status || entry.note) && (
                    <p className="opp-timeline-note">
                      {entry.from_status ? `From ${entry.from_status} to ${entry.status}. ` : ""}
                      {entry.note || ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>

      <section className="opp-panel">
        <h2>More from this organizer</h2>
        {related.length === 0 ? (
          <p className="opp-page-status" style={{ padding: 0 }}>
            No related opportunities are available right now.
          </p>
        ) : (
          <div className="opp-list">
            {related.map((item) => (
              <OpportunityCard key={item.id} opportunity={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default OpportunityDetail;
