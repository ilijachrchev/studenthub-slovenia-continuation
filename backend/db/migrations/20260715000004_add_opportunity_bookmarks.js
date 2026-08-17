/**
 * Opportunity bookmark support.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("opportunity_bookmark"))) {
    await knex.schema.createTable("opportunity_bookmark", (t) => {
      t.increments("id").primary();
      t.integer("user_id").notNullable();
      t.integer("opportunity_id").notNullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["user_id", "opportunity_id"], "uniq_opportunity_bookmark");
      t.foreign("user_id").references("user.id").onDelete("CASCADE");
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
    });

    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_bookmark_user ON opportunity_bookmark (user_id, created_at DESC)"
    );
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_bookmark_opportunity ON opportunity_bookmark (opportunity_id)"
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("opportunity_bookmark");
};
