/**
 * Opportunity lifecycle history + idempotency support.
 *
 * Adds the bookkeeping columns and tables needed to treat `opportunity` as a
 * first-class stateful entity (draft -> published -> closed -> archived),
 * mirroring the audit-trail pattern already used for `application` /
 * `application_history`.
 *
 * - opportunity: adds updated_at/closed_at/archived_at timestamps so every
 *   lifecycle milestone is queryable without re-deriving it from history.
 * - opportunity_history: append-only audit trail of every opportunity status
 *   transition (who did it, from/to status, optional reason).
 * - idempotency_key: generic store used by mutation endpoints to make
 *   repeated requests (client retries, double-clicks) safe to replay.
 */

exports.up = async function up(knex) {
  const hasOpportunity = await knex.schema.hasTable("opportunity");
  if (!hasOpportunity) {
    throw new Error(
      "Migration aborted: table \"opportunity\" must exist before opportunity_lifecycle_history"
    );
  }

  if (!(await knex.schema.hasColumn("opportunity", "updated_at"))) {
    await knex.schema.alterTable("opportunity", (t) => {
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasColumn("opportunity", "closed_at"))) {
    await knex.schema.alterTable("opportunity", (t) => {
      t.timestamp("closed_at").nullable();
    });
  }
  if (!(await knex.schema.hasColumn("opportunity", "archived_at"))) {
    await knex.schema.alterTable("opportunity", (t) => {
      t.timestamp("archived_at").nullable();
    });
  }

  if (!(await knex.schema.hasTable("opportunity_history"))) {
    await knex.schema.createTable("opportunity_history", (t) => {
      t.increments("id").primary();
      t.integer("opportunity_id").notNullable();
      t.string("action", 50).notNullable();
      t.string("from_status", 50).nullable();
      t.string("to_status", 50).notNullable();
      t.integer("actor_user_id").nullable();
      t.string("actor_role", 20).nullable();
      t.text("reason").nullable();
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("actor_user_id").references("user.id");
    });
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_opportunity_history_opportunity ON opportunity_history (opportunity_id, created_at)"
    );
  }

  if (!(await knex.schema.hasTable("idempotency_key"))) {
    await knex.schema.createTable("idempotency_key", (t) => {
      t.increments("id").primary();
      t.string("scope", 100).notNullable();
      t.string("idempotency_key", 255).notNullable();
      t.integer("user_id").notNullable();
      t.string("request_hash", 64).notNullable();
      t.integer("response_status").notNullable();
      t.jsonb("response_body").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["scope", "idempotency_key", "user_id"], "uniq_idempotency_key");
      t.foreign("user_id").references("user.id").onDelete("CASCADE");
    });
  }

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_opportunity_org_status ON opportunity (organization_id, status)"
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("idempotency_key");
  await knex.schema.dropTableIfExists("opportunity_history");

  if (await knex.schema.hasColumn("opportunity", "archived_at")) {
    await knex.schema.alterTable("opportunity", (t) => t.dropColumn("archived_at"));
  }
  if (await knex.schema.hasColumn("opportunity", "closed_at")) {
    await knex.schema.alterTable("opportunity", (t) => t.dropColumn("closed_at"));
  }
  if (await knex.schema.hasColumn("opportunity", "updated_at")) {
    await knex.schema.alterTable("opportunity", (t) => t.dropColumn("updated_at"));
  }
};
