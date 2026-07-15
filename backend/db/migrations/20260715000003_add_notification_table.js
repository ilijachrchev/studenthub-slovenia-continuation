/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS notification (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      related_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_notification_user ON notification(user_id)"
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_notification_user_read ON notification(user_id, is_read)"
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw("DROP TABLE IF EXISTS notification");
};
