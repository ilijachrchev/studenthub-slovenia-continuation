import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import EventTagList from "../components/events/EventTagList";
import EventInfoBox from "../components/events/EventInfoBox";
import EventRegistrationBox from "../components/events/EventRegistrationBox";
import "./css/EventDetail.css";
import { apiRequest } from "../lib/api";

function EventDetail() {
  const { id } = useParams();

  const [event, setEvent] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEvent() {
      try {
        const data = await apiRequest(`/api/events/${id}`);
        setEvent(data);
      } catch {
        setError("Failed to load event");
      } finally {
        setLoading(false);
      }
    }

    loadEvent();
  }, [id]);

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (loading) return <p className="detail-status">Loading...</p>;
  if (error) return <p className="detail-status error-text">{error}</p>;
  if (!event) return null;

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">
        ← Back to events
      </Link>

      <EventTagList tags={event.tags} className="detail-tags" />

      <h1 className="detail-title">{event.title}</h1>
      <p className="detail-org">
        by <Link to={`/organizations/${event.organization_id}`}>{event.organization_name}</Link>
      </p>

      <EventInfoBox event={event} formatDate={formatDate} />

      <p className="detail-desc">{event.description}</p>

      <EventRegistrationBox event={event} />
    </div>
  );
}

export default EventDetail;
