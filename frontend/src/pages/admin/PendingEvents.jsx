import { useCallback, useEffect, useState } from "react";
import PendingEventCard from "../../components/admin/PendingEventCard";
import RejectModal from "../../components/admin/RejectModal";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./css/PendingEvents.css";

function safeJson(res) {
  return res.json().catch(() => ({}));
}

function PendingEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [rejectingEvent, setRejectingEvent] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadPending = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/events/pending", { credentials: "include" });
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data.error || "Failed to load pending events");
      }
      const data = await safeJson(res);
      setEvents(data.events || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        await loadPending();
      } catch (err) {
        if (alive) {
          setError(err.message || "Something went wrong. Please try again.");
        }
      }
    }
    init();

    return () => {
      alive = false;
    };
  }, [loadPending]);

  const handleApprove = async (id) => {
    setError("");
    setActionError("");
    setSuccessMessage("");
    try {
      const res = await fetch(`/api/admin/events/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await safeJson(res);
        setActionError(data.error || "Failed to approve event");
        return;
      }
      setSuccessMessage("Event approved.");
      await loadPending();
    } catch {
      setActionError("Something went wrong. Please try again.");
    }
  };

  const confirmReject = async (reason) => {
    if (!rejectingEvent) return;
    setActionLoading(true);
    setError("");
    setActionError("");
    setSuccessMessage("");
    try {
      const res = await fetch(`/api/admin/events/${rejectingEvent.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await safeJson(res);
        setActionError(data.error || "Failed to reject event");
        return;
      }
      setRejectingEvent(null);
      setSuccessMessage("Event rejected.");
      await loadPending();
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading pending events"
        message="Fetching events awaiting approval."
      />
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Pending Events"
        message={error}
        actionLabel="Retry"
        onAction={loadPending}
      />
    );
  }

  return (
    <div className="pending-events">
      <div className="pending-header">
        <h1>Pending Events</h1>
        <p className="pending-subtitle">
          {events.length} event{events.length === 1 ? "" : "s"}
        </p>
      </div>

      {actionError && (
        <InlineState
          variant="error"
          message={actionError}
          actionLabel="Dismiss"
          onAction={() => setActionError("")}
        />
      )}

      {successMessage && (
        <InlineState
          variant="success"
          message={successMessage}
          actionLabel="Dismiss"
          onAction={() => setSuccessMessage("")}
        />
      )}

      {events.length === 0 ? (
        <PageState
          variant="empty"
          title="Nothing to review"
          message="There are no pending events right now."
        />
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
      )}

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
