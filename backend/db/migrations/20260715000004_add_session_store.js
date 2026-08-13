exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("session"))) {
    await knex.schema.createTable("session", (t) => {
      t.string("sid", 255).primary();
      t.jsonb("sess").notNullable();
      t.timestamp("expire").notNullable();
    });

    await knex.raw("CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire)");
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("session");
};
