/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS organization_follower (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, organization_id)
    )
  `);

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_org_follower_user ON organization_follower(user_id)"
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_org_follower_org ON organization_follower(organization_id)"
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw("DROP TABLE IF EXISTS organization_follower");
};
