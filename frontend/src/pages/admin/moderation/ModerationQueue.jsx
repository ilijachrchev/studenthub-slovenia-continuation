import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminLayout from "../../../components/layout/AdminLayout";
import ReportCard from "../../../components/admin/moderation/ReportCard";
import ReportDetail from "../../../components/admin/moderation/ReportDetail";
import StatusBadge from "../../../components/shared/StatusBadge";
import PageState, { InlineState } from "../../../components/shared/PageState";
import "./ModerationQueue.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

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
  const [successMessage, setSuccessMessage] = useState("");
  const detailRef = useRef(null);
  const decisionRef = useRef(null);

  useEffect(() => {
    if (selectedReport && detailRef.current && !decision) {
      detailRef.current.focus();
    }
  }, [selectedReport, decision]);

  useEffect(() => {
    if (decision && decisionRef.current) {
      decisionRef.current.focus();
    }
  }, [decision]);

  const loadReports = useCallback(async (filter = statusFilter) => {
    setError("");
    setLoading(true);
    const res = await fetch(`/api/admin/moderation/reports?status=${encodeURIComponent(filter)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || "Failed to load moderation queue.");
    }
    const data = await res.json();
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
    const res = await fetch(`/api/admin/moderation/reports/${report.id}`, { credentials: "include" });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || "Failed to load report details.");
    }
    const data = await res.json();
    setSelectedReport(normalizeReport(data.report || data));
  };

  const openReport = async (report) => {
    setActionError("");
    setSuccessMessage("");
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
    setSuccessMessage("");
    const endpoint = decision === "resolve" ? "resolve" : "dismiss";
    const previousReports = reports;
    const optimisticStatus = decision === "resolve" ? "resolved" : "dismissed";
    setReports((current) =>
      current.map((report) => (String(report.id) === String(selectedReport.id) ? { ...report, status: optimisticStatus } : report)),
    );
    setSelectedReport((current) => (current ? { ...current, status: optimisticStatus } : current));
    try {
      const res = await fetch(`/api/admin/moderation/reports/${selectedReport.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          note: decisionNote.trim() || undefined,
          archive_opportunity: archiveOpportunity,
        }),
      });
      if (!res.ok) {
        const data = await safeJson(res);
        setReports(previousReports);
        setActionError(data.error || "Failed to update moderation item.");
        return;
      }
      await loadReports(statusFilter);
      setDecision(null);
      setDecisionNote("");
      setArchiveOpportunity(false);
      setSuccessMessage(decision === "resolve" ? "Report resolved." : "Report dismissed.");
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
    return (
      <AdminLayout>
        <PageState variant="loading" title="Loading moderation queue" message="Fetching reports and moderation details." />
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <PageState
          variant="error"
          title="Moderation queue"
          message={error}
          actionLabel="Retry"
          onAction={() => loadReports(statusFilter)}
        />
      </AdminLayout>
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
          <InlineState variant="error" message={actionError} actionLabel="Dismiss" onAction={() => setActionError("")} />
        )}

        {successMessage && (
          <InlineState variant="success" message={successMessage} actionLabel="Dismiss" onAction={() => setSuccessMessage("")} />
        )}

        <div className="moderation-grid">
          <section className="moderation-list" aria-labelledby="moderation-list-title">
            <div className="panel-heading">
              <h2 id="moderation-list-title">Reports</h2>
              <span>{reports.length} total</span>
            </div>
            {reports.length === 0 ? (
              <PageState variant="empty" title="No reports" message="No reports match this filter." />
            ) : (
              <ul className="report-list" role="listbox" aria-label="Reports">
                {reports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    active={String(selectedReport?.id) === String(report.id)}
                    onOpen={openReport}
                  />
                ))}
              </ul>
            )}
          </section>

          <ReportDetail
            report={selectedReport}
            ref={detailRef}
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
          <section className="decision-panel" aria-labelledby="decision-title" ref={decisionRef} tabIndex={-1}>
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
