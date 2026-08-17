const session = require("express-session");

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

class PostgresSessionStore extends session.Store {
  constructor(pool, options = {}) {
    super();
    this.pool = pool;
    this.tableName = options.tableName || "session";
  }

  async get(sid, callback) {
    try {
      const { rows } = await this.pool.query(
        `SELECT sess, expire
         FROM ${this.tableName}
         WHERE sid = $1`,
        [sid]
      );

      if (rows.length === 0) {
        return callback(null, null);
      }

      const expiresAt = toDate(rows[0].expire);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        await this.destroy(sid, () => {});
        return callback(null, null);
      }

      return callback(null, rows[0].sess);
    } catch (error) {
      return callback(error);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const cookie = sessionData && sessionData.cookie ? sessionData.cookie : {};
      const expiresAt =
        toDate(cookie.expires) ||
        (Number.isFinite(cookie.maxAge) ? new Date(Date.now() + cookie.maxAge) : new Date(Date.now() + DEFAULT_MAX_AGE_MS));

      await this.pool.query(
        `INSERT INTO ${this.tableName} (sid, sess, expire)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid)
         DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sessionData), expiresAt]
      );

      return callback && callback(null);
    } catch (error) {
      return callback && callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.pool.query(
        `DELETE FROM ${this.tableName}
         WHERE sid = $1`,
        [sid]
      );

      return callback && callback(null);
    } catch (error) {
      return callback && callback(error);
    }
  }

  async touch(sid, sessionData, callback) {
    try {
      const cookie = sessionData && sessionData.cookie ? sessionData.cookie : {};
      const expiresAt =
        toDate(cookie.expires) ||
        (Number.isFinite(cookie.maxAge) ? new Date(Date.now() + cookie.maxAge) : new Date(Date.now() + DEFAULT_MAX_AGE_MS));

      await this.pool.query(
        `UPDATE ${this.tableName}
         SET expire = $2
         WHERE sid = $1`,
        [sid, expiresAt]
      );

      return callback && callback(null);
    } catch (error) {
      return callback && callback(error);
    }
  }
}

module.exports = PostgresSessionStore;
