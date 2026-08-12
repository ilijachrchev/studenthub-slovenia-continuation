import { useEffect, useState } from "react";
import {
  formatDateTime,
  normaliseNotification,
  toArray,
  unwrapMessage,
} from "../../components/opportunities/opportunitiesUtils";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import "./../opportunities/css/opportunities.css";

const DEFAULT_PREFERENCES = {
  application_updates: true,
  recommendation_updates: true,
  deadline_reminders: true,
};

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadNotifications() {
      try {
        const [listRes, prefsRes] = await Promise.all([
          fetch("/api/notifications", { credentials: "include" }),
          fetch("/api/notifications/preferences", { credentials: "include" }),
        ]);
        const listData = await listRes.json().catch(() => ({}));
        const prefsData = await prefsRes.json().catch(() => ({}));

        if (!alive) return;

        if (!listRes.ok) {
          setError(unwrapMessage(listData, "Failed to load notifications"));
          return;
        }

        setNotifications(toArray(listData.notifications || listData.items || listData).map(normaliseNotification));
        setPreferences((current) => ({
          ...current,
          ...(prefsData.preferences || prefsData),
        }));
      } catch {
        if (alive) setError("Failed to load notifications");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadNotifications();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/notifications?unread=1", {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const unreadIds = new Set(
            toArray(data.notifications || data.items || data).map((notification) =>
              String(notification.id ?? notification.notification_id)
            )
          );
          setNotifications((current) =>
            current.map((item) => ({ ...item, unread: unreadIds.has(String(item.id)) }))
          );
        }
      } catch (error) {
        void error;
      }
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  const unreadCount = notifications.filter((notification) => notification.unread).length;

  const markRead = async (notification) => {
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, unread: false } : item))
    );

    try {
      const response = await fetch(`/api/notifications/${notification.id}/read`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("read-failed");
    } catch {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, unread: true } : item))
      );
    }
  };

  const markAllRead = async () => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));

    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("read-all-failed");
    } catch {
      setNotifications(previous);
    }
  };

  const togglePreference = async (key) => {
    const nextPreferences = { ...preferences, [key]: !preferences[key] };
    setPreferences(nextPreferences);
    setSavingPreferences(true);

    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextPreferences),
      });
      if (!response.ok) throw new Error("prefs-failed");
    } catch {
      setPreferences((current) => ({ ...current, [key]: preferences[key] }));
    } finally {
      setSavingPreferences(false);
    }
  };

  if (loading) return <p className="opp-page-status">Loading notifications...</p>;
  if (error) return <p className="opp-page-status error-text">{error}</p>;

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Inbox</div>
        <h1 className="opp-page-title">Notifications</h1>
        <p className="opp-page-subtitle">
          Stay on top of application updates, recommendations, and deadlines. Unread items are
          checked automatically in the topbar.
        </p>
      </section>

      <div className="opp-notifications-head">
        <div className="opp-toolbar-meta">
          {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
        </div>
        <button type="button" className="opp-secondary-btn" onClick={markAllRead}>
          Mark all read
        </button>
      </div>

      <section className="opp-panel">
        <h2>Preferences</h2>
        <div className="opp-toggle-list">
          {[
            {
              key: "application_updates",
              title: "Application updates",
              description: "Status changes and withdrawal confirmations.",
            },
            {
              key: "recommendation_updates",
              title: "Recommendations",
              description: "New matches and discovery suggestions.",
            },
            {
              key: "deadline_reminders",
              title: "Deadline reminders",
              description: "Heads-up notifications before an opportunity closes.",
            },
          ].map((item) => (
            <div key={item.key} className="opp-toggle">
              <label htmlFor={item.key}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </label>
              <button
                id={item.key}
                type="button"
                className={`opp-switch ${preferences[item.key] ? "on" : ""}`}
                onClick={() => togglePreference(item.key)}
                aria-pressed={preferences[item.key]}
                disabled={savingPreferences}
              />
            </div>
          ))}
        </div>
      </section>

      {notifications.length === 0 ? (
        <div className="opp-empty">You have no notifications yet.</div>
      ) : (
        <div className="opp-notification-list">
          {notifications.map((notification) => (
            <article
              key={notification.id}
              className={`opp-notification-card ${notification.unread ? "unread" : ""}`}
            >
              <div className="opp-notification-top">
                <div>
                  <h2 className="opp-notification-title">{notification.title}</h2>
                  <p className="opp-notification-body">{notification.body}</p>
                </div>
                {notification.unread && (
                  <span className="opp-notification-flag">Unread</span>
                )}
              </div>

              <div className="opp-notification-meta">
                {notification.createdAt && <span>{formatDateTime(notification.createdAt)}</span>}
                <ApplicationStatusBadge status={notification.type} />
              </div>

              {notification.unread && (
                <div className="opp-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="opp-secondary-btn" onClick={() => markRead(notification)}>
                    Mark read
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default Notifications;


