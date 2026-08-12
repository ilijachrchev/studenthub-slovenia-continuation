import { requestJson } from "./http";

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  return query.toString();
}

export function listOpportunities(params = {}) {
  const query = buildQuery(params);
  return requestJson(`/api/opportunities${query ? `?${query}` : ""}`);
}

export function getOpportunity(id) {
  return requestJson(`/api/opportunities/${id}`);
}

export function getOpportunityRecommendations() {
  return requestJson("/api/recommendations");
}

export function listSavedOpportunityIds() {
  return requestJson("/api/opportunities/saved/ids");
}

export function listSavedOpportunities() {
  return requestJson("/api/opportunities/saved");
}

export function toggleOpportunityBookmark(id, bookmarked) {
  return requestJson(`/api/opportunities/${id}/bookmark`, {
    method: bookmarked ? "POST" : "DELETE",
  });
}

export function listMyApplications() {
  return requestJson("/api/opportunities/applications");
}

export function applyToOpportunity(id, body) {
  return requestJson(`/api/opportunities/${id}/apply`, {
    method: "POST",
    body,
  });
}

export function withdrawApplication(id) {
  return requestJson(`/api/opportunities/${id}/apply`, {
    method: "DELETE",
  });
}

