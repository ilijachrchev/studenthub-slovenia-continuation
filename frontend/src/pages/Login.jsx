import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { GraduationCap } from "../components/reusable/Icons";
import "./css/Login.css";
import { useAuth } from "../context/AuthContext";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const {refreshUser} = useAuth();

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json"},
        body: JSON.stringify({email, password}),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error);
        setLoading(false);
        return;
      }

      await refreshUser();

      const role = data.user.role;
      navigate(role === "organizer" ? "/organizer" : role === "admin" ? "/admin" : "/");
    } catch {
      setError("Something went wrong. Please try again!")
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
          <h2>Welcome Back</h2>
        </div>

        <div className="login-tabs">
          <span className="active">Sign In</span>
          <Link to="/register">Register</Link>
        </div>

        <div className="login-form">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div style={{ textAlign: "right"}}>
            <Link to="/reset-password">Reset Password</Link>
          </div>

          {error && <p className="error-text">{error}</p>}

          <button
            className="btn-primary"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>

        <p className="login-footer">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}


export default Login;
