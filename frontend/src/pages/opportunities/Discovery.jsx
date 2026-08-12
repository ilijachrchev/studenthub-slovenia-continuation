import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import OpportunityCard from "../../components/opportunities/OpportunityCard";
import OpportunityFilters from "../../components/opportunities/OpportunityFilters";
import RecommendationReason from "../../components/opportunities/RecommendationReason";
import {
  dispatchAnalytics,
  normaliseOpportunityList,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import "./css/opportunities.css";

const PAGE_SIZE = 12;

const INITIAL_FILTERS = {
  category: "",
  tag: "",
  remote: "",
  search: "",
  deadline: "",
};

function Discovery() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const pendingBookmarkRef = useRef(new Map());

  useEffect(() => {
    let alive = true;

    async function loadDiscovery() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", String(PAGE_SIZE));

        if (filters.category) params.set("category", filters.category);
        if (filters.tag) params.set("tag", filters.tag);
        if (filters.remote) params.set("remote", filters.remote);
        if (filters.search) params.set("search", filters.search);
        if (filters.deadline) params.set("deadline", filters.deadline);

        const [opportunitiesRes, savedRes, recommendationsRes] = await Promise.all([
          fetch(`/api/opportunities?${params.toString()}`, { credentials: "include" }),
          fetch("/api/opportunities/saved/ids", { credentials: "include" }),
          fetch("/api/recommendations", { credentials: "include" }),
        ]);

        const opportunitiesData = await opportunitiesRes.json().catch(() => ({}));
        const savedData = await savedRes.json().catch(() => ({}));
        const recommendationsData = await recommendationsRes.json().catch(() => ({}));

        if (!alive) return;

        if (!opportunitiesRes.ok) {
          setError(unwrapMessage(opportunitiesData, "Failed to load opportunities"));
          return;
        }

        const nextItems = normaliseOpportunityList(opportunitiesData);
        setOpportunities(nextItems);
        setPage(1);
        setHasMore(
          Boolean(
            opportunitiesData.hasMore ??
              opportunitiesData.has_more ??
              opportunitiesData.nextPage ??
              nextItems.length >= PAGE_SIZE
          )
        );

        setSavedIds(
          Array.isArray(savedData)
            ? savedData
            : savedData.ids || savedData.savedIds || []
        );

        const recItems = normaliseOpportunityList(recommendationsData);
        setRecommendations(recItems);
      } catch {
        if (alive) setError("Failed to load opportunities");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadDiscovery();

    return () => {
      alive = false;
    };
  }, [filters]);

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

    setSavedIds((current) =>
      current.includes(opportunity.id)
        ? current.filter((id) => id !== opportunity.id)
        : [...current, opportunity.id]
    );

    pendingBookmarkRef.current.set(opportunity.id, nextSaved);
    dispatchAnalytics(nextSaved ? "opportunity_saved" : "opportunity_unsaved", {
      opportunityId: opportunity.id,
      title: opportunity.title,
    });

    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/bookmark`, {
        method: nextSaved ? "POST" : "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("bookmark-failed");
      }
    } catch {
      setSavedIds(previous);
    } finally {
      pendingBookmarkRef.current.delete(opportunity.id);
    }
  };

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    setError("");

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
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(unwrapMessage(data, "Failed to load more opportunities"));
        return;
      }

      const nextItems = normaliseOpportunityList(data);
      setOpportunities((current) => [...current, ...nextItems]);
      setPage(nextPage);
      setHasMore(
        Boolean(data.hasMore ?? data.has_more ?? data.nextPage ?? nextItems.length >= PAGE_SIZE)
      );
    } catch {
      setError("Failed to load more opportunities");
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && opportunities.length === 0) {
    return <p className="opp-page-status">Loading opportunities...</p>;
  }

  if (error && opportunities.length === 0) {
    return <p className="opp-page-status error-text">{error}</p>;
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

      {error && opportunities.length > 0 && <p className="opp-page-status error-text">{error}</p>}

      {opportunities.length === 0 ? (
        <div className="opp-empty">
          No opportunities match your filters right now.
        </div>
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


