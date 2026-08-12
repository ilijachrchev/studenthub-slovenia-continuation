import { useEffect, useState } from "react";
import EventCard from "../components/home/EventCard";
import "./css/Home.css";

function Saved() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
        try {
            const res = await fetch("/api/bookmarks", { credentials: "include"});
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || "Failed to load saved events");
            } else {
                setEvents(data);
            }
        } catch {
            setError("Failed to load saved events")
        } finally {
            setLoading(false);
        }
    }
    load();
  }, []);

  const handleToggleSave = async (eventId) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    try {
        await fetch(`/api/bookmarks/${eventId}`, {
            method: "DELETE",
            credentials: "include",
        });
    } catch {
        // The optimistic removal remains in place when the delete request fails.
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
