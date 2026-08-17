import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Wave } from "../components/reusable/Icons";
import EventList from "../components/home/EventList";
import HomeHero from "../components/home/HomeHero";
import HomeFilters from "../components/home/HomeFilters";
import "./css/Home.css";
import { apiRequest } from "../lib/api";

function Home() {
  const {user} = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [tags, setTags] = useState([]);
  const [activeFilter, setActiveFilter] = useState("All");
  const [savedIds, setSavedIds] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvents() {
      try {
        const [eventsData, tagsData, savedData] = await Promise.all([
          apiRequest("/api/events?page=1&limit=20", { signal: controller.signal }),
          apiRequest("/api/tags", { signal: controller.signal }),
          apiRequest("/api/bookmarks/ids", { signal: controller.signal }),
        ]);

        setEvents(eventsData.events || []);
        setHasMore((eventsData.events || []).length < (eventsData.total || 0));
        setPage(1);
        setTags(Array.isArray(tagsData) ? tagsData : []);
        setSavedIds(savedData.ids || []);
      } catch (error) {
        if (error?.code === "aborted") return;
        setError("Failed to load events");
      } finally {
        setLoading(false);
      }
    }

    loadEvents();

    return () => {
      controller.abort();
    };
  }, []);

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const data = await apiRequest(`/api/events?page=${nextPage}&limit=20`);
      setEvents((prev) => [...prev, ...(data.events || [])]);
      setPage(nextPage);
      setHasMore((data.events || []).length > 0 && (nextPage * 20) < (data.total || 0));
    } catch {
      // silently fail — existing events remain
    } finally {
      setLoadingMore(false);
    }
  };

  const handleToggleSave = async (eventId) => {
    const isSaved = savedIds.includes(eventId);
    setSavedIds((prev) => 
      isSaved ? prev.filter((id) => id !== eventId) : [...prev, eventId]
    );

    try {
      await apiRequest(`/api/bookmarks/${eventId}`, {
        method: isSaved ? "DELETE" : "POST",
      });
    } catch {
      setSavedIds((prev) =>
        isSaved ? [...prev, eventId] : prev.filter((id) => id !== eventId)
      );
    }
  };

  if (loading) return <p className="home-status">Loading events…</p>;
  if (error) return <p className="home-status error-text">{error}</p>;

  const filters = ["All", ...tags.map((tag) => tag.name)];
  const filteredEvents =
    activeFilter === "All"
      ? events
      : events.filter((event) =>
          event.tags.some((tag) => tag.name === activeFilter)
        );

  const featuredEvents = events[0]?.score >= 0 ? events[0] : null;

  // const listEvents = featuredEvents
  //       ? events.filter((event) => event.id !== featuredEvents.id)
  //       : events;

  return (
    <div className="home-page">
      <div className="home-greeting">
        <h1 className="home-greeting-title">
          {user ? `Hi, ${user.first_name}` : "Find student events around you"}
          {user && (
            <span className="home-greeting-wave">
              <Wave size={26} />
            </span>
          )}
        </h1>
        <p className="home-greeting-subtitle">
          Discover workshops, hackathons, lectures, and career events from student organizations.
        </p>
      </div>
      <HomeFilters 
        filters={filters}
        active={activeFilter}
        onChange={setActiveFilter}
      />

      {featuredEvents && <HomeHero event={featuredEvents}/>}

      <EventList 
        events={filteredEvents} 
        activeFilter={activeFilter}
        savedIds={savedIds}
        onToggleSave={handleToggleSave} 
      />

      {hasMore && (
        <button className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load More"}
        </button>
      )}
    </div>
  );
}

export default Home;
