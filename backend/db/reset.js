#!/usr/bin/env node
/**
 * Database reset script — LOCAL DEVELOPMENT ONLY
 *
 * Rolls back all migrations, re-applies them, and re-seeds.
 * Refuses to run if NODE_ENV=production.
 */

const knex = require("knex");

const env = process.env.NODE_ENV === "test" ? "test" : "development";
const config = require("../knexfile")[env];

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset: NODE_ENV is production.");
  process.exit(1);
}

async function reset() {
  const db = knex(config);

  try {
    console.log("Rolling back all migrations...");
    const [batchNo, migrations] = await db.migrate.rollback(config.migrations.directory, { all: true });
    console.log(`  Rolled back batch ${batchNo} (${migrations.length} migration(s))`);

    console.log("Applying all migrations...");
    const [newBatchNo, applied] = await db.migrate.latest(config.migrations.directory);
    console.log(`  Applied in batch ${newBatchNo} (${applied.length} migration(s))`);

    console.log("Running seeds...");
    await db.seed.run(config.seeds.directory);
    console.log("  Seeds completed.");

    console.log("\nDatabase reset complete.");
  } catch (err) {
    console.error("\nReset failed:", err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

reset();
