import { useEffect, useState } from "react";
import Ticket from "./Ticket";
import { apiRequest, getApiErrorMessage } from "../../lib/api";

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

    const controller = new AbortController();

    async function loadRegistration() {
      try { 
        const data = await apiRequest(`/api/registrations/${event.id}`, { signal: controller.signal });
        setRegistration(data.registration);
      } catch (error) {
        if (controller.signal.aborted || error?.code === "aborted") return;
        // Intentionally ignore fetch failures here.
      } finally {
        setLoading(false);
      }
    }

    loadRegistration();
    return () => controller.abort();
  }, [event.id, event.registration_type]);

  const handleRegister = async () => {
    setError("");
    setWorking(true);
    try {
      const data = await apiRequest(`/api/registrations/${event.id}`, {
        method: "POST",
      });
      setRegistration(data);
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not register. Please try again."));
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async () => {
    setError("");
    setWorking(true);
    try {
      await apiRequest(`/api/registrations/${event.id}`, {
        method: "DELETE",
      });
      setRegistration(null);
    } catch (error) {
      setError(getApiErrorMessage(error, "Could not cancel. Please try again."));
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
