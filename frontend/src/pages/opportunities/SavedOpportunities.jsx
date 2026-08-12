import { useEffect, useState } from "react";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import { normaliseOpportunityList, unwrapMessage } from "../../components/opportunities/opportunitiesUtils";
import "./css/opportunities.css";

function SavedOpportunities() {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadSaved() {
      try {
        const response = await fetch("/api/opportunities/saved", {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));

        if (!alive) return;

        if (!response.ok) {
          setError(unwrapMessage(data, "Failed to load saved opportunities"));
          return;
        }

        setOpportunities(normaliseOpportunityList(data));
      } catch {
        if (alive) setError("Failed to load saved opportunities");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadSaved();

    return () => {
      alive = false;
    };
  }, []);

  const handleToggleSave = async (opportunity) => {
    const previous = opportunities;
    setOpportunities((current) => current.filter((item) => item.id !== opportunity.id));

    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("save-failed");
      }
    } catch {
      setOpportunities(previous);
    }
  };

  if (loading) return <p className="opp-page-status">Loading saved opportunities...</p>;
  if (error) return <p className="opp-page-status error-text">{error}</p>;

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Saved</div>
        <h1 className="opp-page-title">Saved opportunities</h1>
        <p className="opp-page-subtitle">
          Keep track of opportunities you want to revisit later. Remove anything you no longer need.
        </p>
      </section>

      {opportunities.length === 0 ? (
        <div className="opp-empty">You have not saved any opportunities yet.</div>
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

