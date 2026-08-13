const session = require("express-session");

function parseSessionExpiry(sess, fallbackTtlMs) {
  if (sess && sess.cookie && sess.cookie.expires) {
    const expires = new Date(sess.cookie.expires);
    if (!Number.isNaN(expires.getTime())) {
      return expires;
    }
  }

  return new Date(Date.now() + fallbackTtlMs);
}

class PostgresSessionStore extends session.Store {
  constructor({ pool, tableName = "session", ttl = 24 * 60 * 60 * 1000 }) {
    super();
    this.pool = pool;
    this.tableName = tableName;
    this.ttl = ttl;
  }

  async get(sid, callback) {
    try {
      const { rows } = await this.pool.query(
        `SELECT sess, expire FROM ${this.tableName} WHERE sid = $1`,
        [sid]
      );

      if (rows.length === 0) {
        return callback(null, null);
      }

      const record = rows[0];
      if (record.expire && new Date(record.expire) <= new Date()) {
        await this.destroy(sid, (error) => {
          if (error) {
            callback(error);
            return;
          }
          callback(null, null);
        });
        return;
      }

      const sessionData = typeof record.sess === "string" ? JSON.parse(record.sess) : record.sess;
      callback(null, sessionData);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      const expire = parseSessionExpiry(sess, this.ttl);
      await this.pool.query(
        `INSERT INTO ${this.tableName} (sid, sess, expire)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid)
         DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), expire]
      );
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.pool.query(
        `DELETE FROM ${this.tableName} WHERE sid = $1`,
        [sid]
      );
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const expire = parseSessionExpiry(sess, this.ttl);
      await this.pool.query(
        `UPDATE ${this.tableName} SET expire = $2 WHERE sid = $1`,
        [sid, expire]
      );
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async clear(callback) {
    try {
      await this.pool.query(`DELETE FROM ${this.tableName}`);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async length(callback) {
    try {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*)::int AS count FROM ${this.tableName} WHERE expire > NOW()`
      );
      callback?.(null, rows[0].count);
    } catch (error) {
      callback?.(error);
    }
  }

  async all(callback) {
    try {
      const { rows } = await this.pool.query(
        `SELECT sid, sess FROM ${this.tableName} WHERE expire > NOW()`
      );
      callback?.(
        null,
        rows.map((row) => (typeof row.sess === "string" ? JSON.parse(row.sess) : row.sess))
      );
    } catch (error) {
      callback?.(error);
    }
  }
}

module.exports = PostgresSessionStore;
