/**
 * Trust & Safety: moderation reports, moderator roster, and an append-only
 * moderation audit log.
 *
 * Design notes:
 *  - `moderation_report` is polymorphic (`target_type` + `target_id`) so it can
 *    cover opportunities today and other resource types later without another
 *    migration. Only "opportunity" is validated at the application layer for now.
 *  - A partial unique index blocks a reporter from opening a second active
 *    report against the same target while one is already open/under_review —
 *    the primary defense against report spam/duplicate reports.
 *  - `moderation_audit_log` is append-only: a trigger rejects UPDATE/DELETE at
 *    the database layer so a compromised or buggy application process cannot
 *    rewrite history, only add to it.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("moderator"))) {
    await knex.schema.createTable("moderator", (t) => {
      t.increments("id").primary();
      t.integer("user_id").notNullable().unique("uniq_moderator_user");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("user_id").references("user.id").onDelete("CASCADE");
    });
  }

  if (!(await knex.schema.hasTable("moderation_report"))) {
    await knex.schema.createTable("moderation_report", (t) => {
      t.increments("id").primary();
      t.string("target_type", 30).notNullable();
      t.integer("target_id").notNullable();
      t.integer("reporter_user_id").notNullable();
      t.string("category", 50).notNullable().defaultTo("other");
      t.string("severity", 20).notNullable().defaultTo("medium");
      t.text("reason").notNullable();
      t.string("status", 20).notNullable().defaultTo("open");
      t.integer("assigned_moderator_user_id").nullable();
      t.timestamp("assigned_at").nullable();
      t.integer("resolved_by_user_id").nullable();
      t.timestamp("resolved_at").nullable();
      t.string("resolution_action", 50).nullable();
      t.text("resolution_note").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      t.foreign("reporter_user_id").references("user.id").onDelete("CASCADE");
      t.foreign("assigned_moderator_user_id").references("user.id").onDelete("SET NULL");
      t.foreign("resolved_by_user_id").references("user.id").onDelete("SET NULL");
    });

    await knex.raw(`
      ALTER TABLE moderation_report
      ADD CONSTRAINT chk_moderation_report_status
      CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed', 'escalated'))
    `);
    await knex.raw(`
      ALTER TABLE moderation_report
      ADD CONSTRAINT chk_moderation_report_severity
      CHECK (severity IN ('low', 'medium', 'high', 'critical'))
    `);
    await knex.raw(`
      ALTER TABLE moderation_report
      ADD CONSTRAINT chk_moderation_report_target_type
      CHECK (target_type IN ('opportunity'))
    `);

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_report_status ON moderation_report (status, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_report_target ON moderation_report (target_type, target_id)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_report_reporter ON moderation_report (reporter_user_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_report_assignee ON moderation_report (assigned_moderator_user_id)"
    );
    // Only one *active* report per (reporter, target) — resolved/dismissed
    // reports don't block a fresh report if the problem recurs.
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_moderation_report
      ON moderation_report (target_type, target_id, reporter_user_id)
      WHERE status IN ('open', 'under_review', 'escalated')
    `);
  }

  if (!(await knex.schema.hasTable("moderation_audit_log"))) {
    await knex.schema.createTable("moderation_audit_log", (t) => {
      t.increments("id").primary();
      t.integer("actor_user_id").nullable();
      t.string("action", 100).notNullable();
      t.string("target_type", 30).notNullable();
      t.integer("target_id").notNullable();
      t.integer("report_id").nullable();
      t.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      t.foreign("actor_user_id").references("user.id").onDelete("SET NULL");
      t.foreign("report_id").references("moderation_report.id").onDelete("SET NULL");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_audit_target ON moderation_audit_log (target_type, target_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_audit_report ON moderation_audit_log (report_id, created_at ASC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_moderation_audit_actor ON moderation_audit_log (actor_user_id, created_at DESC)"
    );

    // Append-only enforcement: reject UPDATE/DELETE at the database layer so
    // the audit trail cannot be rewritten even by a compromised app process.
    await knex.raw(`
      CREATE OR REPLACE FUNCTION moderation_audit_log_immutable()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'moderation_audit_log is append-only: % is not permitted', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      DROP TRIGGER IF EXISTS trg_moderation_audit_log_no_update ON moderation_audit_log
    `);
    await knex.raw(`
      CREATE TRIGGER trg_moderation_audit_log_no_update
      BEFORE UPDATE OR DELETE ON moderation_audit_log
      FOR EACH ROW EXECUTE FUNCTION moderation_audit_log_immutable()
    `);
  }

  // "hidden" is the moderation-imposed takedown state for opportunities,
  // distinct from an organizer's own draft/archived states.
};

exports.down = async function (knex) {
  await knex.raw("DROP TRIGGER IF EXISTS trg_moderation_audit_log_no_update ON moderation_audit_log");
  await knex.raw("DROP FUNCTION IF EXISTS moderation_audit_log_immutable()");
  await knex.schema.dropTableIfExists("moderation_audit_log");
  await knex.schema.dropTableIfExists("moderation_report");
  await knex.schema.dropTableIfExists("moderator");
};
