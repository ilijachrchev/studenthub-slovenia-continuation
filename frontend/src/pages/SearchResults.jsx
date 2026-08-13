import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EventList from "../components/home/EventList";
import { apiRequest } from "../lib/api";

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

    async function search() {
        setLoading(true);
        setError("");

        try {
            const data = await apiRequest(`/api/search?q=${encodeURIComponent(query)}`);
            setEvents(data.events || []);
        } catch {
            setError("Search failed");
        } finally {
            setLoading(false);
        }
    }

    search();
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
