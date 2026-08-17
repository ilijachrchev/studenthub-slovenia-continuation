import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageState, { InlineState } from "../../components/shared/PageState";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import OpportunityFilters from "../../components/opportunities/OpportunityFilters";
import {
  dispatchAnalytics,
  normaliseOpportunityList,
} from "../../components/opportunities/opportunitiesUtils";
import { getApiErrorMessage, requestJson } from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import "./css/opportunities.css";

const PAGE_SIZE = 12;

const INITIAL_FILTERS = {
  search: "",
  organizer: "",
  availability: "open",
  location: "",
  deadline: "",
};

function Discovery() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [pageError, setPageError] = useState("");
  const [auxError, setAuxError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [pendingBookmarkIds, setPendingBookmarkIds] = useState(() => new Set());

  const loadDiscovery = useCallback(
    async (nextFilters, signal) => {
      setLoading(true);
      setPageError("");
      setAuxError("");
      setSaveMessage("");

      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", String(PAGE_SIZE));

        if (nextFilters.search) params.set("search", nextFilters.search);
        if (nextFilters.organizer) params.set("organizer", nextFilters.organizer);
        if (nextFilters.availability) params.set("availability", nextFilters.availability);
        if (nextFilters.location) params.set("location", nextFilters.location);
        if (nextFilters.deadline) params.set("deadline", nextFilters.deadline);

        const [opportunitiesData, savedData] = await Promise.all([
          requestJson(`/api/opportunities?${params.toString()}`, {
            signal,
          }),
          requestJson("/api/opportunities/saved/ids", {
            signal,
          }).catch((error) => {
            if (error?.status === 401) return { ids: [] };
            throw error;
          }),
        ]);

        const nextItems = normaliseOpportunityList(opportunitiesData);
        setOpportunities(nextItems);
        setPage(1);
        setHasMore(Boolean(opportunitiesData.hasMore ?? nextItems.length >= PAGE_SIZE));
        setSavedIds(
          Array.isArray(savedData)
            ? savedData
            : savedData.ids || savedData.savedIds || []
        );
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "aborted") return;
        setPageError(getApiErrorMessage(error, "Failed to load opportunities"));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void loadDiscovery(filters, controller.signal);
    });
    return () => controller.abort();
  }, [filters, loadDiscovery]);

  const organizers = useMemo(() => {
    const map = new Map();

    opportunities.forEach((opportunity) => {
      if (!opportunity.organizationId || !opportunity.organizationName) return;
      map.set(String(opportunity.organizationId), {
        value: String(opportunity.organizationId),
        label: opportunity.organizationName,
      });
    });

    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [opportunities]);

  const visibleCount = opportunities.length;

  const handleFilterChange = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const toggleBookmark = async (opportunity) => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/opportunities/${opportunity.id}`)}`);
      return;
    }

    if (pendingBookmarkIds.has(opportunity.id)) {
      return;
    }

    const nextSaved = !savedIds.includes(opportunity.id);
    const previous = savedIds;
    setPendingBookmarkIds((current) => {
      const next = new Set(current);
      next.add(opportunity.id);
      return next;
    });
    setSaveMessage("");

    setSavedIds((current) =>
      current.includes(opportunity.id)
        ? current.filter((id) => id !== opportunity.id)
        : [...current, opportunity.id]
    );

    dispatchAnalytics(nextSaved ? "opportunity_saved" : "opportunity_unsaved", {
      opportunityId: opportunity.id,
      title: opportunity.title,
    });

    try {
      await requestJson(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: nextSaved ? "POST" : "DELETE",
      });
      setSaveMessage(nextSaved ? "Opportunity saved." : "Opportunity removed from saved.");
    } catch (error) {
      setSavedIds(previous);
      setAuxError(getApiErrorMessage(error, "Failed to update saved opportunities"));
    } finally {
      setPendingBookmarkIds((current) => {
        const next = new Set(current);
        next.delete(opportunity.id);
        return next;
      });
    }
  };

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    setAuxError("");

    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(PAGE_SIZE));

      if (filters.search) params.set("search", filters.search);
      if (filters.organizer) params.set("organizer", filters.organizer);
      if (filters.availability) params.set("availability", filters.availability);
      if (filters.location) params.set("location", filters.location);
      if (filters.deadline) params.set("deadline", filters.deadline);

      const data = await requestJson(`/api/opportunities?${params.toString()}`);
      const nextItems = normaliseOpportunityList(data);
      setOpportunities((current) => [...current, ...nextItems]);
      setPage(nextPage);
      setHasMore(Boolean(data.hasMore ?? nextItems.length >= PAGE_SIZE));
    } catch (error) {
      setAuxError(getApiErrorMessage(error, "Failed to load more opportunities"));
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && opportunities.length === 0) {
    return (
      <PageState
        variant="loading"
        title="Loading opportunities"
        message="Fetching the latest opportunities and your saved state."
      />
    );
  }

  if (pageError && opportunities.length === 0) {
    return (
      <PageState
        variant="error"
        title="Discover opportunities"
        message={pageError}
        actionLabel="Retry"
        onAction={() => loadDiscovery(filters, new AbortController().signal)}
      />
    );
  }

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Opportunity hub</div>
        <h1 className="opp-page-title">Discover opportunities</h1>
        <p className="opp-page-subtitle">
          Browse published internships, projects, volunteering, and student jobs. Filter by
          organizer, location, deadline, and availability, then save the ones you want to revisit.
        </p>
      </section>

      <OpportunityFilters
        values={filters}
        organizers={organizers}
        onChange={handleFilterChange}
        onClear={clearFilters}
      />

      {saveMessage && (
        <InlineState
          variant="success"
          message={saveMessage}
          actionLabel="Dismiss"
          onAction={() => setSaveMessage("")}
        />
      )}

      {auxError && (
        <InlineState
          variant="error"
          message={auxError}
          actionLabel="Dismiss"
          onAction={() => setAuxError("")}
        />
      )}

      <div className="opp-toolbar">
        <p className="opp-toolbar-meta">
          {visibleCount} {visibleCount === 1 ? "opportunity" : "opportunities"} visible
        </p>
        <div className="opp-toolbar-actions">
          <Link to="/opportunities/saved" className="opp-link">
            Saved opportunities
          </Link>
          <Link to="/opportunities/applications" className="opp-link">
            My applications
          </Link>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <PageState
          variant="empty"
          title="No opportunities found"
          message="Try adjusting your filters or check back later for new listings."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <div className="opp-list">
          {opportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              saved={savedIds.includes(opportunity.id)}
              saving={pendingBookmarkIds.has(opportunity.id)}
              onToggleSave={toggleBookmark}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <button type="button" className="opp-load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading more..." : "Load more"}
        </button>
      )}
    </div>
  );
}

export default Discovery;
