#!/usr/bin/env node
/**
 * Migration status script
 *
 * Displays applied migrations, pending migrations, and table count
 * in a human-readable format.
 */

const knex = require("knex");

const env = process.env.NODE_ENV === "test" ? "test" : "development";
const config = require("../knexfile")[env];

async function status() {
  const db = knex(config);

  try {
    const currentVersion = await db.migrate.currentVersion();
    const [completed, pending] = await db.migrate.list(config.migrations.directory);

    console.log(`Current version: ${currentVersion}\n`);

    console.log(`Applied migrations (${completed.length}):`);
    if (completed.length === 0) {
      console.log("  (none)");
    } else {
      completed.forEach((m) => console.log(`  ✓ ${m}`));
    }

    console.log(`\nPending migrations (${pending.length}):`);
    if (pending.length === 0) {
      console.log("  (none)");
    } else {
      pending.forEach((m) => console.log(`  • ${m}`));
    }

    const { rows } = await db.raw(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    console.log(`\nTables: ${rows[0].count}`);
  } catch (err) {
    console.error("\nStatus check failed:", err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

status();
