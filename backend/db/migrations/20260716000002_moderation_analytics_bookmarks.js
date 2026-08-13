/**
 * Moderation, analytics, and opportunity-bookmark schema (WP-DB-02)
 *
 * The opportunity-hub frontend calls endpoints that currently have no backing tables:
 *   - /api/opportunities/:id/bookmark, /api/opportunities/saved  -> opportunity_bookmark
 *   - /api/admin/moderation/reports*                             -> opportunity_report
 *   - /api/organizer/opportunities/:id/analytics                 -> opportunity_event
 *
 * This migration creates those three tables so Agents 6 (analytics), 7 (moderation), and the
 * opportunity-bookmark work package can consume — not redefine — the schema.
 *
 * Status columns are left as plain strings here; CHECK constraints/enum discipline are added in
 * WP-DB-03. The set_updated_at() trigger function is created by the preceding integrity migration
 * (20260716000001) and is reused for opportunity_report.
 *
 * Idempotent (hasTable / IF NOT EXISTS guards) and reversible.
 */

exports.up = async function (knex) {
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
      "CREATE INDEX IF NOT EXISTS idx_opportunity_bookmark_user ON opportunity_bookmark (user_id)"
    );
  }

  if (!(await knex.schema.hasTable("opportunity_report"))) {
    await knex.schema.createTable("opportunity_report", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("reporter_user_id").notNullable();
      t.string("reason", 100).notNullable();
      t.text("details").nullable();
      t.string("status", 50).notNullable().defaultTo("open");
      t.text("resolution_note").nullable();
      t.integer("resolved_by_user_id").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("reporter_user_id").references("user.id").onDelete("CASCADE");
      t.foreign("resolved_by_user_id").references("user.id").onDelete("SET NULL");
    });
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_status ON opportunity_report (status, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_opportunity ON opportunity_report (opportunity_id)"
    );
    await knex.raw(`
      CREATE OR REPLACE TRIGGER trg_opportunity_report_set_updated_at
        BEFORE UPDATE ON opportunity_report
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable("opportunity_event"))) {
    await knex.schema.createTable("opportunity_event", (t) => {
      t.bigIncrements("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("user_id").nullable();
      t.string("event_type", 50).notNullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("user_id").references("user.id").onDelete("SET NULL");
    });
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_event_type ON opportunity_event (opportunity_id, event_type)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_event_created ON opportunity_event (opportunity_id, created_at)"
    );
  }
};

exports.down = async function (knex) {
  // Drop the report trigger before the table; do NOT drop set_updated_at() (owned by 20260716000001).
  await knex.raw("DROP TRIGGER IF EXISTS trg_opportunity_report_set_updated_at ON opportunity_report");
  await knex.schema.dropTableIfExists("opportunity_event");
  await knex.schema.dropTableIfExists("opportunity_report");
  await knex.schema.dropTableIfExists("opportunity_bookmark");
};
