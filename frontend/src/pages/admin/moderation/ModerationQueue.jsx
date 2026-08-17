import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "../../../components/layout/AdminLayout";
import ReportCard from "../../../components/admin/moderation/ReportCard";
import ReportDetail from "../../../components/admin/moderation/ReportDetail";
import { useAuth } from "../../../context/AuthContext";
import "./ModerationQueue.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

const DECISION_COPY = {
  resolve: { title: "Resolve report", cta: "Confirm resolution" },
  dismiss: { title: "Dismiss report", cta: "Confirm dismissal" },
  escalate: { title: "Escalate to admin", cta: "Confirm escalation" },
};

const RESOLUTION_ACTIONS = [
  { value: "hide_content", label: "Hide the listing" },
  { value: "restore_content", label: "Restore a previously hidden listing" },
  { value: "warn_organizer", label: "Warn the organizer, no content change" },
  { value: "no_action", label: "No action needed" },
];

function ModerationQueue() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [statusFilter, setStatusFilter] = useState("open");
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [decision, setDecision] = useState(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [resolutionAction, setResolutionAction] = useState("no_action");
  const [busy, setBusy] = useState(false);

  const loadReports = useCallback(async (filter = statusFilter) => {
    const res = await fetch(`/api/moderation/queue?status=${encodeURIComponent(filter)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || "Failed to load the moderation queue.");
    }
    const data = await res.json();
    setReports(data.reports || []);
  }, [statusFilter]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        await loadReports();
      } catch (err) {
        if (!ignore) setError(err.message || "Something went wrong.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [loadReports, statusFilter]);

  const openReport = async (report) => {
    setActionError("");
    setDecision(null);
    setSelectedReport(report);
    try {
      const res = await fetch(`/api/moderation/reports/${report.id}`, { credentials: "include" });
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data.error || "Failed to load report details.");
      }
      const data = await res.json();
      setSelectedReport(data.report);
    } catch (err) {
      setActionError(err.message || "Something went wrong.");
    }
  };

  const refresh = async () => {
    await loadReports(statusFilter);
    if (selectedReport) {
      await openReport(selectedReport);
    }
  };

  const runAction = async (url, body) => {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body || {}),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setActionError(data.error || "Action failed.");
        return false;
      }
      return true;
    } catch {
      setActionError("Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async (report) => {
    const ok = await runAction(`/api/moderation/reports/${report.id}/claim`);
    if (ok) await refresh();
  };

  const handleRelease = async (report) => {
    const ok = await runAction(`/api/moderation/reports/${report.id}/release`);
    if (ok) await refresh();
  };

  const openDecision = (report, kind) => {
    setSelectedReport(report);
    setDecision(kind);
    setDecisionNote("");
    setResolutionAction("no_action");
  };

  const submitDecision = async () => {
    if (!selectedReport || !decision) return;
    const endpoint = `/api/moderation/reports/${selectedReport.id}/${decision}`;
    const body = { note: decisionNote.trim() };
    if (decision === "resolve") {
      body.action = resolutionAction;
    }
    const ok = await runAction(endpoint, body);
    if (ok) {
      setDecision(null);
      setDecisionNote("");
      await refresh();
    }
  };

  const filterOptions = useMemo(
    () => [
      { value: "open", label: "Open" },
      { value: "under_review", label: "Under review" },
      { value: "escalated", label: "Escalated" },
      { value: "resolved", label: "Resolved" },
      { value: "dismissed", label: "Dismissed" },
      { value: "all", label: "All" },
    ],
    [],
  );

  if (loading) {
    return <p className="opp-status" role="status">Loading moderation queue...</p>;
  }

  if (error) {
    return (
      <section className="opp-empty-state" role="alert">
        <h1>Moderation queue</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <AdminLayout>
      <div className="moderation-page">
        <header className="moderation-header">
          <div>
            <h1>Moderation queue</h1>
            <p>Claim a report, review the evidence, and resolve or dismiss it with a note.</p>
          </div>
        </header>

        <div className="moderation-toolbar">
          <label>
            <span>Status filter</span>
            <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {actionError && (
          <div className="opp-inline-error" role="alert">
            {actionError}
          </div>
        )}

        <div className="moderation-grid">
          <section className="moderation-list" aria-labelledby="moderation-list-title">
            <div className="panel-heading">
              <h2 id="moderation-list-title">Reports</h2>
              <span>{reports.length} total</span>
            </div>
            {reports.length === 0 ? (
              <div className="opp-empty-list">
                <p>No reports match this filter.</p>
              </div>
            ) : (
              <div className="report-list">
                {reports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    active={String(selectedReport?.id) === String(report.id)}
                    onOpen={openReport}
                  />
                ))}
              </div>
            )}
          </section>

          <ReportDetail
            report={selectedReport}
            currentUser={user}
            isAdmin={isAdmin}
            busy={busy}
            onClaim={handleClaim}
            onRelease={handleRelease}
            onDecide={openDecision}
          />
        </div>

        {decision && selectedReport && (
          <section className="decision-panel" aria-labelledby="decision-title">
            <div className="panel-heading">
              <h2 id="decision-title">{DECISION_COPY[decision].title}</h2>
              <button type="button" className="btn-secondary" onClick={() => setDecision(null)} disabled={busy}>
                Cancel
              </button>
            </div>

            {decision === "resolve" && (
              <label>
                <span>Action</span>
                <select className="input" value={resolutionAction} onChange={(event) => setResolutionAction(event.target.value)}>
                  {RESOLUTION_ACTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              <span>Note</span>
              <textarea
                className="input"
                rows={4}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                placeholder="Explain the outcome — this is preserved in the audit trail"
              />
            </label>

            <div className="transition-actions">
              <button
                type="button"
                className="btn-primary btn-primary-inline"
                onClick={submitDecision}
                disabled={busy || decisionNote.trim().length < 5}
              >
                {busy ? "Saving..." : DECISION_COPY[decision].cta}
              </button>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

export default ModerationQueue;
