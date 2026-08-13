export function getRoleHomePath(role) {
  if (role === "organizer") {
    return "/organizer";
  }

  if (role === "admin") {
    return "/admin";
  }

  return "/";
}

export function buildLoginPath({ next, reason } = {}) {
  const params = new URLSearchParams();

  if (next) {
    params.set("next", next);
  }

  if (reason) {
    params.set("reason", reason);
  }

  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
