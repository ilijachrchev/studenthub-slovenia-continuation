import { useEffect, useState } from "react";
import Ticket from "./Ticket";

function EventRegistrationBox({ event }) {

  const [registration, setRegistration] = useState(null);
  const [loading, setLoading] = useState(event.registration_type === "built_in");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (event.registration_type !== "built_in") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    async function loadRegistration() {
      try { 
        const res = await fetch(`/api/registrations/${event.id}`, {
          credentials: "include",
        });
        const data = await res.json();
        setRegistration(data.registration);
      } catch {
        // Intentionally ignore fetch failures here.
      } finally {
        setLoading(false);
      }
    }

    loadRegistration();
  }, [event.id, event.registration_type]);

  const handleRegister = async () => {
    setError("");
    setWorking(true);
    try {
      const res = await fetch(`/api/registrations/${event.id}`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not register");
      } else {
        setRegistration(data);
      }
    } catch {
      setError("Could not register. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async () => {
    setError("");
    setWorking(true);
    try {
      const res = await fetch(`/api/registrations/${event.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Could not cancel");
      } else {
        setRegistration(null);
      }
    } catch {
      setError("Could not cancel. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="detail-register">
      {event.registration_type === "built_in" && (
        <>
          {loading ? (
            <p className="detail-loading">Loading...</p>
          ) : registration ? (
            <div className="register-success">
              <p className="register-success-msg">You're registered</p>
              <Ticket ticketCode={registration.ticket_code}/>
              <button className="ticket-cancel" onClick={handleCancel} disabled={working}>
                {working ? "Cancelling..." : "Cancel registration"}
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={handleRegister} disabled={working}>
              {working ? "Registering..." : "Register"}
            </button>
          )}
          {error && <p className="error-text">{error}</p>}
        </>
      )}

      {event.registration_type === "external" && (
        <a
          className="btn-primary"
          href={event.external_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Register on external site
        </a>
      )}

      {event.registration_type === "none" && (
        <p className="detail-noreg">No registration required, just show up!</p>
      )}
    </div>
  );
}

export default EventRegistrationBox;  
