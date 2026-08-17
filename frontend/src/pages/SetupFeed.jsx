import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { GraduationCap } from "../components/reusable/Icons";
import "./css/SetupFeed.css";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";


function SetupFeed() {
  const navigate = useNavigate();

  // from backend
  const [faculties, setFaculties] = useState([]);
  const [tags, setTags] = useState([]);

  const [facultyId, setFacultyId] = useState('');
  const [studyYear, setStudyYear] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const {refreshUser} = useAuth();

  useEffect(() => {
    async function loadData() {
      try {
        const [facultiesRes, tagsRes] = await Promise.all([
          apiRequest('/api/faculties'),
          apiRequest('/api/tags')
        ]);
        setFaculties(facultiesRes);
        setTags(tagsRes);
      } catch {
        setError('Failed to load faculties and tags');
      }
    }
    loadData();
  }, []);

  const toggleTag = (tagId) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSubmit = async () => {
    setError('');
    if (!facultyId) {
      setError('Please select a faculty');
      return;
    }

    setLoading(true);
    try {
      await apiRequest("/api/student/setup", {
        method: "POST",
        body: {
          faculty_id: Number(facultyId),
          study_year: studyYear ? Number(studyYear) : null,
          tag_ids: selectedTags
        }
      });

      await refreshUser();
      navigate("/");
    } catch {
      setError('Failed to save preferences');
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
          <h2>Set Up Your Feed</h2>
        </div>

        <p className="setup-subtitle">What are you interested in?</p>

        <label className="setup-label">Your Faculty<span className='required'>*</span></label>
        <select
          className="input"
          value={facultyId}
          onChange={(e) => setFacultyId(e.target.value)}
        >
          <option value="">Select faculty…</option>
          {faculties.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} — {f.university_name}
            </option>
          ))}
        </select>

        <label className="setup-label">Year of Study<span className='optional'> (optional)</span></label>
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

        {/* Interests */}
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

        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "Saving…" : "Complete Setup"}
        </button>
      </div>
    </div>
  );
}

export default SetupFeed;
