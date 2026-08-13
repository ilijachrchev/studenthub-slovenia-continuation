import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap } from "../components/reusable/Icons";
import "./css/Login.css";
import { apiRequest, getApiErrorMessage } from "../lib/api";

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
      await apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: {
          email,
          current_password: currentPassword,
          new_password: newPassword,
        },
      });

      setSuccess("Password updated. You can now log in.");
      setEmail("");
      setCurrentPassword("");
      setNewPassword("");
      setLoading(false);
    } catch (error) {
      setError(getApiErrorMessage(error, "Something went wrong. Please try again!"));
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
