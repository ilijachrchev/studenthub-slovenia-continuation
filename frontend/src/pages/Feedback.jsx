import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Star } from "../components/reusable/Icons";
import { getApiErrorMessage, requestJson } from "../api/http";
import "./css/Feedback.css";

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
            const [eventData, feedbackData] = await Promise.all([
                requestJson(`/api/events/${eventId}`),
                requestJson(`/api/feedback/${eventId}`),
            ]);

            setEvent(eventData);
            if (feedbackData.feedback) setExisting(feedbackData.feedback);
        } catch (error) {
            setError(getApiErrorMessage(error, "Failed to load this event"));
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
        await requestJson(`/api/feedback/${eventId}`, {
            method: "POST",
            body: { rating, comment: comment.trim() || null },
        });
        setDone(true);
    } catch (error) {
        setError(getApiErrorMessage(error, "Failed to submit feedback"));
    } finally {
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
