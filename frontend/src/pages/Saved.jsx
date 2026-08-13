import { useEffect, useState } from "react";
import EventCard from "../components/home/EventCard";
import { apiRequest, getApiErrorMessage } from "../lib/api";
import "./css/Home.css";

function Saved() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
        try {
            const data = await apiRequest("/api/bookmarks", { signal: controller.signal });
            setEvents(data);
        } catch (error) {
            if (controller.signal.aborted || error?.code === "aborted") return;
            setError(getApiErrorMessage(error, "Failed to load saved events"))
        } finally {
            setLoading(false);
        }
    }
    load();

    return () => controller.abort();
  }, []);

  const handleToggleSave = async (eventId) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    try {
        await apiRequest(`/api/bookmarks/${eventId}`, {
            method: "DELETE",
        });
    } catch {
        // Ignore delete failures; the UI is already updated optimistically.
    }
  };

  if (loading) return <p className="home-status">Loading saved events...</p>
  if (error) return <p className="home-status error-text">{error}</p>

  return (
    <div className="home-page">
        <div className="home-greeting">
            <h1 className="home-greeting-title">Saved Events</h1>
            <p className="home-greeting-subtitle">Events you have bookmarked</p>
        </div>

        {events.length === 0 ? (
            <p className="home-status">You haven't saved any events yet</p>
        ) : (
            <div className="event-list">
                {events.map((event) => (
                    <EventCard 
                        key={event.id}
                        event={event}
                        saved={true}
                        onToggleSave={handleToggleSave}
                    />
                ))}
            </div>
        )}
    </div>
  );
}

export default Saved;
