import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import OrganizerLayout from "../../../components/layout/OrganizerLayout";
import StatusBadge from "../../../components/shared/StatusBadge";
import "./OpportunityAnalytics.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

function pickSeries(data) {
  return data.timeseries || data.timeline || data.series || [];
}

function pickFunnel(data) {
  return data.funnel || data.stages || [];
}

function normalizeSummary(summary = {}) {
  return {
    views: summary.views ?? summary.impressions ?? 0,
    visits: summary.visits ?? summary.opened ?? 0,
    applications: summary.applications ?? summary.applies ?? 0,
    reviews: summary.reviews ?? summary.reviewed ?? 0,
    accepts: summary.accepts ?? summary.accepted ?? 0,
    rejects: summary.rejects ?? summary.rejected ?? 0,
    conversion: summary.conversion ?? summary.overall_conversion ?? 0,
  };
}

function BarChart({ title, data, valueKey, labelKey, maxValue, colorClass, ariaLabel }) {
  return (
    <section className="analytics-chart" aria-label={ariaLabel}>
      <div className="analytics-chart-header">
        <h3>{title}</h3>
      </div>
      <div className="analytics-chart-bars" role="list">
        {data.map((item) => {
          const value = Number(item[valueKey] || 0);
          const width = maxValue ? Math.max((value / maxValue) * 100, 4) : 0;
          return (
            <div className="analytics-bar-row" role="listitem" key={item[labelKey]}>
              <span className="analytics-bar-label">{item[labelKey]}</span>
              <div className={`analytics-bar-track ${colorClass}`}>
                <span className="analytics-bar-fill" style={{ width: `${width}%` }} />
              </div>
              <span className="analytics-bar-value">{value}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpportunityAnalytics() {
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const opportunityId = routeId || params.get("opportunity") || "";

  const [opportunity, setOpportunity] = useState(null);
  const [summary, setSummary] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [timeseries, setTimeseries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!opportunityId) {
        setLoading(false);
        setError("Select an opportunity to view analytics.");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/organizer/opportunities/${opportunityId}/analytics`, { credentials: "include" });
        if (!res.ok) {
          const data = await safeJson(res);
          throw new Error(data.error || "Failed to load analytics.");
        }
        const data = await res.json();
        if (ignore) return;
        setOpportunity(data.opportunity || data.opportunity_summary || null);
        setSummary(normalizeSummary(data.summary || data.analytics?.summary || data));
        setFunnel(pickFunnel(data));
        setTimeseries(pickSeries(data));
      } catch (err) {
        if (!ignore) setError(err.message || "Something went wrong.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [opportunityId]);

  const funnelMax = useMemo(() => Math.max(1, ...funnel.map((item) => Number(item.count || item.value || 0))), [funnel]);
  const seriesMax = useMemo(() => Math.max(1, ...timeseries.map((item) => Number(item.count || item.value || 0))), [timeseries]);
  const summaryCards = [
    { label: "Views", value: summary?.views ?? 0 },
    { label: "Visits", value: summary?.visits ?? 0 },
    { label: "Applications", value: summary?.applications ?? 0 },
    { label: "Reviews", value: summary?.reviews ?? 0 },
    { label: "Accepts", value: summary?.accepts ?? 0 },
    { label: "Rejects", value: summary?.rejects ?? 0 },
  ];

  if (loading) {
    return <p className="opp-status" role="status">Loading analytics...</p>;
  }

  if (error) {
    return (
      <section className="opp-empty-state" role="alert">
        <h1>Analytics</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <OrganizerLayout>
      <div className="analytics-page">
      <header className="analytics-header">
        <div>
          <h1>Opportunity analytics</h1>
          <p>Track funnel progression, conversions, and activity over time.</p>
        </div>
        {opportunity && <StatusBadge status={opportunity.status} />}
      </header>

      {opportunity && (
        <section className="analytics-opportunity">
          <h2>{opportunity.title || "Selected opportunity"}</h2>
          <p>{opportunity.summary || opportunity.description || "No summary available."}</p>
        </section>
      )}

      <section className="summary-grid" aria-label="Analytics summary">
        {summaryCards.map((card) => (
          <article key={card.label} className="summary-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
        <article className="summary-card summary-card-wide">
          <span>Conversion</span>
          <strong>{Math.round((summary?.conversion || 0) * 100)}%</strong>
        </article>
      </section>

      <div className="analytics-grid">
        <BarChart
          title="Funnel"
          data={funnel}
          valueKey="count"
          labelKey="stage"
          maxValue={funnelMax}
          colorClass="funnel"
          ariaLabel="Opportunity funnel chart"
        />
        <BarChart
          title="Timeseries"
          data={timeseries}
          valueKey="count"
          labelKey="date"
          maxValue={seriesMax}
          colorClass="timeseries"
          ariaLabel="Opportunity activity over time"
        />
      </div>
      </div>
    </OrganizerLayout>
  );
}

export default OpportunityAnalytics;
