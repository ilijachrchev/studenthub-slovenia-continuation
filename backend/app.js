const express = require('express');
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const path = require('path');
const fs = require('fs');

const authRoutes = require("./routes/auth");
const lookupRoutes = require("./routes/lookups");
const applicationsRoutes = require("./routes/applications");
const notificationsRoutes = require("./routes/notifications");
const studentRoutes = require("./routes/student");
const eventRoutes = require("./routes/events");
const registrationsRoutes = require("./routes/registrations");
const organizationsRoutes = require("./routes/organizations");
const opportunityRoutes = require("./routes/opportunities");
const recommendationsRoutes = require("./routes/recommendations");
const analyticsRoutes = require("./routes/analytics");
const moderationRoutes = require("./routes/moderation");
const organizerRoutes = require("./routes/organizer");
const adminRoutes = require("./routes/admin");
const bookmarksRoutes = require("./routes/bookmarks");
const feedbackRoutes = require("./routes/feedback");
const searchRoutes = require("./routes/search");
const { validateOrigin } = require("./middleware/csrf");
const PostgresSessionStore = require("./middleware/postgresSessionStore");
const logger = require("./middleware/logger");
const pinoHttp = require("pino-http");

const db = require("./db");

const app = express();
const sessionCookieName = process.env.SESSION_COOKIE_NAME || "connect.sid";
const apiRouteRegistry = [
    { mount: "/api/auth", description: "Authentication" },
    { mount: "/api", description: "Lookup routes" },
    { mount: "/api/student", description: "Student profile" },
    { mount: "/api/events", description: "Public events" },
    { mount: "/api/registrations", description: "Event registrations" },
    { mount: "/api/organizations", description: "Organization profiles" },
    { mount: "/api/opportunities", description: "Opportunity discovery and applications" },
    { mount: "/api/recommendations", description: "Opportunity recommendations" },
    { mount: "/api/analytics", description: "Opportunity analytics" },
    { mount: "/api/moderation", description: "Moderation workflow" },
    { mount: "/api/organizer", description: "Organizer tools" },
    { mount: "/api/admin", description: "Admin moderation" },
    { mount: "/api/bookmarks", description: "Saved events" },
    { mount: "/api/feedback", description: "Event feedback" },
    { mount: "/api/search", description: "Search" },
    { mount: "/api/applications", description: "Opportunity applications" },
    { mount: "/api/notifications", description: "Notifications" },
];

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:30010";
app.use(cors({
    origin: allowedOrigin,
    credentials: true,
}));

app.use(express.json({ limit: '512kb' }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET environment variable is required in production");
    }
    console.warn("WARNING: Using default session secret. Set SESSION_SECRET in .env for production.");
}

const sessionStore = new PostgresSessionStore({
    pool: db,
    ttl: 24 * 60 * 60 * 1000,
});

app.use(
    session({
        secret: sessionSecret || "dev-only-insecure-secret",
        resave: false,
        saveUninitialized: false,
        name: sessionCookieName,
        store: sessionStore,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
            maxAge: 24 * 60 * 60 * 1000,
        },
    })
);

app.use(validateOrigin);

app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== "test" }));

app.get('/api/health', async (req, res) => {
  let database = "disconnected";
  try {
    await db.query("SELECT 1");
    database = "connected";
  } catch {
    // intentionally ignored — database is unreachable
  }
  const status = database === "connected" ? "ok" : "degraded";
  res.status(status === "ok" ? 200 : 503).json({
    status,
    database,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    status: "ok",
    message: "StudentHub Slovenia backend is running",
    routes: apiRouteRegistry,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", lookupRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/registrations", registrationsRoutes);
app.use("/api/opportunities", opportunityRoutes);
app.use("/api/organizations", organizationsRoutes);
app.use("/api/organizer", organizerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookmarks", bookmarksRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/recommendations", recommendationsRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", moderationRoutes);

const reactBuildPath = path.join(__dirname, './dist');
if (fs.existsSync(reactBuildPath)) {
    app.use(express.static(reactBuildPath));
    app.get("/*splat", (req, res) => {
        res.sendFile(path.join(reactBuildPath, "index.html"));
    });
}

// Global error handler — catches errors from non-catchAsync middleware
// and prevents Express default HTML error page (which leaks stack traces)
app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode;
    if (status) {
        logger.warn({ err: err.message }, "Client error");
        return res.status(status).json({ error: err.message });
    }
    logger.error({ err: err.message }, "Unhandled middleware error");
    res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
