/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS event_view (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
      viewed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_event_view_event ON event_view(event_id)"
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_event_view_event_time ON event_view(event_id, viewed_at)"
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw("DROP TABLE IF EXISTS event_view");
};
