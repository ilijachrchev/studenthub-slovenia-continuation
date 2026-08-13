import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EventList from "../components/home/EventList";
import { getApiErrorMessage, requestJson } from "../api/http";

function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim();

  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
        return;
    }

    const controller = new AbortController();

    async function search() {
        setLoading(true);
        setError("");

        try {
            const data = await requestJson(`/api/search?q=${encodeURIComponent(query)}`, {
                signal: controller.signal,
            });
            setEvents(data.events || []);
        } catch (error) {
            if (controller.signal.aborted || error?.code === "aborted") return;
            setError(getApiErrorMessage(error, "Search failed"));
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }

    search();
    return () => controller.abort();
  }, [query]);


  return (
    <div className="search-page">
        <h1>{query ? `Results for "${query}"` : "Search"}</h1>

        {!query && <p className="home-status">Search for events by name.</p>}
        {loading && <p className="home-status">Searching...</p>}
        {error && <p className="home-status error-text">{error}</p> }

        {query && !loading && !error && (
            <EventList events={events} activeFilter={query} />
        )}
    </div>
  );
}

export default SearchResults;
