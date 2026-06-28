/**
 * One-time import: copy users + notebooks from Redis/files into PostgreSQL.
 * Run: DATABASE_URL=... REDIS_URL=... node migrate-redis-to-pg.js
 */
import dotenv from "dotenv";
import { createClient } from "redis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initSchema } from "./db.js";
import { upsertUserFromMigration } from "./users.js";
import { upsertNotebooksFromMigration } from "./notebooks.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importFromRedis() {
  const url = process.env.REDIS_URL || process.env.REDIS_INTERNAL_URL;
  if (!url) return { users: 0, notebooks: 0 };
  const redis = createClient({ url });
  await redis.connect();
  let users = 0;
  let notebooks = 0;

  const usersRaw = await redis.get("sa:users");
  if (usersRaw) {
    const store = JSON.parse(usersRaw);
    for (const u of Object.values(store.users || {})) {
      await upsertUserFromMigration(u);
      users++;
    }
  }

  for (const key of await redis.keys("sa:notebooks:*")) {
    const uid = key.replace("sa:notebooks:", "");
    const raw = await redis.get(key);
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    const nb = parsed.notebooks || parsed;
    await upsertNotebooksFromMigration(uid, nb, parsed.updatedAt);
    notebooks++;
  }

  await redis.quit();
  return { users, notebooks };
}

async function importFromFiles() {
  let users = 0;
  let notebooks = 0;
  const usersFile = path.join(__dirname, "data", "users.json");
  if (fs.existsSync(usersFile)) {
    const store = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    for (const u of Object.values(store.users || {})) {
      await upsertUserFromMigration(u);
      users++;
    }
  }
  const nbDir = path.join(__dirname, "data", "notebooks");
  if (fs.existsSync(nbDir)) {
    for (const file of fs.readdirSync(nbDir)) {
      if (!file.endsWith(".json")) continue;
      const uid = file.replace(".json", "").replace(/_/g, (m, i) => (i === 0 ? m : ""));
      const parsed = JSON.parse(fs.readFileSync(path.join(nbDir, file), "utf8"));
      const safeUid = file.replace(".json", "");
      const actualUid = parsed.uid || safeUid;
      const nb = parsed.notebooks || parsed;
      await upsertNotebooksFromMigration(actualUid.startsWith("u_") ? actualUid : `u_${actualUid}`, nb, parsed.updatedAt);
      notebooks++;
    }
  }
  return { users, notebooks };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  await initSchema();
  const redis = await importFromRedis();
  const files = await importFromFiles();
  console.log("Migration complete:", { redis, files });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
