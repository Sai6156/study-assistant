/**
 * Import users + notebooks from Redis/files into PostgreSQL.
 * Called on server startup and available as a CLI script.
 */
import { createClient } from "redis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { usingPostgres } from "./db.js";
import { upsertUserFromMigration } from "./users.js";
import { upsertNotebooksFromMigration } from "./notebooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importFromRedis() {
  const url = process.env.REDIS_URL || process.env.REDIS_INTERNAL_URL;
  if (!url) return { users: 0, notebooks: 0 };
  const redis = createClient({ url });
  await redis.connect();
  let users = 0;
  let notebooks = 0;

  try {
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
  } finally {
    await redis.quit();
  }

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
      const parsed = JSON.parse(fs.readFileSync(path.join(nbDir, file), "utf8"));
      const safeUid = file.replace(".json", "");
      const actualUid = safeUid.startsWith("u_") ? safeUid : `u_${safeUid}`;
      const nb = parsed.notebooks || parsed;
      await upsertNotebooksFromMigration(actualUid, nb, parsed.updatedAt);
      notebooks++;
    }
  }
  return { users, notebooks };
}

export async function runLegacyMigration() {
  if (!usingPostgres()) return { users: 0, notebooks: 0, skipped: true };
  const redis = await importFromRedis();
  const files = await importFromFiles();
  const total = { users: redis.users + files.users, notebooks: redis.notebooks + files.notebooks };
  if (total.users || total.notebooks) {
    console.log("Legacy migration to Postgres:", total);
  }
  return total;
}
