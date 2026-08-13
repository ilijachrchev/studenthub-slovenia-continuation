const rateLimit = require("express-rate-limit");

function getRateLimitIdentity(req) {
  const userId = req.session && req.session.user && req.session.user.id;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  if (userId) {
    return `user:${userId}:ip:${ip}`;
  }

  return `ip:${ip}`;
}

function createMutationLimiter({
  windowMs,
  max,
  testMax,
  routeName,
  message = "Too many requests, please try again later",
}) {
  return rateLimit({
    windowMs,
    max: process.env.NODE_ENV === "test" ? testMax ?? max : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    keyGenerator: (req) => `${routeName}:${getRateLimitIdentity(req)}`,
  });
}

const authLimiter = createMutationLimiter({
  routeName: "auth",
  windowMs: 15 * 60 * 1000,
  max: 15,
  testMax: 15,
  message: "Too many authentication attempts, please try again later",
});

const organizationLimiter = createMutationLimiter({
  routeName: "organization",
  windowMs: 15 * 60 * 1000,
  max: 10,
  testMax: 10,
  message: "Too many organization changes, please try again later",
});

const organizerEventLimiter = createMutationLimiter({
  routeName: "organizer-events",
  windowMs: 15 * 60 * 1000,
  max: 12,
  testMax: 12,
  message: "Too many event changes, please try again later",
});

const studentProfileLimiter = createMutationLimiter({
  routeName: "student-profile",
  windowMs: 15 * 60 * 1000,
  max: 10,
  testMax: 10,
  message: "Too many profile changes, please try again later",
});

const registrationLimiter = createMutationLimiter({
  routeName: "registrations",
  windowMs: 15 * 60 * 1000,
  max: 12,
  testMax: 12,
  message: "Too many registration changes, please try again later",
});

const bookmarkLimiter = createMutationLimiter({
  routeName: "bookmarks",
  windowMs: 15 * 60 * 1000,
  max: 20,
  testMax: 20,
  message: "Too many saved-event changes, please try again later",
});

const feedbackLimiter = createMutationLimiter({
  routeName: "feedback",
  windowMs: 15 * 60 * 1000,
  max: 10,
  testMax: 10,
  message: "Too many feedback submissions, please try again later",
});

const applicationLimiter = createMutationLimiter({
  routeName: "applications",
  windowMs: 15 * 60 * 1000,
  max: 10,
  testMax: 10,
  message: "Too many application changes, please try again later",
});

const notificationLimiter = createMutationLimiter({
  routeName: "notifications",
  windowMs: 15 * 60 * 1000,
  max: 5,
  testMax: 3,
  message: "Too many notification changes, please try again later",
});

const adminLimiter = createMutationLimiter({
  routeName: "admin",
  windowMs: 15 * 60 * 1000,
  max: 10,
  testMax: 10,
  message: "Too many admin actions, please try again later",
});

module.exports = {
  createMutationLimiter,
  authLimiter,
  organizationLimiter,
  organizerEventLimiter,
  studentProfileLimiter,
  registrationLimiter,
  bookmarkLimiter,
  feedbackLimiter,
  applicationLimiter,
  notificationLimiter,
  adminLimiter,
};
