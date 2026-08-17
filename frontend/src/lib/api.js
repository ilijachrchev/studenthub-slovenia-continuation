export class ApiError extends Error {
  constructor(
    message,
    { status = 0, data = null, response = null, url = "", method = "GET", code = "" } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.response = response;
    this.url = url;
    this.method = method;
    this.code = code;
  }
}

function isBodyInit(value) {
  return (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  );
}

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

async function readResponseBody(response) {
  if (response.status === 204) {
    return null;
  }

  if (typeof response.text !== "function" && typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const looksJson = contentType.includes("application/json") || contentType.includes("+json");

  if (looksJson) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(data, status) {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (data && typeof data === "object") {
    return data.error || data.message || `Request failed with status ${status}`;
  }

  return `Request failed with status ${status}`;
}

function buildInit(options = {}) {
  const {
    method = "GET",
    headers: inputHeaders,
    body,
    credentials = "include",
    ...rest
  } = options;

  const headers = { ...(inputHeaders || {}) };
  const init = { method, headers, credentials, ...rest };

  if (body !== undefined) {
    if (isBodyInit(body) || typeof body === "string") {
      init.body = body;
    } else if (isPlainObject(body) || Array.isArray(body)) {
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
      init.body = JSON.stringify(body);
    } else {
      init.body = body;
    }
  }

  return init;
}

export async function apiRequest(input, options = {}) {
  let response;

  try {
    response = await fetch(input, buildInit(options));
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("Request was aborted", {
        code: "aborted",
        url: String(input),
        method: options.method || "GET",
      });
    }

    throw new ApiError(error?.message || "Network request failed", {
      url: String(input),
      method: options.method || "GET",
    });
  }

  const data = await readResponseBody(response);

  if (!response.ok) {
    throw new ApiError(getErrorMessage(data, response.status), {
      status: response.status,
      data,
      response,
      url: String(input),
      method: options.method || "GET",
      code: "http_error",
    });
  }

  return data;
}

export function isApiError(error) {
  return error instanceof ApiError;
}

export function getApiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (isApiError(error)) {
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
