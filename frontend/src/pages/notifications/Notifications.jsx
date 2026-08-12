import { useMemo } from "react";
import ApplicationStatusBadge from "../../components/opportunities/ApplicationStatusBadge";
import {
  formatDateTime,
} from "../../components/opportunities/opportunitiesUtils";
import { useNotifications } from "../../context/NotificationsContext";
import PageState, { InlineState } from "../../components/shared/PageState";
import "./../opportunities/css/opportunities.css";

const DEFAULT_PREFERENCES = {
  application_updates: true,
  recommendation_updates: true,
  deadline_reminders: true,
};

function Notifications() {
  const {
    notifications,
    preferences,
    loading,
    refreshing,
    listError,
    preferencesError,
    actionError,
    successMessage,
    unreadCount,
    reload,
    markRead,
    markAllRead,
    updatePreferences,
    clearActionError,
    clearSuccessMessage,
  } = useNotifications();

  const preferenceItems = useMemo(
    () => [
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
    ],
    [],
  );

  const togglePreference = async (key) => {
    await updatePreferences({
      ...DEFAULT_PREFERENCES,
      ...preferences,
      [key]: !preferences[key],
    });
  };

  if (loading) {
    return <PageState variant="loading" title="Loading notifications" message="Fetching your inbox and preferences." />;
  }

  return (
    <div className="opp-page opp-page-shell">
      <section className="opp-page-hero">
        <div className="opp-page-kicker">Inbox</div>
        <h1 className="opp-page-title">Notifications</h1>
        <p className="opp-page-subtitle">
          Stay on top of application updates, recommendations, and deadlines. Unread items sync with the topbar after refresh.
        </p>
      </section>

      {refreshing && (
        <InlineState
          variant="loading"
          message="Refreshing notifications..."
          className="notifications-refresh"
        />
      )}

      {actionError && (
        <InlineState
          variant="error"
          message={actionError}
          actionLabel="Dismiss"
          onAction={clearActionError}
        />
      )}

      {successMessage && (
        <InlineState
          variant="success"
          message={successMessage}
          actionLabel="Dismiss"
          onAction={clearSuccessMessage}
        />
      )}

      {(listError || preferencesError) && (
        <div className="opp-panel" role="status" aria-live="polite">
          {listError && <p className="error-text">{listError}</p>}
          {preferencesError && <p className="error-text">{preferencesError}</p>}
          <div className="opp-actions" style={{ marginTop: 12 }}>
            <button type="button" className="opp-secondary-btn" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="opp-notifications-head">
        <div className="opp-toolbar-meta">
          {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
        </div>
        <button type="button" className="opp-secondary-btn" onClick={markAllRead} disabled={unreadCount === 0}>
          Mark all read
        </button>
      </div>

      <section className="opp-panel" aria-labelledby="notification-preferences-title">
        <div className="panel-heading">
          <h2 id="notification-preferences-title">Preferences</h2>
        </div>
        <div className="opp-toggle-list">
          {preferenceItems.map((item) => (
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
                aria-pressed={Boolean(preferences[item.key])}
                aria-label={`${preferences[item.key] ? "Disable" : "Enable"} ${item.title.toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      </section>

      {notifications.length === 0 ? (
        <PageState
          variant="empty"
          title="No notifications yet"
          message="You have no notifications right now."
        />
      ) : (
        <div className="opp-notification-list" aria-live="polite">
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
                  <button
                    type="button"
                    className="opp-secondary-btn"
                    onClick={() => markRead(notification.id)}
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
