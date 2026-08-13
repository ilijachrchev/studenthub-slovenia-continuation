import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import OpportunityFilters from "../../components/opportunities/OpportunityFilters";
import RecommendationReason from "../../components/opportunities/RecommendationReason";
import {
  dispatchAnalytics,
  normaliseOpportunityList,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./css/opportunities.css";

const PAGE_SIZE = 12;

const INITIAL_FILTERS = {
  category: "",
  tag: "",
  remote: "",
  search: "",
  deadline: "",
};

async function safeJson(response) {
  return response.json().catch(() => ({}));
}

function Discovery() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [auxError, setAuxError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadDiscovery = useCallback(async () => {
    setLoading(true);
    setPageError("");
    setAuxError("");
    setLoadMoreError("");
    setActionError("");
    setActionMessage("");

    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", String(PAGE_SIZE));

      if (filters.category) params.set("category", filters.category);
      if (filters.tag) params.set("tag", filters.tag);
      if (filters.remote) params.set("remote", filters.remote);
      if (filters.search) params.set("search", filters.search);
      if (filters.deadline) params.set("deadline", filters.deadline);

      const [opportunitiesRes, savedRes, recommendationsRes] = await Promise.allSettled([
        fetch(`/api/opportunities?${params.toString()}`, { credentials: "include" }),
        fetch("/api/opportunities/saved/ids", { credentials: "include" }),
        fetch("/api/recommendations", { credentials: "include" }),
      ]);

      if (opportunitiesRes.status === "rejected") {
        throw new Error("Failed to load opportunities");
      }

      const opportunitiesResponse = opportunitiesRes.value;
      const opportunitiesData = await safeJson(opportunitiesResponse);

      if (!opportunitiesResponse.ok) {
        throw new Error(unwrapMessage(opportunitiesData, "Failed to load opportunities"));
      }

      const nextItems = normaliseOpportunityList(opportunitiesData);
      setOpportunities(nextItems);
      setPage(1);
      setHasMore(
        Boolean(
          opportunitiesData.hasMore ??
            opportunitiesData.has_more ??
            opportunitiesData.nextPage ??
            nextItems.length >= PAGE_SIZE,
        ),
      );

      const nextSavedIds = [];
      const nextAuxErrors = [];

      if (savedRes.status === "fulfilled") {
        const savedResponse = savedRes.value;
        const savedData = await safeJson(savedResponse);
        if (savedResponse.ok) {
          nextSavedIds.push(
            ...(Array.isArray(savedData)
              ? savedData
              : savedData.ids || savedData.savedIds || []),
          );
        } else {
          nextAuxErrors.push(unwrapMessage(savedData, "Failed to load saved opportunities"));
        }
      } else {
        nextAuxErrors.push("Failed to load saved opportunities");
      }

      if (recommendationsRes.status === "fulfilled") {
        const recommendationsResponse = recommendationsRes.value;
        const recommendationsData = await safeJson(recommendationsResponse);
        if (recommendationsResponse.ok) {
          setRecommendations(normaliseOpportunityList(recommendationsData));
        } else {
          nextAuxErrors.push(unwrapMessage(recommendationsData, "Failed to load recommendations"));
          setRecommendations([]);
        }
      } else {
        nextAuxErrors.push("Failed to load recommendations");
        setRecommendations([]);
      }

      setSavedIds(nextSavedIds);
      setAuxError(nextAuxErrors.join(" "));
    } catch (err) {
      setPageError(err.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDiscovery();
    });
  }, [loadDiscovery]);

  const { categories, tags } = useMemo(() => {
    const categoryMap = new Map();
    const tagMap = new Map();

    opportunities.forEach((opportunity) => {
      const category = opportunity.category;
      if (category?.name) {
        categoryMap.set(category.name, { value: category.id ?? category.name, label: category.name });
      }

      opportunity.tags.forEach((tag) => {
        if (tag?.name) {
          tagMap.set(tag.name, { value: tag.id ?? tag.name, label: tag.name });
        }
      });
    });

    return {
      categories: [...categoryMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
      tags: [...tagMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [opportunities]);

  const filteredRecommendations = recommendations.filter((opportunity) => {
    if (opportunity.category && filters.category) {
      const value = opportunity.category.id ?? opportunity.category.name;
      if (String(value) !== String(filters.category)) return false;
    }

    if (filters.tag && !opportunity.tags.some((tag) => String(tag.id ?? tag.name) === String(filters.tag))) {
      return false;
    }

    return true;
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const toggleBookmark = async (opportunity) => {
    const nextSaved = !savedIds.includes(opportunity.id);
    const previous = savedIds;

    setActionError("");
    setActionMessage("");
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
      const response = await fetch(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: nextSaved ? "POST" : "DELETE",
        credentials: "include",
      });

      const data = await safeJson(response);
      if (!response.ok) {
        throw new Error(unwrapMessage(data, "Failed to update saved opportunities"));
      }

      setActionMessage(nextSaved ? "Opportunity saved." : "Opportunity removed from saved.");
    } catch {
      setSavedIds(previous);
      setActionError("Failed to update saved opportunities");
    }
  };

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    setLoadMoreError("");

    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(PAGE_SIZE));

      if (filters.category) params.set("category", filters.category);
      if (filters.tag) params.set("tag", filters.tag);
      if (filters.remote) params.set("remote", filters.remote);
      if (filters.search) params.set("search", filters.search);
      if (filters.deadline) params.set("deadline", filters.deadline);

      const response = await fetch(`/api/opportunities?${params.toString()}`, {
        credentials: "include",
      });
      const data = await safeJson(response);

      if (!response.ok) {
        setLoadMoreError(unwrapMessage(data, "Failed to load more opportunities"));
        return;
      }

      const nextItems = normaliseOpportunityList(data);
      setOpportunities((current) => [...current, ...nextItems]);
      setPage(nextPage);
      setHasMore(
        Boolean(data.hasMore ?? data.has_more ?? data.nextPage ?? nextItems.length >= PAGE_SIZE)
      );
    } catch {
      setLoadMoreError("Failed to load more opportunities");
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && opportunities.length === 0) {
    return (
      <PageState
        variant="loading"
        title="Loading opportunities"
        message="Fetching available opportunities, saved items, and recommendations."
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
        onAction={loadDiscovery}
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
          category, tag, remote availability, and deadline, then save the ones you want to revisit.
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

      {loading && opportunities.length > 0 && (
        <InlineState
          variant="loading"
          message="Refreshing opportunities..."
        />
      )}

      {pageError && opportunities.length > 0 && (
        <InlineState
          variant="error"
          message={pageError}
          actionLabel="Retry"
          onAction={loadDiscovery}
        />
      )}

      {auxError && (
        <InlineState
          variant="error"
          message={auxError}
          actionLabel="Retry"
          onAction={loadDiscovery}
        />
      )}

      <OpportunityFilters
        values={filters}
        categories={categories}
        tags={tags}
        onChange={handleFilterChange}
        onClear={clearFilters}
      />

      <div className="opp-toolbar">
        <p className="opp-toolbar-meta">
          {opportunities.length} {opportunities.length === 1 ? "opportunity" : "opportunities"} visible
        </p>
        <Link to="/saved-opportunities" className="opp-link">
          View saved opportunities
        </Link>
      </div>

      {filteredRecommendations.length > 0 && (
        <section className="opp-panel">
          <h2>Recommended for you</h2>
          <div className="opp-list">
            {filteredRecommendations.slice(0, 3).map((opportunity) => (
              <OpportunityCard
                key={`rec-${opportunity.id}`}
                opportunity={opportunity}
                saved={savedIds.includes(opportunity.id)}
                onToggleSave={toggleBookmark}
                recommendationReason={opportunity.primary_reason || opportunity.reason || ""}
              />
            ))}
          </div>
          {filteredRecommendations[0]?.primary_reason && (
            <RecommendationReason reason={filteredRecommendations[0].primary_reason} />
          )}
        </section>
      )}

      {loadMoreError && (
        <InlineState
          variant="error"
          message={loadMoreError}
          actionLabel="Retry"
          onAction={loadMore}
        />
      )}

      {opportunities.length === 0 ? (
        <PageState
          variant="empty"
          title="No opportunities match"
          message="Try adjusting your filters or clear them to see more opportunities."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <div className="opp-list">
          {opportunities.map((opportunity) => {
            const recommendation = recommendations.find(
              (item) => String(item.id) === String(opportunity.id)
            );
            return (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                saved={savedIds.includes(opportunity.id)}
                onToggleSave={toggleBookmark}
                recommendationReason={recommendation?.primary_reason || ""}
              />
            );
          })}
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
