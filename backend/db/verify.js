#!/usr/bin/env node
/**
 * Migration verification script
 * Checks that the database is in a valid state after migrations
 */

const knex = require("knex");

const REQUIRED_TABLES = [
  "university",
  "faculty",
  "tag",
  "user",
  "admin",
  "organization",
  "organizer_profile",
  "event",
  "event_tag",
  "event_target",
  "event_rejection",
  "student_profile",
  "user_interest",
  "bookmark",
  "opportunity_bookmark",
  "registration",
  "feedback",
];

const REQUIRED_INDEXES = [
  { table: "faculty", index: "idx_faculty_email_domain" },
  { table: "organization", index: "idx_organization_status" },
  { table: "event", index: "idx_event_status" },
  { table: "event", index: "idx_event_organization" },
  { table: "event", index: "idx_event_start" },
  { table: "registration", index: "idx_registration_event" },
  { table: "event", index: "idx_event_status_start" },
  { table: "event", index: "idx_event_org_status" },
];

async function verify() {
  const config = require("../knexfile").development;
  const db = knex(config);

  const errors = [];
  const warnings = [];

  try {
    // Check migration status
    console.log("Checking migration status...");
    const [batchNo] = await db.migrate.currentBatchNumber();
    const completedMigrations = await db.migrate.list();
    console.log(`  Current batch: ${batchNo}`);
    console.log(`  Completed migrations: ${completedMigrations[1].length}`);

    // Check required tables
    console.log("\nChecking required tables...");
    const tableChecks = await Promise.all(
      REQUIRED_TABLES.map((t) => db.schema.hasTable(t).then((exists) => ({ table: t, exists })))
    );

    for (const { table, exists } of tableChecks) {
      if (exists) {
        console.log(`  ✓ ${table}`);
      } else {
        errors.push(`Missing table: ${table}`);
        console.log(`  ✗ ${table} (MISSING)`);
      }
    }

    // Check required indexes
    console.log("\nChecking required indexes...");
    for (const { table, index } of REQUIRED_INDEXES) {
      const exists = await db.raw(
        "SELECT 1 FROM pg_indexes WHERE tablename = ? AND indexname = ? LIMIT 1",
        [table, index]
      );
      if (exists.rows.length > 0) {
        console.log(`  ✓ ${table}.${index}`);
      } else {
        warnings.push(`Missing index: ${table}.${index}`);
        console.log(`  ⚠ ${table}.${index} (not found)`);
      }
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    if (errors.length === 0) {
      console.log("✓ Verification passed");
    } else {
      console.log("✗ Verification failed");
      console.log("\nErrors:");
      errors.forEach((e) => console.log(`  - ${e}`));
    }

    if (warnings.length > 0) {
      console.log("\nWarnings:");
      warnings.forEach((w) => console.log(`  - ${w}`));
    }

    process.exit(errors.length === 0 ? 0 : 1);
  } catch (err) {
    console.error("\n✗ Verification error:", err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

verify();
