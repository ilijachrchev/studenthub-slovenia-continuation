export class ApiError extends Error {
  constructor({ message, status = 0, code = "network_error", payload = null, url = "", cause = null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.url = url;
    this.cause = cause;
  }
}

function statusToCode(status) {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    case 500:
    case 502:
    case 503:
    case 504:
      return "server_error";
    default:
      return "request_failed";
  }
}

function extractMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload || fallback;
  return payload.error || payload.message || fallback;
}

export async function requestJson(url, options = {}) {
  const { headers, body, ...init } = options;

  let requestBody = body;
  const requestHeaders = new Headers(headers || {});

  if (
    requestBody &&
    typeof requestBody === "object" &&
    !(requestBody instanceof FormData) &&
    !(requestBody instanceof URLSearchParams) &&
    !(requestBody instanceof Blob)
  ) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(requestBody);
  }

  let response;

  try {
    response = await fetch(url, {
      credentials: "include",
      ...init,
      headers: requestHeaders,
      body: requestBody,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") {
      throw new ApiError({
        message: "Request cancelled",
        status: 0,
        code: "aborted",
        url,
        cause,
      });
    }
    throw new ApiError({
      message: "Network error",
      status: 0,
      code: "network_error",
      url,
      cause,
    });
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new ApiError({
      message: extractMessage(payload, response.statusText || "Request failed"),
      status: response.status,
      code: statusToCode(response.status),
      payload,
      url,
    });
  }

  return payload;
}

export function getApiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;

  if (!(error instanceof ApiError)) {
    return fallback;
  }

  const payload = error.payload;
  const detail = payload && typeof payload === "object" ? payload.error || payload.message || "" : "";

  switch (error.code) {
    case "network_error":
      return "Network error. Please check your connection and try again.";
    case "unauthorized":
      return detail || "Please sign in to continue.";
    case "forbidden":
      return detail || "You do not have permission to perform this action.";
    case "not_found":
      return detail || "The requested item could not be found.";
    case "conflict":
      return detail || "This action conflicts with the current state.";
    case "validation_error":
      return detail || "Please correct the highlighted fields and try again.";
    case "rate_limited":
      return detail || "Too many requests. Please wait and try again.";
    case "server_error":
      return detail || "The server had a problem. Please try again later.";
    default:
      return detail || fallback;
  }
}

export function getApiFieldErrors(error) {
  if (!(error instanceof ApiError)) return null;

  const payload = error.payload;
  if (!payload || typeof payload !== "object") return null;

  return payload.errors || payload.fieldErrors || payload.fields || null;
}
