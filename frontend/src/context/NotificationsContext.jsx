/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { normaliseNotification, toArray, unwrapMessage } from "../components/opportunities/opportunitiesUtils";

const DEFAULT_PREFERENCES = {
  application_updates: true,
  recommendation_updates: true,
  deadline_reminders: true,
};

const NotificationsContext = createContext(null);

function mergePreferences(current, incoming) {
  return {
    ...DEFAULT_PREFERENCES,
    ...current,
    ...(incoming || {}),
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState("");
  const [preferencesError, setPreferencesError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const successTimerRef = useRef(null);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.unread).length,
    [notifications],
  );

  const clearSuccessMessage = useCallback(() => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setSuccessMessage("");
  }, []);

  const scheduleSuccess = useCallback((message) => {
    clearSuccessMessage();
    setSuccessMessage(message);
    successTimerRef.current = setTimeout(() => {
      setSuccessMessage("");
      successTimerRef.current = null;
    }, 3500);
  }, [clearSuccessMessage]);

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user) {
      setNotifications([]);
      setPreferences(DEFAULT_PREFERENCES);
      setLoading(false);
      setRefreshing(false);
      setListError("");
      setPreferencesError("");
      setActionError("");
      clearSuccessMessage();
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    clearSuccessMessage();
    setActionError("");

    const [listRes, prefsRes] = await Promise.allSettled([
      fetch("/api/notifications", { credentials: "include" }),
      fetch("/api/notifications/preferences", { credentials: "include" }),
    ]);

    if (listRes.status === "fulfilled") {
      const response = listRes.value;
      const data = await readJson(response);
      if (response.ok) {
        const nextItems = toArray(data.notifications || data.items || data).map(normaliseNotification);
        setNotifications(nextItems);
        setListError("");
      } else {
        setListError(unwrapMessage(data, "Failed to load notifications"));
      }
    } else {
      setListError("Failed to load notifications");
    }

    if (prefsRes.status === "fulfilled") {
      const response = prefsRes.value;
      const data = await readJson(response);
      if (response.ok) {
        setPreferences((current) => mergePreferences(current, data.preferences || data));
        setPreferencesError("");
      } else {
        setPreferencesError(unwrapMessage(data, "Failed to load notification preferences"));
      }
    } else {
      setPreferencesError("Failed to load notification preferences");
    }

    if (!silent) {
      setLoading(false);
    }
    setRefreshing(false);
  }, [clearSuccessMessage, user]);

  useEffect(() => {
    let alive = true;

    const sync = async (options) => {
      if (!alive) return;
      await loadNotifications(options);
    };

    sync();

    const handleFocus = () => {
      sync({ silent: true });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        sync({ silent: true });
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      alive = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadNotifications]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const markRead = useCallback(async (notificationId) => {
    const previous = notifications;
    setNotifications((current) =>
      current.map((item) => (String(item.id) === String(notificationId) ? { ...item, unread: false } : item)),
    );
    setActionError("");
    clearSuccessMessage();

    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "POST",
        credentials: "include",
      });
      const data = await readJson(response);
      if (!response.ok) {
        setNotifications(previous);
        const message = unwrapMessage(data, "Failed to mark notification as read");
        setActionError(message);
        return { ok: false, error: message };
      }

      scheduleSuccess("Notification marked as read.");
      return { ok: true };
    } catch {
      setNotifications(previous);
      const message = "Failed to mark notification as read";
      setActionError(message);
      return { ok: false, error: message };
    }
  }, [clearSuccessMessage, notifications, scheduleSuccess]);

  const markAllRead = useCallback(async () => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));
    setActionError("");
    clearSuccessMessage();

    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "include",
      });
      const data = await readJson(response);
      if (!response.ok) {
        setNotifications(previous);
        const message = unwrapMessage(data, "Failed to mark notifications as read");
        setActionError(message);
        return { ok: false, error: message };
      }

      scheduleSuccess("All notifications marked as read.");
      return { ok: true };
    } catch {
      setNotifications(previous);
      const message = "Failed to mark notifications as read";
      setActionError(message);
      return { ok: false, error: message };
    }
  }, [clearSuccessMessage, notifications, scheduleSuccess]);

  const updatePreferences = useCallback(async (nextPreferences) => {
    const previous = preferences;
    setPreferences(nextPreferences);
    setActionError("");
    clearSuccessMessage();

    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextPreferences),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setPreferences(previous);
        const message = unwrapMessage(data, "Failed to save notification preferences");
        setActionError(message);
        return { ok: false, error: message };
      }

      setPreferences((current) => mergePreferences(current, data.preferences || data));
      scheduleSuccess("Notification preferences saved.");
      return { ok: true };
    } catch {
      setPreferences(previous);
      const message = "Failed to save notification preferences";
      setActionError(message);
      return { ok: false, error: message };
    }
  }, [clearSuccessMessage, preferences, scheduleSuccess]);

  const value = useMemo(() => ({
    notifications,
    preferences,
    loading,
    refreshing,
    unreadCount,
    listError,
    preferencesError,
    actionError,
    successMessage,
    refresh: () => loadNotifications({ silent: true }),
    reload: () => loadNotifications(),
    markRead,
    markAllRead,
    updatePreferences,
    clearActionError: () => setActionError(""),
    clearSuccessMessage,
  }), [
    actionError,
    loadNotifications,
    loading,
    markAllRead,
    markRead,
    notifications,
    preferences,
    preferencesError,
    refreshing,
    successMessage,
    unreadCount,
    updatePreferences,
    listError,
    clearSuccessMessage,
  ]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
