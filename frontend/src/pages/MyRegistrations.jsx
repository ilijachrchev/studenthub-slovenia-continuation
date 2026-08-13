import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Ticket from "../components/events/Ticket";
import "./css/MyRegistrations.css";
import { apiRequest } from "../lib/api";

function MyRegistrations() {
    const [registrations, setRegistrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
    async function loadRegistrations() {
            try {
                const data = await apiRequest("/api/registrations");
                setRegistrations(data);
            } catch {
                setError("Failed to load your registrations");
            } finally {
                setLoading(false);
            }
        }
        loadRegistrations();
    }, []);

    const formatDate = (dateString) =>
        new Date(dateString).toLocaleString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

    if (loading) {
        return <p className="myreg-status">Loading your registrations...</p>;
    }
    if (error) {    
        return <p className="myreg-status error-text">{error}</p>
    }


    return (
        <div className="myreg-page">
            <div className="myreg-header">
                <h1 className="myreg-title">My registrations</h1>
                <p className="myreg-subtitle">Events you've registered for and your tickets.</p>
            </div>

            {registrations.length === 0 ? (
                <p className="myreg-status">
                    You haven't registered for any events yet. <Link to="/">Browse events</Link>
                </p>
            ) : (
                <div className="myreg-list">
                    {registrations.map((reg) => {
                        const isPast = new Date(reg.end_datetime) < new Date();
                        return (
                            <div className="myreg-card" key={reg.id}>
                                <div className="myreg-info">
                                    <Link to={`/events/${reg.event_id}`} className="myreg-event-title">
                                        {reg.title}
                                    </Link>
                                    <p className="myreg-org">by {reg.organization_name}</p>
                                    <p className="myreg-meta">{formatDate(reg.start_datetime)}</p>
                                    <p className="myreg-met">{reg.location}</p>

                                    {reg.checked_in ? (
                                        <span className="myreg-badge checked">Checked in</span>
                                    ) : (
                                        <span className="myreg-badge">Registered</span>
                                    )}

                                    {isPast && (
                                        <Link
                                            to={`/events/${reg.event_id}/feedback`}
                                            className="feedback-back"
                                            style={{ display: "inline-block", marginTop: "10px"}}
                                        >
                                            Leave Feedback
                                        </Link>
                                    )}
                                </div>
                                
                                <div className="myreg-ticket">
                                    <Ticket ticketCode={reg.ticket_code} />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    );
}

export default MyRegistrations;
