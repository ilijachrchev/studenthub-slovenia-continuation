import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { GraduationCap } from "../components/reusable/Icons";
import "./css/SetupFeed.css";
import { apiRequest } from "../lib/api";

function ApplicationStatus() {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState(null);
  const [hasApplication, setHasApplication] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await apiRequest("/api/organizations/my-application");
        setHasApplication(data.hasApplication);
        setOrganization(data.organization || null);
      } catch {
        setError("Something went wrong. Please try again");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="setup-subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  const status = organization ? organization.status : null;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="logo-icon">
            <GraduationCap size={24} />
          </div>

          <h2>Organization Application</h2>
        </div>

      {error && <p className="error-text">{error}</p>}

      {!hasApplication && !error && (
        <>
          <p className="setup-subtitle">You haven't applied yet.</p>
          <button className="btn-primary" onClick={() => navigate("/setup-organization")}>
            Set up organization
          </button>
        </>
      )}

      {status === "pending" && (
        <p className="setup-subtitle">
          <strong>{organization.name}</strong> is under review. We usually review application within 1-2 working days.
        </p>
      )}

      {status === "approved" && (
        <>
          <p className="setup-subtitle">
            <strong>{organization.name}</strong> has been approved. You can now create events.
          </p>
          <button className="btn-primary" onClick={() => navigate("/organizer")}>
            Go to Dashboard
          </button>
        </>
      )}

      {status === "rejected" && (
        <p className="setup-subtitle">
          <strong>{organization.name}</strong> was not approved. Please contact support for details.
        </p>
      )}
      </div>
    </div>
  );

}

export default ApplicationStatus;
