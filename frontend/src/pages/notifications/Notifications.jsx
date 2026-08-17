import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StatusBadge from "../../components/shared/StatusBadge";
import {
  formatDateTime,
  normaliseNotification,
  toArray,
} from "../../components/opportunities/opportunitiesUtils";
import PageState, { InlineState } from "../../components/shared/PageState";
import { getApiErrorMessage, requestJson } from "../../api/http";
import "./../opportunities/css/opportunities.css";

const DEFAULT_PREFERENCES = {
  "application.received": true,
  "application.status_changed": true,
  recommendation_updates: true,
  deadline_reminders: true,
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const controller = new AbortController();

    async function loadNotifications() {
      try {
        const [listData, prefsData] = await Promise.all([
          requestJson("/api/notifications", { signal: controller.signal }),
          requestJson("/api/notifications/preferences", { signal: controller.signal }).catch((error) => {
            if (error?.status === 401) return { preferences: DEFAULT_PREFERENCES };
            throw error;
          }),
        ]);

        setNotifications(toArray(listData.notifications || listData.items || listData).map(normaliseNotification));
        setPreferences((current) => ({
          ...current,
          ...(prefsData.preferences || prefsData),
        }));
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "aborted") return;
        setPageError(getApiErrorMessage(error, "Failed to load notifications"));
      } finally {
        setLoading(false);
      }
    }

    void loadNotifications();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await requestJson("/api/notifications?unread=1");
        const unreadIds = new Set(
          toArray(data.notifications || data.items || data).map((notification) =>
            String(notification.id ?? notification.notification_id)
          )
        );
        setNotifications((current) =>
          current.map((item) => ({ ...item, unread: unreadIds.has(String(item.id)) }))
        );
      } catch {
        // Silent poll failure. The page already has visible state.
      }
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.unread).length,
    [notifications]
  );

  const visibleNotifications = useMemo(() => {
    if (filter === "unread") {
      return notifications.filter((notification) => notification.unread);
    }
    if (filter === "read") {
      return notifications.filter((notification) => !notification.unread);
    }
    return notifications;
  }, [filter, notifications]);

  const markRead = async (notification) => {
    const previous = notifications;
    setActionError("");
    setActionMessage("");
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, unread: false } : item))
    );

    try {
      const data = await requestJson(`/api/notifications/${notification.id}/read`, {
        method: "POST",
      });
      setActionMessage(data.message || "Notification marked as read.");
    } catch (error) {
      setNotifications(previous);
      setActionError(getApiErrorMessage(error, "Failed to mark the notification as read"));
    }
  };

  const markAllRead = async () => {
    const previous = notifications;
    setActionError("");
    setActionMessage("");
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));

    try {
      const data = await requestJson("/api/notifications/read-all", {
        method: "POST",
      });
      setActionMessage(data.message || "Notifications marked as read.");
    } catch (error) {
      setNotifications(previous);
      setActionError(getApiErrorMessage(error, "Failed to mark notifications as read"));
    }
  };

  const togglePreference = async (key) => {
    const nextPreferences = { ...preferences, [key]: !preferences[key] };
    setPreferences(nextPreferences);
    setSavingPreferences(true);
    setActionError("");
    setActionMessage("");

    try {
      const data = await requestJson("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPreferences),
      });
      setPreferences((current) => ({
        ...current,
        ...(data.preferences || data),
      }));
      setActionMessage("Notification preferences updated.");
    } catch (error) {
      setPreferences((current) => ({ ...current, [key]: preferences[key] }));
      setActionError(getApiErrorMessage(error, "Failed to update notification preferences"));
    } finally {
      setSavingPreferences(false);
    }
  };

  if (loading) {
    return (
      <PageState
        variant="loading"
        title="Loading notifications"
        message="Fetching unread and read updates from your inbox."
      />
    );
  }

  if (pageError) {
    return (
      <PageState
        variant="error"
        title="Notifications"
        message={pageError}
        actionLabel="Retry"
        onAction={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Inbox</div>
        <h1 className="opp-page-title">Notifications</h1>
        <p className="opp-page-subtitle">
          Stay on top of application updates, recommendations, and deadlines. Read and unread items
          sync with the backend.
        </p>
      </section>

      {actionError && (
        <InlineState
          variant="error"
          message={actionError}
          actionLabel="Dismiss"
          onAction={() => setActionError("")}
        />
      )}

      {actionMessage && (
        <InlineState
          variant="success"
          message={actionMessage}
          actionLabel="Dismiss"
          onAction={() => setActionMessage("")}
        />
      )}

      <div className="opp-notifications-head">
        <div className="opp-toolbar-meta">
          {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
        </div>
        <div className="opp-actions">
          <button type="button" className="opp-secondary-btn" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
      </div>

      <div className="opp-toolbar opp-notification-toolbar">
        <div className="opp-filter-pills" role="tablist" aria-label="Notification filter">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`opp-filter-pill ${filter === item.value ? "active" : ""}`}
              onClick={() => setFilter(item.value)}
              aria-pressed={filter === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Link to="/opportunities" className="opp-link">
          Open opportunities
        </Link>
      </div>

      <section className="opp-panel">
        <h2>Preferences</h2>
        <div className="opp-toggle-list">
          {[
            {
              key: "application.received",
              title: "Application updates",
              description: "New applications and status changes.",
            },
            {
              key: "application.status_changed",
              title: "Status changes",
              description: "Withdrawals and review updates for your applications.",
            },
            {
              key: "deadline_reminders",
              title: "Deadline reminders",
              description: "Heads-up notifications before an opportunity closes.",
            },
            {
              key: "recommendation_updates",
              title: "Recommendations",
              description: "New discovery suggestions.",
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
                aria-label={item.title}
                disabled={savingPreferences}
              />
            </div>
          ))}
        </div>
      </section>

      {visibleNotifications.length === 0 ? (
        <PageState
          variant="empty"
          title="No notifications"
          message={
            filter === "all"
              ? "You have no notifications yet."
              : "No notifications match this filter."
          }
        />
      ) : (
        <div className="opp-notification-list">
          {visibleNotifications.map((notification) => (
            <article
              key={notification.id}
              className={`opp-notification-card ${notification.unread ? "unread" : ""}`}
            >
              <div className="opp-notification-top">
                <div>
                  <h2 className="opp-notification-title">{notification.title}</h2>
                  <p className="opp-notification-body">{notification.body}</p>
                </div>
                {notification.unread && <span className="opp-notification-flag">Unread</span>}
              </div>

              <div className="opp-notification-meta">
                {notification.createdAt && <span>{formatDateTime(notification.createdAt)}</span>}
                <StatusBadge status={notification.type} />
                {notification.payload?.opportunityId && (
                  <Link to={`/opportunities/${notification.payload.opportunityId}`} className="opp-link">
                    View opportunity
                  </Link>
                )}
              </div>

              {notification.unread && (
                <div className="opp-actions" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="opp-secondary-btn"
                    onClick={() => markRead(notification)}
                  >
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
