import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap } from "../components/reusable/Icons";
import "./css/Login.css";

function ResetPassword() {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!email || !currentPassword || !newPassword) {
      setError("All fields are required.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error);
        setLoading(false);
        return;
      }

      setSuccess("Password updated. You can now log in.");
      setEmail("");
      setCurrentPassword("");
      setNewPassword("");
      setLoading(false);
    } catch {
      setError("Something went wrong. Please try again!");
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
          <h2>Reset Password</h2>
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
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          {error && <p className="error-text">{error}</p>}
          {success && <p style={{ color: "#16a34a" }}>{success}</p>}

          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Saving..." : "Reset Password"}
          </button>
        </div>

        <p className="login-footer">
          Remembered it? <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  );
}


export default ResetPassword;
