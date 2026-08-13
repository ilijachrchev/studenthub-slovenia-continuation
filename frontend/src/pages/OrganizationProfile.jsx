import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import EventList from "../components/home/EventList";
import "./css/OrganizationProfile.css";
import { apiRequest } from "../lib/api";

function OrganizationProfile() {
  const { id } = useParams();

  const [organization, setOrganization] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOrganization() {
        try {
            const data = await apiRequest(`/api/organizations/${id}`);
            setOrganization(data.organization);
            setUpcoming(data.upcoming);
            setPast(data.past);
        } catch {
            setError("Failed to load organization");
        } finally {
            setLoading(false);
        }
    }

    loadOrganization();
  }, [id]);

  if (loading) return <p className="org-status">Loading...</p>
  if (error) return <p className="org-status error-text">{error}</p>
  if (!organization) return null;

  const initials = organization.name.split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

    
  return (
    <div className="org-profile">
        <Link to="/" className="org-back">
            ← Back to events
        </Link>

        <div className="org-header">
            {organization.logo ? (
                <img src={organization.logo} alt={organization.name} className="org-logo" />
            ) : (
                <div className="org-logo org-logo-fallback">{initials}</div>
            )}

            <div className="org-header-info">
                <h1 className="org-name">{organization.name}</h1>
                {organization.university_name && (
                    <p className="org-university">{organization.university_name}</p>
                )}
            </div>
        </div>

        {organization.description && (
            <p className="org-description">{organization.description}</p>
        )}

        <div className="org-contact">
            {organization.contact_email && (
                <a href={`mailto:${organization.contact_email}`}>{organization.contact_email}</a>
            )}
            {organization.website && (
                <a href={organization.website} target="_blank">
                    Website
                </a>
            )}
        </div>

        <section className="org-events">
            <h2 className="org-section-title">Upcoming events</h2>
            {upcoming.length === 0 ? (
                <p className="org-empty">No upcoming events</p>
            ) : (
                <EventList events={upcoming} />
            )}
        </section>

        <section className="org-events">
            <h2 className="org-section-title">Past events</h2>
            {past.length === 0 ? (
                <p className="org-empty">No past events</p>
            ) : (
                <EventList events={past} />
            )}
        </section>
    </div>
  );
}

export default OrganizationProfile;
