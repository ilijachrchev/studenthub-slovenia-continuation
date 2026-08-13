const pool = require("../db");

/**
 * Authentication and authorization middleware.
 *
 * requireAuth — ensures req.session.user exists, otherwise 401.
 * requireRole(role) — ensures the authenticated user has the specified role, otherwise 403.
 * requireAdminRecord — ensures the authenticated admin also has a row in the admin table.
 */

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }
    next();
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: "Not logged in" });
        }
        if (req.session.user.role !== role) {
            return res.status(403).json({ error: `Only ${role}s can access this` });
        }
        next();
    };
}

function requireAdminRecord(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    if (req.session.user.role !== "admin") {
        return res.status(403).json({ error: "Only admins can access this" });
    }

    pool.query(
        "SELECT id FROM admin WHERE user_id = $1",
        [req.session.user.id]
    ).then(({ rows }) => {
        if (rows.length === 0) {
            return res.status(403).json({ error: "No admin record found for this account" });
        }

        req.admin = { id: rows[0].id, user_id: req.session.user.id };
        return next();
    }).catch((error) => next(error));
}

module.exports = { requireAuth, requireRole, requireAdminRecord };
