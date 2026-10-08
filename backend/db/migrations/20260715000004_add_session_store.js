/**
 * PostgreSQL session store table (WP-SEC-01)
 *
 * Required by the express-session middleware when backed by a PostgreSQL store.
 * The session table stores serialised session data with an expiry timestamp
 * so the store (or a periodic CRON) can purge stale rows.
 *
 * Schema mirrors what connect-pg-simple and the custom PostgresSessionStore
 * (middleware/postgresSessionStore.js) both expect:
 *   sid    – session identifier (PRIMARY KEY)
 *   sess   – serialised session JSON
 *   expire – absolute expiry timestamp
 *
 * Idempotent (hasTable guard) and reversible.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("session"))) {
    await knex.schema.createTable("session", (t) => {
      t.string("sid", 255).primary();
      t.jsonb("sess").notNullable();
      t.timestamp("expire").notNullable();
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire)"
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("session");
};
