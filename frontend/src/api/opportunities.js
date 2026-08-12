const defaultOptions = { credentials: "include" };

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...defaultOptions,
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      message = body.error || body.message || message;
    } catch {
      // Keep the HTTP status message when the response has no JSON body.
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

const json = (method, body) => ({
  method,
  body: JSON.stringify(body),
});

export const listOpportunities = (params = {}) => {
  const query = new URLSearchParams(params);
  return request(`/api/opportunities?${query.toString()}`);
};

export const getOpportunity = (id) => request(`/api/opportunities/${id}`);
export const getRelatedOpportunities = (id) => request(`/api/opportunities/${id}/related`);
export const getSavedOpportunityIds = () => request("/api/opportunities/saved/ids");
export const getSavedOpportunities = () => request("/api/opportunities/saved");

export const saveOpportunity = (id) =>
  request(`/api/opportunities/${id}/bookmark`, json("POST"));
export const unsaveOpportunity = (id) =>
  request(`/api/opportunities/${id}/bookmark`, json("DELETE"));

export const applyToOpportunity = (id, coverNote = "") =>
  request(`/api/applications/${id}/apply`, json("POST", { coverNote }));
export const listMyApplications = () => request("/api/applications/mine");
export const getOpportunityApplicants = (id) =>
  request(`/api/applications/opportunities/${id}/applications`);
export const transitionApplication = (id, transition) =>
  request(`/api/applications/${id}/transition`, json("POST", transition));
export const getApplicationHistory = (id) =>
  request(`/api/applications/${id}/history`);
export const withdrawApplication = (id) =>
  transitionApplication(id, { to: "withdrawn" });

export const listNotifications = (params = {}) => {
  const query = new URLSearchParams(params);
  return request(`/api/notifications?${query.toString()}`);
};
export const markNotificationRead = (id) =>
  request(`/api/notifications/${id}/read`, json("POST"));
export const markAllNotificationsRead = () =>
  request("/api/notifications/read-all", json("POST"));
export const getNotificationPreferences = () =>
  request("/api/notifications/preferences");
export const updateNotificationPreferences = (preferences) =>
  request("/api/notifications/preferences", json("PUT", preferences));

export const getRecommendations = (limit) =>
  request(`/api/recommendations${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`);

export const recordAnalyticsEvent = (eventType, data = {}) =>
  request("/api/analytics/events", json("POST", {
    eventType,
    ...data,
  }));

export const reportOpportunity = (id, report) =>
  request(`/api/opportunities/${id}/report`, json("POST", report));
export const listModerationReports = (status = "") =>
  request(`/api/admin/moderation/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const resolveModerationReport = (id, resolution) =>
  request(`/api/admin/moderation/reports/${id}/resolve`, json("POST", resolution));

export const listOrganizerOpportunities = () => request("/api/organizer/opportunities");
export const createOpportunity = (opportunity) =>
  request("/api/organizer/opportunities", json("POST", opportunity));
export const updateOpportunity = (id, opportunity) =>
  request(`/api/organizer/opportunities/${id}`, json("PUT", opportunity));
export const submitOpportunity = (id) =>
  request(`/api/organizer/opportunities/${id}/submit`, json("POST"));
export const closeOpportunity = (id) =>
  request(`/api/organizer/opportunities/${id}/close`, json("POST"));
export const archiveOpportunity = (id) =>
  request(`/api/organizer/opportunities/${id}/archive`, json("POST"));
export const getOpportunityAnalytics = (id) =>
  request(`/api/organizer/opportunities/${id}/analytics`);
export const getOrganizerAnalyticsSummary = () =>
  request("/api/organizer/analytics/summary");

