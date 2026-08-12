/**
 * Opportunity applications and notifications schema.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("opportunity"))) {
    await knex.schema.createTable("opportunity", (t) => {
      t.increments("id").primary();
      t.integer("organization_id").notNullable();
      t.string("title", 255).notNullable();
      t.text("description").nullable();
      t.string("location", 255).nullable();
      t.string("status", 50).notNullable().defaultTo("draft");
      t.timestamp("deadline").notNullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("published_at").nullable();
      t.foreign("organization_id").references("organization.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status ON opportunity (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_deadline ON opportunity (deadline)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_organization ON opportunity (organization_id)");
  }

  if (!(await knex.schema.hasTable("application"))) {
    await knex.schema.createTable("application", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.integer("applicant_user_id").notNullable();
      t.text("cover_note").nullable();
      t.string("status", 50).notNullable().defaultTo("pending");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["opportunity_id", "applicant_user_id"], "uniq_application_per_opportunity");
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("applicant_user_id").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_opportunity ON application (opportunity_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_applicant ON application (applicant_user_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_status ON application (status)");
  }

  if (!(await knex.schema.hasTable("application_history"))) {
    await knex.schema.createTable("application_history", (t) => {
      t.increments("id").primary();
      t.integer("application_id").notNullable();
      t.string("action", 50).notNullable();
      t.string("from_status", 50).nullable();
      t.string("to_status", 50).notNullable();
      t.integer("actor_user_id").notNullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("application_id").references("application.id").onDelete("CASCADE");
      t.foreign("actor_user_id").references("user.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_history_application ON application_history (application_id, created_at)");
  }

  if (!(await knex.schema.hasTable("notification_preferences"))) {
    await knex.schema.createTable("notification_preferences", (t) => {
      t.integer("user_id").primary();
      t.jsonb("preferences").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("user_id").references("user.id").onDelete("CASCADE");
    });
  }

  if (!(await knex.schema.hasTable("notification"))) {
    await knex.schema.createTable("notification", (t) => {
      t.increments("id").primary();
      t.integer("recipient_user_id").notNullable();
      t.string("type", 100).notNullable();
      t.jsonb("payload").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.boolean("is_read").notNullable().defaultTo(false);
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("read_at").nullable();
      t.foreign("recipient_user_id").references("user.id").onDelete("CASCADE");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_notification_recipient_created ON notification (recipient_user_id, created_at DESC)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_notification_recipient_read ON notification (recipient_user_id, is_read)");
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("notification");
  await knex.schema.dropTableIfExists("notification_preferences");
  await knex.schema.dropTableIfExists("application_history");
  await knex.schema.dropTableIfExists("application");
  await knex.schema.dropTableIfExists("opportunity");
};
