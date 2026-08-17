export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.payload = options.payload ?? null;
  }
}

export async function requestJson(input, init = {}) {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload === "string"
      ? payload
      : payload.error || payload.message || `Request failed with status ${response.status}`;

    throw new ApiError(message, {
      status: response.status,
      code: response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : null,
      payload,
    });
  }

  return payload;
}

export function getApiErrorMessage(error, fallback = "Something went wrong") {
  if (!error) {
    return fallback;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  return error.message || fallback;
}
