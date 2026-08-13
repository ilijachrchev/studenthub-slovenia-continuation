/**
 * Moderation audit log and duplicate-open-report guard.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("moderation_audit_log"))) {
    await knex.schema.createTable("moderation_audit_log", (t) => {
      t.increments("id").primary();
      t.integer("actor_user_id").nullable();
      t.string("action", 100).notNullable();
      t.string("resource_type", 100).notNullable();
      t.integer("resource_id").notNullable();
      t.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("actor_user_id").references("user.id").onDelete("SET NULL");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_audit_resource ON moderation_audit_log (resource_type, resource_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_audit_actor ON moderation_audit_log (actor_user_id, created_at DESC)"
    );
  }

  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_opportunity_report_active
     ON opportunity_report (opportunity_id, reporter_user_id)
     WHERE status IN ('open', 'in_review')`
  );
};

exports.down = async function (knex) {
  await knex.raw("DROP INDEX IF EXISTS uniq_opportunity_report_active");
  await knex.raw("DROP INDEX IF EXISTS idx_moderation_audit_actor");
  await knex.raw("DROP INDEX IF EXISTS idx_moderation_audit_resource");
  await knex.schema.dropTableIfExists("moderation_audit_log");
};
