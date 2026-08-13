import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./css/Register.css";
import { GraduationCap, Building, CheckCircle, ChevronRight } from "../components/reusable/Icons";
import { apiRequest, getApiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";

function Register() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [role, setRole] = useState("student");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError("");
    setLoading(true);

    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: {
          first_name: firstName,
          last_name: lastName,
          email,
          password,
          role,
        },
      });

      await refreshUser({ silent: true });

      if (role === "organizer") {
        navigate("/setup-organization");
      } else {
        navigate("/setup-feed");
      }
    } catch (error) {
      setError(getApiErrorMessage(error, "Something went wrong. Please try again."));
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-card">
        <div className="register-header">
          <div className="logo-icon">
            <GraduationCap size={24} />
          </div>
          <h2>Welcome To StudentHub</h2>
        </div>

        <div className="register-tabs">
          <Link to="/login">Sign In</Link>
          <span className="active">Register</span>
        </div>

        <div className="register-form">
          <input className="input" type="text" placeholder="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className="input" type="text" placeholder="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />

          <div className="role-selector">
            <div className={`role-card ${role === "student" ? "selected" : ""}`} onClick={() => setRole("student")}>
              <div className="role-icon">
                <GraduationCap />
              </div>
              <div className="role-info">
                <h3>Student</h3>
                <p>I'm a university student looking for events to attend</p>
              </div>
              <span className="role-check">
                {role === "student" ? <CheckCircle /> : <ChevronRight />}
              </span>
            </div>

            <div className={`role-card ${role === "organizer" ? "selected" : ""}`} onClick={() => setRole("organizer")}>
              <div className="role-icon">
                <Building />
              </div>
              <div className="role-info">
                <h3>Organization</h3>
                <p>I represent a student club, faculty group, or other organization that hosts events</p>
              </div>
              <span className="role-check">
                {role === "organizer" ? <CheckCircle /> : <ChevronRight />}
              </span>
            </div>
          </div>

          {role === "organizer" && (
            <p className="register-note">Organizations need admin approval before posting events.</p>
          )}

          {error && <p className="error-text">{error}</p>}

          <button className="btn-primary" onClick={handleRegister} disabled={loading}>
            {loading ? "Registering..." : "Register"}
          </button>
        </div>

        <p className="register-footer">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
