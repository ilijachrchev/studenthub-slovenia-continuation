import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import { normaliseOpportunityList, unwrapMessage } from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./css/opportunities.css";

async function safeJson(response) {
  return response.json().catch(() => ({}));
}

function SavedOpportunities() {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadSaved = useCallback(async () => {
    setLoading(true);
    setPageError("");
    setActionError("");
    setActionMessage("");

    try {
      const response = await fetch("/api/opportunities/saved", {
        credentials: "include",
      });
      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(unwrapMessage(data, "Failed to load saved opportunities"));
      }

      setOpportunities(normaliseOpportunityList(data));
    } catch (err) {
      setPageError(err.message || "Failed to load saved opportunities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSaved();
    });
  }, [loadSaved]);

  const handleToggleSave = async (opportunity) => {
    const previous = opportunities;
    setActionError("");
    setActionMessage("");
    setOpportunities((current) => current.filter((item) => item.id !== opportunity.id));

    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(unwrapMessage(data, "Failed to update saved opportunities"));
      }

      setActionMessage("Opportunity removed from saved.");
    } catch (err) {
      setOpportunities(previous);
      setActionError(err.message || "Failed to update saved opportunities");
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading saved opportunities"
        message="Fetching your bookmarked opportunities."
      />
    );
  }

  if (pageError) {
    return (
      <PageState
        variant="error"
        title="Saved opportunities"
        message={pageError}
        actionLabel="Retry"
        onAction={loadSaved}
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

      {actionMessage && (
        <InlineState
          variant="success"
          message={actionMessage}
          actionLabel="Dismiss"
          onAction={() => setActionMessage("")}
        />
      )}

      {opportunities.length === 0 ? (
        <PageState
          variant="empty"
          title="No saved opportunities"
          message="You have not saved any opportunities yet."
          actionLabel="Browse opportunities"
          onAction={() => navigate("/opportunities")}
          secondaryActionLabel="View applications"
          onSecondaryAction={() => navigate("/my-applications")}
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
