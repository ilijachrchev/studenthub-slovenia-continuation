import { useEffect, useState } from "react";
import "./css/SetupFeed.css";
import "./css/AccountSettings.css";
import { apiRequest } from "../lib/api";

function AccountSettings() {
  const [faculties, setFaculties] = useState([]);
  const [tags, setTags] = useState([]);

  const [facultyId, setFacultyId] = useState("");
  const [studyYear, setStudyYear] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function loadData() {
        try {
            const [facultiesRes, tagRes, profileRes] = await Promise.all([
                apiRequest("/api/faculties"),
                apiRequest("/api/tags"),
                apiRequest("/api/student/profile"),
            ]);

            setFaculties(facultiesRes);
            setTags(tagRes);

            if (profileRes.hasProfile) {
                setFacultyId(String(profileRes.faculty_id));
                setStudyYear(profileRes.study_year ? String(profileRes.study_year) : "");
                setSelectedTags(profileRes.tag_ids || []);
            }
        } catch {
            setLoadError("Failed to load your settings");
        } finally {
            setLoading(false);
        }
    }
    loadData();
  }, []);

  const toggleTag = (tagId) => {
    setSelectedTags((prev) => 
        prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    if (!facultyId) {
        setError("Please select a faculty");
        return;
    }

    setSaving(true);

    try {
        await apiRequest("/api/student/profile", {
            method: "PUT",
            body: {
                faculty_id: Number(facultyId),
                study_year: studyYear ? Number(studyYear) : null,
                tag_ids: selectedTags,
            },
        });

        setSuccess("Your preferences have been saved.");
        setSaving(false);
    } catch {
        setError("Failed to save changes");
        setSaving(false);
    }
  };

  if (loading) return <p className="setup-subtitle">Loading...</p>;
  if (loadError) return <p className="setup-subtitle">{loadError}</p>;

  return (
    <div className="account-settings">
        <h1>Settings</h1>
        <p className="setup-subtitle">Edit your feed preferences</p>

        <label className="setup-label">Your Faculty<span className="required">*</span></label>
        <select
            className="input"
            value={facultyId}
            onChange={(e) => setFacultyId(e.target.value)}
        >
            <option value="">Select faculty...</option>
            {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                    {f.name} - {f.university_name}
                </option>
            ))}
        </select>

        <label className="setup-label">Year of Study<span className="optional"> (optional)</span></label>
        <select
            className="input"
            value={studyYear}
            onChange={(e) => setStudyYear(e.target.value)}
        >
            <option value="">Select year…</option>
            <option value="1">1st Year</option>
            <option value="2">2nd Year</option>
            <option value="3">3rd Year</option>
            <option value="4">4th Year</option>
            <option value="5">5th Year</option>
        </select>

        <label className="setup-label">Interests</label>
      <div className="tag-list">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`tag-chip ${selectedTags.includes(tag.id) ? "selected" : ""}`}
            onClick={() => toggleTag(tag.id)}
          >
            {tag.name}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}
      {success && <p className="success-text">{success}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  )

}

export default AccountSettings;
