exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("analytics_events"))) {
    await knex.schema.createTable("analytics_events", (t) => {
      t.increments("id").primary();
      t.string("event_type", 120).notNullable();
      t.integer("actor_user_id").nullable();
      t.integer("opportunity_id").nullable();
      t.integer("application_id").nullable();
      t.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("actor_user_id").references("user.id").onDelete("SET NULL");
      t.foreign("opportunity_id").references("event.id").onDelete("CASCADE");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events (event_type)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_analytics_events_opportunity ON analytics_events (opportunity_id)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_analytics_events_actor ON analytics_events (actor_user_id)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events (created_at)"
    );
  }

  if (!(await knex.schema.hasTable("opportunity_report"))) {
    await knex.schema.createTable("opportunity_report", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("reporter_user_id").notNullable();
      t.string("reason", 60).notNullable();
      t.text("details").nullable();
      t.string("status", 20).notNullable().defaultTo("open");
      t.integer("resolved_by_user_id").nullable();
      t.timestamp("resolved_at").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["opportunity_id", "reporter_user_id"], "uniq_opportunity_reporter");
      t.foreign("opportunity_id").references("event.id").onDelete("CASCADE");
      t.foreign("reporter_user_id").references("user.id").onDelete("CASCADE");
      t.foreign("resolved_by_user_id").references("user.id").onDelete("SET NULL");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_status ON opportunity_report (status)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_opportunity ON opportunity_report (opportunity_id)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_report_created_at ON opportunity_report (created_at)"
    );
  }
};

exports.down = async function (knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_opportunity_report_created_at");
  await knex.raw("DROP INDEX IF EXISTS idx_opportunity_report_opportunity");
  await knex.raw("DROP INDEX IF EXISTS idx_opportunity_report_status");
  await knex.schema.dropTableIfExists("opportunity_report");

  await knex.raw("DROP INDEX IF EXISTS idx_analytics_events_created_at");
  await knex.raw("DROP INDEX IF EXISTS idx_analytics_events_actor");
  await knex.raw("DROP INDEX IF EXISTS idx_analytics_events_opportunity");
  await knex.raw("DROP INDEX IF EXISTS idx_analytics_events_type");
  await knex.schema.dropTableIfExists("analytics_events");
};
