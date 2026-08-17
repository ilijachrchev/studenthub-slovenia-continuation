const pool = require("../db");

/**
 * Authentication and authorization middleware.
 *
 * requireAuth — ensures req.session.user exists, otherwise 401.
 * requireRole(role) — ensures the authenticated user has the specified role, otherwise 403.
 * requireAdminRecord — ensures the authenticated admin also has a row in the admin table.
 * requireModerator — ensures the authenticated user has a row in the moderator OR admin
 *   table. Session role is never trusted on its own for privileged access: the acting
 *   identity is always re-verified against the database record.
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

/**
 * Loads the caller's privileged moderation identity directly from the
 * database — never from the client or from session role claims alone.
 * Returns { kind: 'admin' | 'moderator', recordId } or null.
 */
async function loadModerationActor(userId) {
    const { rows } = await pool.query(
        `SELECT 'admin' AS kind, id FROM admin WHERE user_id = $1
         UNION ALL
         SELECT 'moderator' AS kind, id FROM moderator WHERE user_id = $1`,
        [userId]
    );

    if (rows.length === 0) {
        return null;
    }

    // Prefer the admin record when a user somehow holds both (admin implies
    // full moderator authority everywhere in this feature).
    const adminRow = rows.find((row) => row.kind === "admin");
    const chosen = adminRow || rows[0];
    return { kind: chosen.kind, recordId: chosen.id, userId };
}

function requireModerator(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    loadModerationActor(req.session.user.id)
        .then((actor) => {
            if (!actor) {
                return res.status(403).json({ error: "Moderator or admin privileges required" });
            }
            req.moderationActor = actor;
            return next();
        })
        .catch((error) => next(error));
}

/**
 * Like requireModerator but only admins pass — for actions (reassignment,
 * escalated-report resolution, direct content takedowns outside the report
 * workflow) that must not be delegable to ordinary moderators.
 */
function requireModerationAdmin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    loadModerationActor(req.session.user.id)
        .then((actor) => {
            if (!actor || actor.kind !== "admin") {
                return res.status(403).json({ error: "Admin privileges required" });
            }
            req.moderationActor = actor;
            return next();
        })
        .catch((error) => next(error));
}

module.exports = {
    requireAuth,
    requireRole,
    requireAdminRecord,
    requireModerator,
    requireModerationAdmin,
    loadModerationActor,
};
