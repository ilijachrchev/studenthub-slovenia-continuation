/**
 * Expand opportunity lifecycle support.
 *
 * Adds the columns and join tables needed by the existing opportunity frontend:
 * - richer opportunity metadata for organizer CRUD
 * - opportunity tags
 * - opportunity bookmarks
 * - application history notes
 */

exports.up = async function (knex) {
  if (await knex.schema.hasTable("opportunity")) {
    const columns = [
      ["summary", (t) => t.text("summary").nullable()],
      ["start_date", (t) => t.timestamp("start_date").nullable()],
      ["end_date", (t) => t.timestamp("end_date").nullable()],
      ["application_deadline", (t) => t.timestamp("application_deadline").nullable()],
      ["capacity", (t) => t.integer("capacity").nullable()],
      ["compensation", (t) => t.string("compensation", 255).nullable()],
      ["contact_email", (t) => t.string("contact_email", 255).nullable()],
      ["apply_url", (t) => t.string("apply_url", 500).nullable()],
      ["updated_at", (t) => t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now())],
      ["closed_at", (t) => t.timestamp("closed_at").nullable()],
      ["archived_at", (t) => t.timestamp("archived_at").nullable()],
    ];

    for (const [name, builder] of columns) {
      if (!(await knex.schema.hasColumn("opportunity", name))) {
        await knex.schema.alterTable("opportunity", builder);
      }
    }

    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_application_deadline ON opportunity (application_deadline)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status_updated ON opportunity (status, updated_at DESC)");
  }

  if (!(await knex.schema.hasTable("opportunity_tag"))) {
    await knex.schema.createTable("opportunity_tag", (t) => {
      t.integer("opportunity_id").notNullable();
      t.integer("tag_id").notNullable();
      t.primary(["opportunity_id", "tag_id"]);
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("tag_id").references("tag.id");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_tag_tag ON opportunity_tag (tag_id)");
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
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_bookmark_user ON opportunity_bookmark (user_id, saved_at DESC)");
  }

  if (await knex.schema.hasTable("application_history")) {
    if (!(await knex.schema.hasColumn("application_history", "note"))) {
      await knex.schema.alterTable("application_history", (t) => {
        t.text("note").nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable("application_history")) {
    if (await knex.schema.hasColumn("application_history", "note")) {
      await knex.schema.alterTable("application_history", (t) => {
        t.dropColumn("note");
      });
    }
  }

  await knex.schema.dropTableIfExists("opportunity_bookmark");
  await knex.schema.dropTableIfExists("opportunity_tag");
  if (await knex.schema.hasTable("opportunity")) {
    await knex.schema.alterTable("opportunity", (t) => {
      t.dropColumn("summary");
      t.dropColumn("start_date");
      t.dropColumn("end_date");
      t.dropColumn("application_deadline");
      t.dropColumn("capacity");
      t.dropColumn("compensation");
      t.dropColumn("contact_email");
      t.dropColumn("apply_url");
      t.dropColumn("updated_at");
      t.dropColumn("closed_at");
      t.dropColumn("archived_at");
    }).catch(() => {});
  }
};
