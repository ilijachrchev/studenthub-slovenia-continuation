/**
 * Opportunity applications and notifications schema.
 */

const OPPORTUNITY_STATUSES = [
  "draft",
  "submitted",
  "published",
  "closed",
  "archived",
  "rejected",
];

const APPLICATION_STATUSES = [
  "pending",
  "submitted",
  "under_review",
  "in_review",
  "shortlisted",
  "accepted",
  "approved",
  "rejected",
  "withdrawn",
  "declined",
  "cancelled",
  "canceled",
];

const APPLICATION_HISTORY_STATUSES = [
  "pending",
  "submitted",
  "under_review",
  "in_review",
  "shortlisted",
  "accepted",
  "approved",
  "rejected",
  "withdrawn",
  "declined",
  "cancelled",
  "canceled",
];

async function hasConstraint(knex, table, constraintName) {
  const { rows } = await knex.raw(
    `SELECT 1
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = ?
       AND t.relname = ?
       AND n.nspname = current_schema()
     LIMIT 1`,
    [constraintName, table]
  );

  return rows.length > 0;
}

async function ensureConstraint(knex, table, constraintName, definition) {
  if (await hasConstraint(knex, table, constraintName)) {
    return;
  }

  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${definition})`);
}

async function ensureTriggerFunction(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);
}

async function hasTrigger(knex, table, triggerName) {
  const { rows } = await knex.raw(
    `SELECT 1
     FROM pg_trigger
     WHERE tgname = ?
       AND tgrelid = ?::regclass
       AND NOT tgisinternal
     LIMIT 1`,
    [triggerName, table]
  );

  return rows.length > 0;
}

async function ensureUpdateTrigger(knex, table, triggerName) {
  if (await hasTrigger(knex, table, triggerName)) {
    return;
  }

  await knex.raw(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp()`);
}

async function ensureColumn(knex, table, columnSql, backfillSql) {
  await knex.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnSql}`);
  if (backfillSql) {
    await knex.raw(backfillSql);
  }
}

async function ensureStatusConstraints(knex) {
  await ensureConstraint(
    knex,
    "opportunity",
    "chk_opportunity_status",
    `status IN (${OPPORTUNITY_STATUSES.map((status) => `'${status}'`).join(", ")})`
  );

  await ensureConstraint(
    knex,
    "application",
    "chk_application_status",
    `status IN (${APPLICATION_STATUSES.map((status) => `'${status}'`).join(", ")})`
  );

  await ensureConstraint(
    knex,
    "application_history",
    "chk_application_history_action",
    `action IN ('application_created', 'status_transition')`
  );

  await ensureConstraint(
    knex,
    "application_history",
    "chk_application_history_from_status",
    `from_status IS NULL OR from_status IN (${APPLICATION_HISTORY_STATUSES.map((status) => `'${status}'`).join(", ")})`
  );

  await ensureConstraint(
    knex,
    "application_history",
    "chk_application_history_to_status",
    `to_status IN (${APPLICATION_HISTORY_STATUSES.map((status) => `'${status}'`).join(", ")})`
  );
}

async function ensureTables(knex) {
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
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("published_at").nullable();
      t.foreign("organization_id").references("organization.id").onDelete("CASCADE");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status ON opportunity (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_deadline ON opportunity (deadline)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_organization ON opportunity (organization_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_status_deadline ON opportunity (status, deadline)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_opportunity_organization_status ON opportunity (organization_id, status)");
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
      t.foreign("opportunity_id").references("opportunity.id").onDelete("CASCADE");
      t.foreign("applicant_user_id").references("user.id").onDelete("CASCADE");
    });
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_opportunity ON application (opportunity_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_applicant ON application (applicant_user_id)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_status ON application (status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_opportunity_status ON application (opportunity_id, status)");
    await knex.raw("CREATE INDEX IF NOT EXISTS idx_application_applicant_created ON application (applicant_user_id, created_at DESC)");
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
      t.foreign("actor_user_id").references("user.id").onDelete("RESTRICT");
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
}

async function ensureMutableColumns(knex) {
  if (await knex.schema.hasTable("opportunity")) {
    await ensureColumn(
      knex,
      "opportunity",
      "updated_at TIMESTAMP",
      "UPDATE opportunity SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL"
    );
    await knex.raw("ALTER TABLE opportunity ALTER COLUMN updated_at SET DEFAULT NOW()");
    await knex.raw("ALTER TABLE opportunity ALTER COLUMN updated_at SET NOT NULL");
  }

  if (await knex.schema.hasTable("application")) {
    await knex.raw("ALTER TABLE application ALTER COLUMN updated_at SET DEFAULT NOW()");
    await knex.raw("UPDATE application SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL");
    await knex.raw("ALTER TABLE application ALTER COLUMN updated_at SET NOT NULL");
  }

  if (await knex.schema.hasTable("notification_preferences")) {
    await knex.raw("ALTER TABLE notification_preferences ALTER COLUMN updated_at SET DEFAULT NOW()");
    await knex.raw("UPDATE notification_preferences SET updated_at = COALESCE(updated_at, NOW()) WHERE updated_at IS NULL");
    await knex.raw("ALTER TABLE notification_preferences ALTER COLUMN updated_at SET NOT NULL");
  }
}

async function ensureIntegrity(knex) {
  await ensureTriggerFunction(knex);
  await ensureStatusConstraints(knex);
  await ensureUpdateTrigger(knex, "opportunity", "trg_opportunity_updated_at");
  await ensureUpdateTrigger(knex, "application", "trg_application_updated_at");
  await ensureUpdateTrigger(knex, "notification_preferences", "trg_notification_preferences_updated_at");
}

exports.up = async function (knex) {
  await ensureTables(knex);
  await ensureMutableColumns(knex);
  await ensureIntegrity(knex);
};

exports.down = async function (knex) {
  await knex.raw("DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences");
  await knex.raw("DROP TRIGGER IF EXISTS trg_application_updated_at ON application");
  await knex.raw("DROP TRIGGER IF EXISTS trg_opportunity_updated_at ON opportunity");
  await knex.raw("DROP FUNCTION IF EXISTS set_updated_at_timestamp()");
  await knex.schema.dropTableIfExists("notification");
  await knex.schema.dropTableIfExists("notification_preferences");
  await knex.schema.dropTableIfExists("application_history");
  await knex.schema.dropTableIfExists("application");
  await knex.schema.dropTableIfExists("opportunity");
};
