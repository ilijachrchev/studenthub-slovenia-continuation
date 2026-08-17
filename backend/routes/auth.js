const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const { validateRegistration, validatePasswordChange, isValidEmail } = require("../middleware/validate");
const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");

const router = express.Router();

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = process.env.NODE_ENV === "test" ? 5 : 20;

const loginLimiter = rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: AUTH_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts, please try again later" },
});

const registerLimiter = rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: AUTH_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many registration attempts, please try again later" },
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: AUTH_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many password reset attempts, please try again later" },
});

const sessionCookieName = "connect.sid";
const sessionCookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    path: "/",
};

function destroySession(req, res, message) {
    req.session.destroy((err) => {
        if (err) {
            logger.error({ err }, "Failed to destroy session");
            return res.status(500).json({ error: "Internal server error" });
        }

        res.clearCookie(sessionCookieName, sessionCookieOptions);
        return res.json(message);
    });
}

// /api/auth/register POST method
router.post("/register", registerLimiter, catchAsync(async (req, res) => {
    const { first_name, last_name, email, password, role } = req.body;

    if (!first_name || !last_name || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }

    const validationErrors = validateRegistration(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0] });
    }

    const userRole = role === "organizer" ? "organizer" : "student";

    // validate email domain for students
    if (userRole === "student") {
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain) {
            return res.status(400).json({ error: "Invalid email format" });
        }
        const { rows: faculties } = await pool.query(
            "SELECT id FROM faculty WHERE email_domain = $1",
            [domain]
        );
        if (faculties.length === 0) {
            return res.status(400).json({
                error: "Email domain not recognized. Please use your institutional email.",
            });
        }
    }

    // check if mail is already existing
    const { rows: existing } = await pool.query(
        "SELECT id FROM \"user\" WHERE email = $1",
        [email]
    );
    if (existing.length > 0) {
        return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // insert new user
    const { rows: [result] } = await pool.query(
        `INSERT INTO "user" (first_name, last_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [first_name, last_name, email, hashedPassword, userRole]
    );

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).json({ error: "Registration failed" });
        }

        req.session.user = {
            id: result.id,
            first_name,
            last_name,
            email,
            role: userRole,
        };

        res.status(201).json({ message: "Registration successful" });
    });

    logger.info({ userId: result.id, role: userRole }, "User registered");
}));

// /api/auth/login POST method
router.post("/login", loginLimiter, catchAsync(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const { rows: users } = await pool.query(
        'SELECT id, first_name, last_name, email, role, password_hash FROM "user" WHERE email = $1',
        [email]
    );
    if (users.length === 0) {
        logger.warn("Login failed: unknown email");
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = users[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        logger.warn({ userId: user.id }, "Login failed: wrong password");
        return res.status(401).json({ error: "Invalid email or password" });
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).json({ error: "Login failed" });
        }

        req.session.user = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role,
        };

        res.json({ message: "Login successful", user: req.session.user });
    });

    logger.info({ userId: user.id, role: user.role }, "User logged in");
}));

// /api/auth/me GET method
router.get("/me", (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: "Not logged in" });
    }
});

// /api/auth/logout POST method
router.post("/logout", (req, res) => {
    destroySession(req, res, { message: "Logged out" });
});

// /api/auth/reset-password POST method
router.post("/reset-password", passwordResetLimiter, catchAsync(async (req, res) => {
    const { email, current_password, new_password } = req.body;

    if (!email || !current_password || !new_password) {
        return res.status(400).json({ error: "All fields are required" });
    }

    const validationErrors = validatePasswordChange(req.body);
    if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0] });
    }

    const { rows: users } = await pool.query(
        'SELECT id, password_hash FROM "user" WHERE email = $1',
        [email]
    );
    if (users.length === 0) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(current_password, users[0].password_hash);
    if (!match) {
        logger.warn({ userId: users[0].id }, "Password reset failed: wrong current password");
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query(
        'UPDATE "user" SET password_hash = $1 WHERE id = $2',
        [hashedPassword, users[0].id]
    );

    logger.info({ userId: users[0].id }, "Password updated");

    destroySession(req, res, { message: "Password updated successfully" });
}));


module.exports = router;
