import { useEffect, useState } from "react";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import { normaliseOpportunityList } from "../../components/opportunities/opportunitiesUtils";
import "./css/opportunities.css";
import { apiRequest } from "../../lib/api";

function SavedOpportunities() {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function loadSaved() {
      try {
        const data = await apiRequest("/api/opportunities/saved", { signal: controller.signal });
        if (!alive) return;
        setOpportunities(normaliseOpportunityList(data));
      } catch (error) {
        if (error?.code === "aborted") return;
        if (alive) setError("Failed to load saved opportunities");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadSaved();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const handleToggleSave = async (opportunity) => {
    const previous = opportunities;
    setOpportunities((current) => current.filter((item) => item.id !== opportunity.id));

    try {
      await apiRequest(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: "DELETE",
      });
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

