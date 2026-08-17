import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import { normaliseOpportunityList } from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import { getApiErrorMessage, requestJson } from "../../api/http";
import "./css/opportunities.css";

function SavedOpportunities() {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadSaved() {
      try {
        const data = await requestJson("/api/opportunities/saved", { signal: controller.signal });
        setOpportunities(normaliseOpportunityList(data));
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "aborted") return;
        setPageError(getApiErrorMessage(error, "Failed to load saved opportunities"));
      } finally {
        setLoading(false);
      }
    }

    void loadSaved();
    return () => controller.abort();
  }, []);

  const handleToggleSave = async (opportunity) => {
    const previous = opportunities;
    setActionError("");
    setOpportunities((current) => current.filter((item) => item.id !== opportunity.id));

    try {
      await requestJson(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: "DELETE",
      });
    } catch (error) {
      setOpportunities(previous);
      setActionError(getApiErrorMessage(error, "Failed to remove saved opportunity"));
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading saved opportunities"
        message="Retrieving the opportunities you bookmarked."
      />
    );
  }

  if (pageError) {
    return (
      <PageState
        variant="error"
        title="Saved opportunities"
        message={pageError}
        actionLabel="Back to discovery"
        onAction={() => window.location.assign("/opportunities")}
      />
    );
  }

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Saved</div>
        <h1 className="opp-page-title">Saved opportunities</h1>
        <p className="opp-page-subtitle">
          Keep track of opportunities you want to revisit later. Remove anything you no longer need.
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

      <div className="opp-toolbar">
        <p className="opp-toolbar-meta">
          {opportunities.length} {opportunities.length === 1 ? "saved opportunity" : "saved opportunities"}
        </p>
        <Link to="/opportunities" className="opp-link">
          Browse more
        </Link>
      </div>

      {opportunities.length === 0 ? (
        <PageState
          variant="empty"
          title="Nothing saved yet"
          message="Bookmark opportunities from discovery or detail pages to keep them here."
          actionLabel="Browse opportunities"
          onAction={() => window.location.assign("/opportunities")}
        />
      ) : (
        <div className="opp-list">
          {opportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              saved
              onToggleSave={handleToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SavedOpportunities;
