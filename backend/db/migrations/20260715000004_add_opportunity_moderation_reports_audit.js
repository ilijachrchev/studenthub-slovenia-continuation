/**
 * Opportunity moderation reports and audit trail.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("opportunity_report"))) {
    await knex.schema.createTable("opportunity_report", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("reporter_user_id").notNullable();
      t.string("category", 50).notNullable().defaultTo("other");
      t.text("reason").notNullable();
      t.string("status", 20).notNullable().defaultTo("open");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("reviewed_at").nullable();
      t.integer("reviewed_by_user_id").nullable();
      t.boolean("archive_opportunity").notNullable().defaultTo(false);
      t.text("resolution_note").nullable();
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("reporter_user_id").references("user.id").onDelete("CASCADE");
      t.foreign("reviewed_by_user_id").references("user.id").onDelete("SET NULL");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_status ON opportunity_report (status, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_opportunity ON opportunity_report (opportunity_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_reporter ON opportunity_report (reporter_user_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_opportunity_report ON opportunity_report (opportunity_id, reporter_user_id) WHERE status IN ('open', 'in_review')"
    );
  }

  if (!(await knex.schema.hasTable("opportunity_bookmark"))) {
    await knex.schema.createTable("opportunity_bookmark", (t) => {
      t.increments("id").primary();
      t.integer("user_id").notNullable();
      t.integer("opportunity_id").notNullable();
      t.timestamp("saved_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["user_id", "opportunity_id"], "uniq_opportunity_bookmark");
      t.foreign("user_id").references("user.id").onDelete("CASCADE");
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_bookmark_user ON opportunity_bookmark (user_id, saved_at DESC)"
    );
  }

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
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("moderation_audit_log");
  await knex.schema.dropTableIfExists("opportunity_bookmark");
  await knex.schema.dropTableIfExists("opportunity_report");
};
