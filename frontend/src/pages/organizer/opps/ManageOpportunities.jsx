import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import OrganizerLayout from "../../../components/layout/OrganizerLayout";
import OpportunityCard from "../../../components/organizer/opps/OpportunityCard";
import OpportunityForm from "../../../components/organizer/opps/OpportunityForm";
import StatusBadge from "../../../components/shared/StatusBadge";
import "./ManageOpportunities.css";
import { apiRequest } from "../../../lib/api";

const EMPTY_OPPORTUNITY = null;

function normalizeOpportunity(opportunity) {
  return {
    ...opportunity,
    tags: Array.isArray(opportunity.tags)
      ? opportunity.tags
      : typeof opportunity.tags === "string"
        ? opportunity.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
  };
}

function ManageOpportunities() {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] = useState(EMPTY_OPPORTUNITY);

  const loadOpportunities = useCallback(async () => {
    const data = await apiRequest("/api/organizer/opportunities");
    setOpportunities((data.opportunities || data.items || []).map(normalizeOpportunity));
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        await loadOpportunities();
      } catch (err) {
        if (!ignore) setError(err.message || "Something went wrong.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [loadOpportunities]);

  const sortedOpportunities = useMemo(
    () =>
      [...opportunities].sort((a, b) => {
        const left = new Date(a.updated_at || a.created_at || 0).getTime();
        const right = new Date(b.updated_at || b.created_at || 0).getTime();
        return right - left;
      }),
    [opportunities],
  );

  const resetForm = () => {
    setSelectedOpportunity(EMPTY_OPPORTUNITY);
    setActionError("");
  };

  const saveOpportunity = async (payload) => {
    setSaving(true);
    setActionError("");
    try {
      const isEdit = Boolean(selectedOpportunity?.id);
      await apiRequest(isEdit ? `/api/organizer/opportunities/${selectedOpportunity.id}` : "/api/organizer/opportunities", {
        method: isEdit ? "PATCH" : "POST",
        body: payload,
      });
      await loadOpportunities();
      resetForm();
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (opportunity, endpoint, method = "POST") => {
    setActionError("");
    try {
      await apiRequest(`/api/organizer/opportunities/${opportunity.id}/${endpoint}`, {
        method,
      });
      await loadOpportunities();
    } catch {
      setActionError("Something went wrong. Please try again.");
    }
  };

  const handleEdit = (opportunity) => {
    setSelectedOpportunity(opportunity);
    setActionError("");
  };

  const handleSubmit = async (opportunity) => {
    const confirmed = window.confirm(`Submit "${opportunity.title}" for review?`);
    if (!confirmed) return;
    await runAction(opportunity, "submit");
  };

  const handleClose = async (opportunity) => {
    const confirmed = window.confirm(`Close "${opportunity.title}"? Applicants will no longer be able to apply.`);
    if (!confirmed) return;
    await runAction(opportunity, "close");
  };

  const handleArchive = async (opportunity) => {
    const confirmed = window.confirm(`Archive "${opportunity.title}"? This hides it from active views.`);
    if (!confirmed) return;
    await runAction(opportunity, "archive");
  };

  if (loading) {
    return <p className="opp-status" role="status">Loading opportunities...</p>;
  }

  if (error) {
    return (
      <section className="opp-empty-state" role="alert">
        <h1>Manage Opportunities</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <OrganizerLayout>
      <div className="manage-opps-page">
      <header className="manage-opps-header">
        <div>
          <h1>Manage Opportunities</h1>
          <p>Draft, submit, close, and archive every opportunity you own.</p>
        </div>
        <button type="button" className="btn-primary btn-primary-inline" onClick={() => navigate("/organizer/opportunities/applicants")}>
          Open applicants
        </button>
      </header>

      {actionError && (
        <div className="opp-inline-error" role="alert">
          {actionError}
        </div>
      )}

      <div className="manage-opps-grid">
        <OpportunityForm
          key={selectedOpportunity?.id || "new"}
          opportunity={selectedOpportunity}
          onSubmit={saveOpportunity}
          onCancel={resetForm}
          saving={saving}
          serverError={actionError}
        />

        <section className="opp-list-panel" aria-labelledby="owned-opps-title">
          <div className="opp-list-header">
            <div>
              <h2 id="owned-opps-title">Owned opportunities</h2>
              <p>{sortedOpportunities.length} total</p>
            </div>
            <StatusBadge status="all" label="All statuses" />
          </div>

          {sortedOpportunities.length === 0 ? (
            <div className="opp-empty-list">
              <p>No opportunities yet.</p>
            </div>
          ) : (
            <div className="opp-card-list">
              {sortedOpportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  onEdit={handleEdit}
                  onSubmit={handleSubmit}
                  onClose={handleClose}
                  onArchive={handleArchive}
                  onViewApplicants={(item) => navigate(`/organizer/opportunities/${item.id}/applicants`)}
                  onViewAnalytics={(item) => navigate(`/organizer/opportunities/${item.id}/analytics`)}
                  busy={saving}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      </div>
    </OrganizerLayout>
  );
}

export default ManageOpportunities;
