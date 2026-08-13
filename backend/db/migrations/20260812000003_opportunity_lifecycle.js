/**
 * Opportunity lifecycle schema
 *
 * Adds the minimal tables needed for opportunity state tracking:
 * - opportunity_category
 * - opportunity
 * - opportunity_tag
 * - opportunity_status_history
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("opportunity_category"))) {
    await knex.schema.createTable("opportunity_category", (t) => {
      t.increments("id").primary();
      t.string("name", 120).notNullable();
      t.string("slug", 120).notNullable();
      t.text("description").nullable();

      t.unique(["slug"], "uniq_opportunity_category_slug");
    });
  }

  if (!(await knex.schema.hasTable("opportunity"))) {
    await knex.schema.createTable("opportunity", (t) => {
      t.increments("id").primary();
      t.integer("organization_id").notNullable();
      t.integer("posted_by").notNullable();
      t.integer("category_id").nullable();
      t.string("title", 255).notNullable();
      t.text("description").nullable();
      t.string("type", 50).nullable();
      t.string("location", 255).nullable();
      t.boolean("is_remote").notNullable().defaultTo(false);
      t.string("application_mode", 20).notNullable().defaultTo("built_in");
      t.string("external_url", 500).nullable();
      t.string("compensation", 120).nullable();
      t.integer("capacity").nullable();
      t.timestamp("application_deadline").nullable();
      t.timestamp("starts_at").nullable();
      t.timestamp("published_at").nullable();
      t.string("status", 50).notNullable().defaultTo("draft");
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      t.foreign("organization_id").references("organization.id");
      t.foreign("posted_by").references("user.id");
      t.foreign("category_id").references("opportunity_category.id");
    });

    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status ON opportunity (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_published_at ON opportunity (published_at)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_org_status ON opportunity (organization_id, status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_category ON opportunity (category_id)");
  }

  if (!(await knex.schema.hasTable("opportunity_tag"))) {
    await knex.schema.createTable("opportunity_tag", (t) => {
      t.integer("opportunity_id").notNullable();
      t.integer("tag_id").notNullable();
      t.primary(["opportunity_id", "tag_id"]);
      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("tag_id").references("tag.id");
    });
  }

  if (!(await knex.schema.hasTable("opportunity_status_history"))) {
    await knex.schema.createTable("opportunity_status_history", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.string("previous_status", 50).nullable();
      t.string("next_status", 50).notNullable();
      t.integer("actor_user_id").notNullable();
      t.text("reason").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      t.foreign("opportunity_id").references("opportunity.id");
      t.foreign("actor_user_id").references("user.id");
    });

    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status_history_opportunity ON opportunity_status_history (opportunity_id, created_at)");
  }
};

exports.down = async function down(knex) {
  await knex.schema
    .dropTableIfExists("opportunity_status_history")
    .dropTableIfExists("opportunity_tag")
    .dropTableIfExists("opportunity")
    .dropTableIfExists("opportunity_category");
};
