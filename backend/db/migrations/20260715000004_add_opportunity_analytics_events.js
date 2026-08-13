exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("opportunity_analytics_event"))) {
    await knex.schema.createTable("opportunity_analytics_event", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.string("event_name", 100).notNullable();
      t.integer("actor_user_id").nullable();
      t.string("visitor_key", 255).nullable();
      t.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("actor_user_id").references("user.id").onDelete("SET NULL");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_analytics_event_opportunity_created ON opportunity_analytics_event (opportunity_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_analytics_event_opportunity_name ON opportunity_analytics_event (opportunity_id, event_name, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_analytics_event_visitor ON opportunity_analytics_event (opportunity_id, visitor_key)"
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("opportunity_analytics_event");
};
