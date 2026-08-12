import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import OrganizerLayout from "../../../components/layout/OrganizerLayout";
import ApplicantList from "../../../components/organizer/opps/ApplicantList";
import StatusBadge from "../../../components/shared/StatusBadge";
import "./OpportunityApplicants.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

function normalizeOpportunity(opportunity) {
  return opportunity ? opportunity : null;
}

function normalizeApplicant(applicant) {
  return {
    ...applicant,
    history: Array.isArray(applicant.history) ? applicant.history : [],
  };
}

function OpportunityApplicants() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const [opportunities, setOpportunities] = useState([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(() => routeId || params.get("opportunity") || "");
  const [applicants, setApplicants] = useState([]);
  const [selectedApplicant, setSelectedApplicant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitionNote, setTransitionNote] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);

  const selectedOpportunity = useMemo(
    () => opportunities.find((item) => String(item.id) === String(selectedOpportunityId)) || null,
    [opportunities, selectedOpportunityId],
  );

  const loadOpportunities = useCallback(async () => {
    const res = await fetch("/api/organizer/opportunities", { credentials: "include" });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || "Failed to load opportunities.");
    }
    const data = await res.json();
    const items = (data.opportunities || data.items || []).map(normalizeOpportunity);
    setOpportunities(items);
    return items;
  }, []);

  const loadApplicants = useCallback(async (opportunityId) => {
    if (!opportunityId) {
      setApplicants([]);
      return;
    }
    const res = await fetch(`/api/organizer/opportunities/${opportunityId}/applicants`, { credentials: "include" });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || "Failed to load applicants.");
    }
    const data = await res.json();
    const items = (data.applicants || data.items || []).map(normalizeApplicant);
    setApplicants(items);
    setSelectedApplicant((current) => items.find((item) => String(item.id) === String(current?.id)) || items[0] || null);
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
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

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!selectedOpportunityId) return;
      try {
        await loadApplicants(selectedOpportunityId);
      } catch (err) {
        if (!ignore) setError(err.message || "Something went wrong.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [loadApplicants, selectedOpportunityId]);

  const runTransition = async () => {
    if (!pendingTransition || !selectedApplicant || !selectedOpportunityId) return;
    setTransitionBusy(true);
    setActionError("");

    const nextStatus = pendingTransition.status;
    const optimisticId = selectedApplicant.id;
    const previousApplicants = applicants;
    const optimisticApplicants = applicants.map((applicant) =>
      String(applicant.id) === String(optimisticId)
        ? { ...applicant, status: nextStatus, history: [...applicant.history, { status: nextStatus, at: new Date().toISOString(), note: transitionNote }] }
        : applicant,
    );
    setApplicants(optimisticApplicants);
    setSelectedApplicant((current) =>
      current && String(current.id) === String(optimisticId)
        ? { ...current, status: nextStatus, history: [...current.history, { status: nextStatus, at: new Date().toISOString(), note: transitionNote }] }
        : current,
    );

    try {
      const res = await fetch(
        `/api/organizer/opportunities/${selectedOpportunityId}/applicants/${selectedApplicant.id}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            status: nextStatus,
            note: transitionNote.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const data = await safeJson(res);
        setApplicants(previousApplicants);
        setSelectedApplicant(previousApplicants.find((item) => String(item.id) === String(optimisticId)) || null);
        setActionError(data.error || "Failed to update applicant status.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.applicants)) {
        setApplicants(data.applicants.map(normalizeApplicant));
      }
      setPendingTransition(null);
      setTransitionNote("");
      await loadApplicants(selectedOpportunityId);
    } catch {
      setApplicants(previousApplicants);
      setSelectedApplicant(previousApplicants.find((item) => String(item.id) === String(optimisticId)) || null);
      setActionError("Something went wrong. Please try again.");
    } finally {
      setTransitionBusy(false);
    }
  };

  const startTransition = (status) => {
    setPendingTransition({ status });
    setTransitionNote(status === "rejected" ? "" : "Reviewed via organizer dashboard.");
  };

  if (loading) {
    return <p className="opp-status" role="status">Loading applicants...</p>;
  }

  if (error) {
    return (
      <section className="opp-empty-state" role="alert">
        <h1>Applicants</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <OrganizerLayout>
      <div className="applicants-page">
      <header className="applicants-header">
        <div>
          <h1>Applicants</h1>
          <p>Review cover notes and move each applicant through the pipeline.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate("/organizer/opportunities")}>
          Back to opportunities
        </button>
      </header>

      <div className="applicants-toolbar">
        <label>
          <span>Opportunity</span>
          <select
            className="input"
            value={selectedOpportunityId}
            onChange={(event) => setSelectedOpportunityId(event.target.value)}
          >
            <option value="" disabled>
              Select an opportunity
            </option>
            {opportunities.map((opportunity) => (
              <option key={opportunity.id} value={opportunity.id}>
                {opportunity.title}
              </option>
            ))}
          </select>
        </label>
        {selectedOpportunity && <StatusBadge status={selectedOpportunity.status} />}
      </div>

      {actionError && (
        <div className="opp-inline-error" role="alert">
          {actionError}
        </div>
      )}

      <div className="applicants-grid">
        <section className="applicants-list-panel" aria-labelledby="applicant-list-title">
          <div className="panel-heading">
            <h2 id="applicant-list-title">Applicant list</h2>
            <span>{applicants.length} total</span>
          </div>
          {applicants.length === 0 ? (
            <div className="opp-empty-list">
              <p>No applicants yet for this opportunity.</p>
            </div>
          ) : (
            <ApplicantList
              applicants={applicants}
              selectedId={selectedApplicant?.id}
              onSelect={setSelectedApplicant}
            />
          )}
        </section>

        <section className="applicant-detail" aria-labelledby="applicant-detail-title">
          {selectedApplicant ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="opp-card-subtitle">{selectedApplicant.email}</p>
                  <h2 id="applicant-detail-title">{selectedApplicant.name || selectedApplicant.full_name || "Applicant details"}</h2>
                </div>
                <StatusBadge status={selectedApplicant.status} />
              </div>

              <div className="applicant-detail-block">
                <h3>Cover note</h3>
                <p>{selectedApplicant.cover_note || selectedApplicant.message || "No cover note provided."}</p>
              </div>

              <div className="applicant-detail-block">
                <h3>History</h3>
                {selectedApplicant.history.length === 0 ? (
                  <p>No status history yet.</p>
                ) : (
                  <ul className="history-list">
                    {selectedApplicant.history.map((entry, index) => (
                      <li key={`${entry.status}-${index}`}>
                        <strong>{entry.status}</strong>
                        <span>{entry.at ? new Date(entry.at).toLocaleString() : "Unknown time"}</span>
                        {entry.note && <p>{entry.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {pendingTransition ? (
                <div className="transition-confirm" role="status" aria-live="polite">
                  <p>
                    Confirm moving this applicant to <strong>{pendingTransition.status}</strong>.
                  </p>
                  {pendingTransition.status === "rejected" && (
                    <label>
                      <span>Rejection note</span>
                      <textarea
                        className="input"
                        rows={4}
                        value={transitionNote}
                        onChange={(event) => setTransitionNote(event.target.value)}
                        placeholder="Explain the reason for rejection"
                      />
                    </label>
                  )}
                  {pendingTransition.status !== "rejected" && (
                    <label>
                      <span>Optional note</span>
                      <input
                        className="input"
                        value={transitionNote}
                        onChange={(event) => setTransitionNote(event.target.value)}
                      />
                    </label>
                  )}
                  <div className="transition-actions">
                    <button type="button" className="btn-secondary" onClick={() => setPendingTransition(null)} disabled={transitionBusy}>
                      Cancel
                    </button>
                    <button type="button" className="btn-primary btn-primary-inline" onClick={runTransition} disabled={transitionBusy}>
                      {transitionBusy ? "Saving..." : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="transition-actions">
                  <button type="button" className="btn-secondary" onClick={() => startTransition("review")}>
                    Mark review
                  </button>
                  <button type="button" className="btn-primary btn-primary-inline" onClick={() => startTransition("accepted")}>
                    Accept
                  </button>
                  <button type="button" className="btn-danger" onClick={() => startTransition("rejected")}>
                    Reject
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="opp-empty-list">
              <p>Select an applicant to inspect their notes and history.</p>
            </div>
          )}
        </section>
      </div>
      </div>
    </OrganizerLayout>
  );
}

export default OpportunityApplicants;
