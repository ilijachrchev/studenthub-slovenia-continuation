import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "../../../components/layout/AdminLayout";
import ReportCard from "../../../components/admin/moderation/ReportCard";
import ReportDetail from "../../../components/admin/moderation/ReportDetail";
import StatusBadge from "../../../components/shared/StatusBadge";
import "./ModerationQueue.css";
import { apiRequest } from "../../../lib/api";

function normalizeReport(report) {
  return {
    ...report,
    status: report.status || "open",
  };
}

function ModerationQueue() {
  const [statusFilter, setStatusFilter] = useState("open");
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [decision, setDecision] = useState(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [archiveOpportunity, setArchiveOpportunity] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadReports = useCallback(async (filter = statusFilter) => {
    const data = await apiRequest(`/api/admin/moderation/reports?status=${encodeURIComponent(filter)}`);
    const items = (data.reports || data.items || []).map(normalizeReport);
    setReports(items);
    setSelectedReport((current) => items.find((item) => String(item.id) === String(current?.id)) || items[0] || null);
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

  const loadDetail = async (report) => {
    if (!report) return;
    const data = await apiRequest(`/api/admin/moderation/reports/${report.id}`);
    setSelectedReport(normalizeReport(data.report || data));
  };

  const openReport = async (report) => {
    setActionError("");
    setSelectedReport(report);
    try {
      await loadDetail(report);
    } catch (err) {
      setActionError(err.message || "Something went wrong.");
    }
  };

  const submitDecision = async () => {
    if (!selectedReport || !decision) return;
    setSubmitting(true);
    setActionError("");
    const endpoint = decision === "resolve" ? "resolve" : "dismiss";
    const previousReports = reports;
    const optimisticStatus = decision === "resolve" ? "resolved" : "dismissed";
    setReports((current) =>
      current.map((report) => (String(report.id) === String(selectedReport.id) ? { ...report, status: optimisticStatus } : report)),
    );
    setSelectedReport((current) => (current ? { ...current, status: optimisticStatus } : current));
    try {
      await apiRequest(`/api/admin/moderation/reports/${selectedReport.id}/${endpoint}`, {
        method: "POST",
        body: {
          note: decisionNote.trim() || undefined,
          archive_opportunity: archiveOpportunity,
        },
      });
      await loadReports(statusFilter);
      setDecision(null);
      setDecisionNote("");
      setArchiveOpportunity(false);
    } catch {
      setReports(previousReports);
      setActionError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const filterOptions = useMemo(
    () => [
      { value: "open", label: "Open" },
      { value: "in_review", label: "In review" },
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
            <p>Review reports, open the associated opportunity, and resolve or dismiss with a note.</p>
          </div>
          <StatusBadge status={statusFilter} label={statusFilter === "all" ? "All reports" : `${statusFilter} reports`} />
        </header>

        <div className="moderation-toolbar">
          <label>
            <span>Status filter</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => {
                setLoading(true);
                setStatusFilter(event.target.value);
              }}
            >
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
            onResolve={(report) => {
              setSelectedReport(report);
              setDecision("resolve");
            }}
            onDismiss={(report) => {
              setSelectedReport(report);
              setDecision("dismiss");
            }}
            onSelectOpportunity={(opportunityId) => {
              setActionError("");
              setDecision(null);
              setDecisionNote("");
              setArchiveOpportunity(false);
              window.open(`/organizer/opportunities/${opportunityId}/analytics`, "_blank", "noopener,noreferrer");
            }}
          />
        </div>

        {decision && selectedReport && (
          <section className="decision-panel" aria-labelledby="decision-title">
            <div className="panel-heading">
              <h2 id="decision-title">{decision === "resolve" ? "Resolve report" : "Dismiss report"}</h2>
              <button type="button" className="btn-secondary" onClick={() => setDecision(null)} disabled={submitting}>
                Cancel
              </button>
            </div>
            <label>
              <span>Moderator note</span>
              <textarea
                className="input"
                rows={4}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                placeholder="Explain the outcome for the reporter and organizer"
              />
            </label>
            <label className="decision-checkbox">
              <input
                type="checkbox"
                checked={archiveOpportunity}
                onChange={(event) => setArchiveOpportunity(event.target.checked)}
              />
              <span>Archive the related opportunity</span>
            </label>
            <div className="transition-actions">
              <button type="button" className="btn-primary btn-primary-inline" onClick={submitDecision} disabled={submitting || !decisionNote.trim()}>
                {submitting ? "Saving..." : "Confirm decision"}
              </button>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

export default ModerationQueue;
