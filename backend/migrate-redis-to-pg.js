/**
 * CLI: copy users + notebooks from Redis/files into PostgreSQL.
 * Run: DATABASE_URL=... REDIS_URL=... node migrate-redis-to-pg.js
 */
import dotenv from "dotenv";
import { initSchema } from "./db.js";
import { runLegacyMigration } from "./legacy-migrate.js";

dotenv.config();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  await initSchema();
  const result = await runLegacyMigration();
  console.log("Migration complete:", result);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
