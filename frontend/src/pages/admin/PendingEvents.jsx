import { useState, useEffect, useCallback } from "react";
import PendingEventCard from "../../components/admin/PendingEventCard";
import RejectModal from "../../components/admin/RejectModal";
import "./css/PendingEvents.css";
import { apiRequest } from "../../lib/api";

function PendingEvents() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rejectingEvent, setRejectingEvent] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);

    const loadPending = useCallback(async () => {
        const data = await apiRequest("/api/admin/events/pending");
        setEvents(data.events);
    }, []);

    useEffect(() => {
        async function init() {
            try {
                await loadPending();
            } catch {
                setError("Something went wrong. Please try again")
            } finally {
                setLoading(false);
            }
        }
        init();
    }, [loadPending]);

    const handleApprove = async (id) => {
        setError("");
        try {
            await apiRequest(`/api/admin/events/${id}/approve`, {
                method: "POST",
            });
            await loadPending();
        } catch {
            setError("Something went wrong. Please try again")
        }
    };

    const confirmReject = async (reason) => {
        if (!rejectingEvent) return;
        setActionLoading(true);
        setError("");
        try {
            await apiRequest(`/api/admin/events/${rejectingEvent.id}/reject`, {
                method: "POST",
                body: { reason },
            });
            setActionLoading(false);
            setRejectingEvent(null);
            await loadPending();
        } catch {
            setError("Something went wrong. Please try again.");
            setActionLoading(false);
        }
    };

    if (loading) return <p className="pending-status">Loading...</p>
    if (error && error.length > 0) return <p className="pending-status">{error}</p>

    return (
        <div className="pending-events">
            <div className="pending-header">
                <h1>Pending Events</h1>
                <p className="pending-subtitle">
                    {events.length} event{events.length === 1 ? "" : "s"}
                </p>
            </div>

            {error && <p className="error-text">{error}</p>}

            {events.length === 0 ? (
                <p className="pending-status">Nothing to review right now.</p>
            ) : (
                <div className="pending-list">
                    {events.map((event) => (
                        <PendingEventCard 
                            key={event.id}
                            event={event}
                            onApprove={handleApprove}
                            onReject={setRejectingEvent}
                        />
                    ))}
                </div>
            )};

            {rejectingEvent && (
                <RejectModal 
                    event={rejectingEvent}
                    onCancel={() => setRejectingEvent(null)}
                    onConfirm={confirmReject}
                    loading={actionLoading}
                />
            )}
        </div>
    );
}

export default PendingEvents;
