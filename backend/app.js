const express = require('express');
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const path = require('path');
const fs = require('fs');
const pinoHttp = require("pino-http");

const authRoutes = require("./routes/auth");
const lookupRoutes = require("./routes/lookups");
const studentRoutes = require("./routes/student");
const eventRoutes = require("./routes/events");
const registrationsRoutes = require("./routes/registrations");
const organizationsRoutes = require("./routes/organizations");
const organizerRoutes = require("./routes/organizer");
const adminRoutes = require("./routes/admin");
const bookmarksRoutes = require("./routes/bookmarks");
const feedbackRoutes = require("./routes/feedback");
const searchRoutes = require("./routes/search");
const { validateOrigin } = require("./middleware/csrf");
const logger = require("./middleware/logger");
const requestIdMiddleware = require("./middleware/requestId");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");
const { getAppRuntimeConfig } = require("./config/runtime");

const db = require("./db");

const app = express();
const runtime = getAppRuntimeConfig();

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.set("trust proxy", runtime.trustProxy ? 1 : false);

const allowedOrigin = runtime.frontendUrl || "http://localhost:30010";
app.use(cors({
    origin: allowedOrigin,
    credentials: true,
}));

app.use(requestIdMiddleware);

app.use(pinoHttp({
    logger,
    autoLogging: runtime.envName !== "test",
    genReqId: (req) => req.id,
    customProps: (req) => ({
        requestId: req.id,
    }),
}));

app.use(express.json({ limit: '512kb' }));

app.use(
    session({
        secret: runtime.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: runtime.cookieSecure,
            maxAge: 24 * 60 * 60 * 1000,
        },
    })
);

app.use(validateOrigin);

app.get('/api/health', async (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

app.get("/api/ready", async (req, res) => {
  try {
    await db.query("SELECT 1 AS health");
    res.status(200).json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  } catch (error) {
    logger.warn({ err: error.message, requestId: req.id }, "Readiness check failed");
    res.status(503).json({
      status: "degraded",
      database: "disconnected",
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }
});

app.get('/api', (req, res) => {
  res.json({
    status: "ok",
    message: "Hello from the backend, IT IS RUNNING :)!",
    requestId: req.id,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", lookupRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/registrations", registrationsRoutes);
app.use("/api/organizations", organizationsRoutes);
app.use("/api/organizer", organizerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bookmarks", bookmarksRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/search", searchRoutes);
app.use("/api", notFound);

const reactBuildPath = path.join(__dirname, './dist');
if (fs.existsSync(reactBuildPath)) {
    app.use(express.static(reactBuildPath));
    app.get("/*splat", (req, res) => {
        res.sendFile(path.join(reactBuildPath, "index.html"));
    });
}

app.use(errorHandler);

module.exports = app;
