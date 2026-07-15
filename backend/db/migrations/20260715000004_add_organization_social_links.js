/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE organization
    ADD COLUMN IF NOT EXISTS facebook VARCHAR(500),
    ADD COLUMN IF NOT EXISTS instagram VARCHAR(500),
    ADD COLUMN IF NOT EXISTS linkedin VARCHAR(500),
    ADD COLUMN IF NOT EXISTS twitter VARCHAR(500)
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE organization
    DROP COLUMN IF EXISTS facebook,
    DROP COLUMN IF EXISTS instagram,
    DROP COLUMN IF EXISTS linkedin,
    DROP COLUMN IF EXISTS twitter
  `);
};
