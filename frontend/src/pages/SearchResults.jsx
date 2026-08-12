import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EventList from "../components/home/EventList";

function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim();

  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEvents([]);
        return;
    }

    async function search() {
        setLoading(true);
        setError("");

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || "Seach failed");
            } else {
                setEvents(data.events || []);
            }
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
