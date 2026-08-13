import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./css/OrganizerDashboard.css";
import { apiRequest } from "../../lib/api";

const STATUS_GROUPS = [
    { key: "submitted", label: "Pending approval" },
    { key: "published", label: "Published" },
    { key: "draft", label: "Drafts" },
    { key: "rejected", label: "Rejected" },
    { key: "cancelled", label: "Cancelled" },
]

function formatDate(value) {
    return new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function OrganizerDashboard() {
    const navigate = useNavigate();

    const [organization, setOrganization] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadEvents = useCallback(async () => {
        const data = await apiRequest("/api/organizer/events");
        setEvents(data.events);
    }, []);

    useEffect(() => {
        async function init() {
            try {
                const orgData = await apiRequest("/api/organizations/my-application");
                if (orgData.hasApplication) {
                    setOrganization(orgData.organization);
                }
                await loadEvents();
            } catch {
                setError("Something went wrong. Please try again.");
            } finally {
                setLoading(false);
            }
        }
        init();
    }, [loadEvents]);

    const handleSubmit = async (eventId) => {
        try {
            await apiRequest(`/api/organizer/events/${eventId}/submit`, {
                method: "POST",
            });
            setError("");
            await loadEvents();
        } catch {
            setError("Something went wrong. Please try again")
        }
    }

    if (loading) {
        return <p className="dashboard-status">Loading...</p>
    }
    if (error) {
        return <p className="dashboard-status">{error}</p>
    }

    const groups = STATUS_GROUPS.map((g) => ({
        ...g, items: events.filter((e) => e.status === g.key),
    }));

    return (
        <div className="organizer-dashboard">
            <div className="dashboard-header">
                <div>
                    <h1>{organization ? organization.name : "Dashboard"}</h1>
                    <p className="dashboard-subtitle">
                        {events.length} event{events.length === 1 ? "" : "s"} total
                    </p>
                </div>

                <button className="btn-primary" onClick={() => navigate("/organizer/events/new")}>
                    Create Event
                </button>
            </div>

            {error && <p className="error-text">{error}</p>}

            {events.length === 0 ? (
                <p className="dashboard-status">No events yet. Create your first one.</p>
            ) : (
                groups.map((group) => 
                    group.items.length > 0 ? (
                        <section key={group.key} className="dashboard-group">
                            <h2 className="dashboard-group-title">
                                {group.label}
                                <span className="dashboard-count">{group.items.length}</span>
                            </h2>

                            <div className="dashboard-event-list">
                                {group.items.map((event) => (
                                    <div key={event.id} className="dashboard-event-card">
                                        <div className="dashboard-event-main">
                                            <h3>{event.title}</h3>
                                            <p className="dashboard-event-meta">
                                                {formatDate(event.start_datetime)} · {event.location}
                                            </p>
                                        </div>

                                        <div className="dashboard-event-actions">
                                            {event.status === "draft" && (
                                                <button className="btn-small" onClick={() => handleSubmit(event.id)}>
                                                    Submit for Approval
                                                </button>
                                            )}
                                        
                                            <span className={`status-badge status-${event.status}`}>
                                                {event.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null
                )
            )}
        </div>
    )
}

export default OrganizerDashboard;
