import { requestJson } from "./http";

export function listNotifications(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(`/api/notifications${suffix}`);
}

export function getNotificationPreferences() {
  return requestJson("/api/notifications/preferences");
}

export function updateNotificationPreferences(body) {
  return requestJson("/api/notifications/preferences", {
    method: "PUT",
    body,
  });
}

export function markNotificationRead(id) {
  return requestJson(`/api/notifications/${id}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead() {
  return requestJson("/api/notifications/read-all", {
    method: "POST",
  });
}

