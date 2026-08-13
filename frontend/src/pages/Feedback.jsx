import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Star } from "../components/reusable/Icons";
import "./css/Feedback.css";
import { apiRequest } from "../lib/api";

function Feedback() {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [existing, setExisting] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function load() {
        try {
            const [eventRes, feedbackRes] = await Promise.all([
                apiRequest(`/api/events/${eventId}`),
                apiRequest(`/api/feedback/${eventId}`),
            ]);
            setEvent(eventRes);
            if (feedbackRes.feedback) setExisting(feedbackRes.feedback);
        } catch {
            setError("Failed to load this event");
        } finally {
            setLoading(false);
        }
    }
    load();
  }, [eventId]);

  const handleSubmit= async () => {
    setError("");
    if (rating < 1) {
        setError("Please select a rating");
        return;
    }

    setSubmitting(true);
    try {
        await apiRequest(`/api/feedback/${eventId}`, {
            method: "POST",
            body: { rating, comment: comment.trim() || null },
        });
        setDone(true);
        setSubmitting(false);
    } catch {
        setError("Failed to submit feedback");
        setSubmitting(false);
    }
  };


  const formatDate = (dated) =>
    new Date(dated).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
    });

    if (loading) return <p className="feedback-status">Loading...</p>

    return (
        <div className="feedback-page">
            <div className="feedback-card">
                {event && (
                    <div className="feedback-event">
                        <h2>{event.title}</h2>
                        <p className="feedback-event-meta">
                            by {event.organization_name}
                            {event.start_datetime && ` · ${formatDate(event.start_datetime)}`}
                            {event.location && ` · ${event.location}`}
                        </p>
                    </div>
                )}

                {existing || done ? (
                    <div className="feedback-done">
                        <p className="feedback-thanks">Thanks for your feedback!</p>
                        {existing && (
                            <p className="feedback-existing">You rated this event {existing.rating}/5</p>
                        )}
                        <button className="btn-primary" onClick={() => navigate("/my-registrations")}>
                            Back to My Registrations
                        </button>
                    </div>
                ) : (
                    <>
                        <h3 className="feedback-question">How was this event?</h3>
                        <p className="feedback-subtitle">
                            Your feedback helps organizers improve future events.
                        </p>

                        <div className="feedback-stars">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    className="feedback-star-btn"
                                    onClick={() => setRating(n)}
                                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                                >
                                    <Star size={34} filled={n <= rating} />
                                </button>
                            ))}
                        </div>

                        {rating > 0 && <p className="feedback-rating-label">{rating} out of 5</p>}

                        <label className="feedback-label">Additional Comments</label>

                        <textarea 
                            className="input"
                            rows={4}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Share your thoughts about this event..."
                        />

                        {error && <p className="error-text">{error}</p>}

                        <div className="feedback-actions">
                            <button className="feedback-back" onClick={() => navigate("/my-registrations")}>
                                Back to My Registrations
                            </button>
                            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                                {submitting ? "Submitting..." : "Submit Feedback"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default Feedback;
