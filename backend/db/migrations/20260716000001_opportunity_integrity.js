/**
 * Opportunity integrity hardening (WP-DB-01)
 *
 * The opportunity/application schema (migration ..._add_opportunity_applications_notifications)
 * left three integrity gaps that this migration closes:
 *
 *   1. `opportunity` had no `updated_at` column, so lifecycle changes were not timestamped.
 *   2. `application.updated_at` was maintained only in application code (NOW() in UPDATE
 *      statements). Any writer that forgets to set it would silently drift.
 *   3. The opportunity/application foreign keys had no ON DELETE policy (implicit RESTRICT),
 *      leaving deletion behavior undefined for the parent -> child chain
 *      organization -> opportunity -> application -> application_history.
 *
 * This migration is idempotent (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
 * CREATE OR REPLACE for the function/triggers) and reversible. Requires PostgreSQL >= 14
 * for CREATE OR REPLACE TRIGGER (project runs PostgreSQL 16).
 */

exports.up = async function (knex) {
  // 1. opportunity.updated_at
  await knex.raw(
    `ALTER TABLE opportunity
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`
  );

  // 2. Reusable trigger function that stamps updated_at on every UPDATE.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE OR REPLACE TRIGGER trg_opportunity_set_updated_at
      BEFORE UPDATE ON opportunity
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  await knex.raw(`
    CREATE OR REPLACE TRIGGER trg_application_set_updated_at
      BEFORE UPDATE ON application
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // 3. Explicit ON DELETE CASCADE down the ownership chain.
  await knex.raw(`
    ALTER TABLE opportunity DROP CONSTRAINT IF EXISTS opportunity_organization_id_foreign;
    ALTER TABLE opportunity
      ADD CONSTRAINT opportunity_organization_id_foreign
      FOREIGN KEY (organization_id) REFERENCES organization (id) ON DELETE CASCADE;
  `);

  await knex.raw(`
    ALTER TABLE application DROP CONSTRAINT IF EXISTS application_opportunity_id_foreign;
    ALTER TABLE application
      ADD CONSTRAINT application_opportunity_id_foreign
      FOREIGN KEY (opportunity_id) REFERENCES opportunity (id) ON DELETE CASCADE;
  `);

  await knex.raw(`
    ALTER TABLE application DROP CONSTRAINT IF EXISTS application_applicant_user_id_foreign;
    ALTER TABLE application
      ADD CONSTRAINT application_applicant_user_id_foreign
      FOREIGN KEY (applicant_user_id) REFERENCES "user" (id) ON DELETE CASCADE;
  `);

  // 4. Composite index for the hot discovery predicate: status = 'published' AND deadline > NOW().
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_opportunity_status_deadline
       ON opportunity (status, deadline)`
  );
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_opportunity_status_deadline`);

  // Restore the original FKs (no explicit ON DELETE policy).
  await knex.raw(`
    ALTER TABLE application DROP CONSTRAINT IF EXISTS application_applicant_user_id_foreign;
    ALTER TABLE application
      ADD CONSTRAINT application_applicant_user_id_foreign
      FOREIGN KEY (applicant_user_id) REFERENCES "user" (id);
  `);

  await knex.raw(`
    ALTER TABLE application DROP CONSTRAINT IF EXISTS application_opportunity_id_foreign;
    ALTER TABLE application
      ADD CONSTRAINT application_opportunity_id_foreign
      FOREIGN KEY (opportunity_id) REFERENCES opportunity (id);
  `);

  await knex.raw(`
    ALTER TABLE opportunity DROP CONSTRAINT IF EXISTS opportunity_organization_id_foreign;
    ALTER TABLE opportunity
      ADD CONSTRAINT opportunity_organization_id_foreign
      FOREIGN KEY (organization_id) REFERENCES organization (id);
  `);

  await knex.raw(`DROP TRIGGER IF EXISTS trg_application_set_updated_at ON application`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_opportunity_set_updated_at ON opportunity`);
  await knex.raw(`DROP FUNCTION IF EXISTS set_updated_at()`);

  await knex.raw(`ALTER TABLE opportunity DROP COLUMN IF EXISTS updated_at`);
};
