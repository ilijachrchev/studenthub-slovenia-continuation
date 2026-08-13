export class ApiError extends Error {
  constructor(message, { status = 0, data = null, response = null, url = "", method = "GET", code = "" } = {}) {
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

function buildAbortSignal(inputSignal, timeoutMs) {
  if (!inputSignal && !timeoutMs) {
    return { signal: undefined, cleanup: undefined };
  }

  const controller = new AbortController();
  let timeoutId = null;
  const abort = () => controller.abort();

  if (inputSignal) {
    if (inputSignal.aborted) {
      controller.abort();
    } else {
      inputSignal.addEventListener("abort", abort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (inputSignal) {
        inputSignal.removeEventListener("abort", abort);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    },
  };
}

function buildInit(options = {}) {
  const {
    method = "GET",
    headers: inputHeaders,
    body,
    credentials = "include",
    signal,
    timeoutMs,
    ...rest
  } = options;

  const headers = { ...(inputHeaders || {}) };
  const init = { method, headers, credentials, ...rest };
  const abort = buildAbortSignal(signal, timeoutMs);

  if (abort.signal) {
    init.signal = abort.signal;
  }

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

  return { init, cleanup: abort.cleanup };
}

export async function apiRequest(input, options = {}) {
  const { init, cleanup } = buildInit(options);

  try {
    const response = await fetch(input, init);
    const data = await readResponseBody(response);

    if (!response.ok) {
      throw new ApiError(getErrorMessage(data, response.status), {
        status: response.status,
        data,
        response,
        url: String(input),
        method: options.method || "GET",
      });
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError" || init.signal?.aborted) {
      throw new ApiError("Request aborted", {
        url: String(input),
        method: options.method || "GET",
        code: "aborted",
      });
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(error?.message || "Network request failed", {
      url: String(input),
      method: options.method || "GET",
    });
  } finally {
    cleanup?.();
  }
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
