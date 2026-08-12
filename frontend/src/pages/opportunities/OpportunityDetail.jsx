import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import {
  dispatchAnalytics,
  formatDateTime,
  isPastDate,
  normaliseOpportunity,
  normaliseOpportunityList,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import { useAuth } from "../../context/AuthContext";
import "./css/opportunities.css";

function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [opportunity, setOpportunity] = useState(null);
  const [related, setRelated] = useState([]);
  const [coverNote, setCoverNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saved, setSaved] = useState(false);
  const [applyState, setApplyState] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadOpportunity() {
      try {
        const [detailRes, relatedRes, savedRes] = await Promise.all([
          fetch(`/api/opportunities/${id}`, { credentials: "include" }),
          fetch(`/api/opportunities/${id}/related`, { credentials: "include" }),
          fetch("/api/opportunities/saved/ids", { credentials: "include" }),
        ]);

        const detailData = await detailRes.json().catch(() => ({}));
        const relatedData = await relatedRes.json().catch(() => ({}));
        const savedData = await savedRes.json().catch(() => ({}));

        if (!alive) return;

        if (!detailRes.ok) {
          setError(unwrapMessage(detailData, "Failed to load opportunity"));
          return;
        }

        const item = normaliseOpportunity(detailData.opportunity ?? detailData);
        setOpportunity(item);
        setRelated(normaliseOpportunityList(relatedData).slice(0, 3));
        setSaved(
          Array.isArray(savedData)
            ? savedData.some((savedId) => String(savedId) === String(item.id))
            : (savedData.ids || []).some((savedId) => String(savedId) === String(item.id))
        );
        setApplyState(item.applicationStatus || item.application?.status || "");
        dispatchAnalytics("opportunity_view", {
          opportunityId: item.id,
          title: item.title,
        });
      } catch {
        if (alive) setError("Failed to load opportunity");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadOpportunity();

    return () => {
      alive = false;
    };
  }, [id]);

  const deadlinePassed = useMemo(() => isPastDate(opportunity?.deadline), [opportunity]);
  const alreadyApplied = Boolean(applyState && applyState !== "not_applied");

  const saveOpportunity = async () => {
    if (!opportunity) return;
    const nextSaved = !saved;
    setSaved(nextSaved);
    dispatchAnalytics(nextSaved ? "opportunity_saved" : "opportunity_unsaved", {
      opportunityId: opportunity.id,
      title: opportunity.title,
    });

    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: nextSaved ? "POST" : "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("save-failed");
      }
    } catch {
      setSaved(!nextSaved);
    }
  };

  const reportOpportunity = opportunity
    ? opportunity.reportUrl ||
      `mailto:studenthub@example.com?subject=${encodeURIComponent(
        `Report opportunity: ${opportunity.title}`
      )}`
    : "#";

  const applyOpportunity = async (event) => {
    event.preventDefault();
    if (!opportunity) return;

    if (authLoading) return;

    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
      return;
    }

    if (deadlinePassed) {
      setError("The application deadline has passed.");
      return;
    }

    if (alreadyApplied) {
      setError("You have already applied for this opportunity.");
      return;
    }

    setApplying(true);
    setError("");

    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cover_note: coverNote, coverNote }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
        return;
      }

      if (response.status === 409 || data.alreadyApplied) {
        setApplyState("applied");
        setError("You have already applied for this opportunity.");
        return;
      }

      if (!response.ok) {
        setError(unwrapMessage(data, "Failed to submit application"));
        return;
      }

      setApplyState(data.status || "submitted");
      dispatchAnalytics("opportunity_applied", {
        opportunityId: opportunity.id,
        title: opportunity.title,
      });
    } catch {
      setError("Failed to submit application");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <p className="opp-page-status">Loading opportunity...</p>;
  if (error && !opportunity) return <p className="opp-page-status error-text">{error}</p>;
  if (!opportunity) return null;

  return (
    <div className="opp-page opp-detail">
      <Link to="/opportunities" className="opp-back">
        ← Back to discovery
      </Link>

      <article className="opp-detail-card">
        <div className="opp-detail-head">
          <div>
            <div className="opp-chip-row" style={{ marginBottom: 10 }}>
              {opportunity.category?.name && (
                <span className="opp-chip">{opportunity.category.name}</span>
              )}
              {opportunity.remote && <span className="opp-chip muted">Remote</span>}
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
            <button type="button" className="opp-secondary-btn" onClick={saveOpportunity}>
              {saved ? "Saved" : "Save"}
            </button>
            <a className="opp-secondary-btn" href={reportOpportunity} onClick={() => {
              dispatchAnalytics("opportunity_report_clicked", {
                opportunityId: opportunity.id,
                title: opportunity.title,
              });
            }}>
              Report
            </a>
          </div>
        </div>

        <div className="opp-detail-meta">
          <span>Location: {opportunity.location}</span>
          <span>Deadline: {formatDateTime(opportunity.deadline)}</span>
          {opportunity.application?.status && (
            <ApplicationStatusBadge status={opportunity.application.status} />
          )}
        </div>

        {opportunity.tags.length > 0 && (
          <div className="opp-tags">
            {opportunity.tags.map((tag) => (
              <span key={tag.id ?? tag.name} className="opp-tag">
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <section className="opp-detail-section">
          <h2>About this opportunity</h2>
          <p className="opp-detail-desc">{opportunity.description}</p>
        </section>

        <div className="opp-detail-links">
          {opportunity.organizationId && (
            <Link to={`/organizations/${opportunity.organizationId}`} className="opp-link">
              View organization
            </Link>
          )}
          {opportunity.organizationWebsite && (
            <a className="opp-link" href={opportunity.organizationWebsite} target="_blank" rel="noreferrer">
              Organization website
            </a>
          )}
        </div>

        {error && <p className="opp-page-status error-text">{error}</p>}

        <section className="opp-detail-section opp-panel">
          <h2>Apply</h2>
          {alreadyApplied ? (
            <div className="opp-actions">
              <ApplicationStatusBadge status={applyState} />
              <span className="opp-page-status" style={{ padding: 0 }}>
                You have already applied for this opportunity.
              </span>
            </div>
          ) : deadlinePassed ? (
            <p className="opp-page-status" style={{ padding: 0 }}>
              The application deadline has passed.
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
                />
              </label>

              <div className="opp-actions">
                <button type="submit" className="opp-primary-btn" disabled={applying}>
                  {applying ? "Submitting..." : "Apply"}
                </button>
                <button
                  type="button"
                  className="opp-secondary-btn"
                  onClick={() => setCoverNote("")}
                >
                  Clear note
                </button>
              </div>
            </form>
          )}
        </section>
      </article>

      <section className="opp-panel">
        <h2>Recommendation</h2>
        <p className="opp-page-status" style={{ padding: 0 }}>
          {opportunity.primary_reason || "This opportunity matches your profile and interests."}
        </p>
      </section>

      {related.length > 0 && (
        <section className="opp-panel">
          <h2>More like this</h2>
          <div className="opp-list">
            {related.map((item) => (
              <OpportunityCard key={item.id} opportunity={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default OpportunityDetail;
