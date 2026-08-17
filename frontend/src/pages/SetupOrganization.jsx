import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { GraduationCap } from "../components/reusable/Icons";
import { useAuth } from "../context/AuthContext";
import "./css/SetupFeed.css";
import { apiRequest } from "../lib/api";


function SetupOrganization() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState(user ? user.email : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!name.trim() || !contactEmail.trim()) {
      setError("Organization name and contact email are required");
      return;
    }

    setLoading(true);

    try {
      await apiRequest("/api/organizations", {
        method: "POST",
        body: {
          name: name.trim(),
          description: description.trim() || null,
          website: website.trim() || null,
          contact_email: contactEmail.trim(),
        },
      });

      navigate("/application-status");
    } catch {
      setError("Failed to submit application");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="logo-icon">
            <GraduationCap size={24} />
          </div>
          <h2>Set up your organization</h2>
        </div>

        <p className="setup-subtitle">Tell us about your organization</p>

        <label className="setup-label">Organization Name<span className="required">*</span></label>
        <input 
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. IAESTE LC Koper"
        />

        <label className="setup-label">Description</label>

        <textarea 
          className="input"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does your organization do?"
        />

        <label className="setup-label">Website</label>
        <input
          className="input"
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://..."
        />

        <label className="setup-label">Contact Email<span className="required">*</span></label>
        <input
          className="input"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="contact@example.com"
        />

        {error && <p className="error-text">{error}</p>}

        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "Submitting..." : "Submit Application"}
        </button>
      </div>
    </div>
  );
}

export default SetupOrganization;
