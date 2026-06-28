import pg from "pg";

const { Pool } = pg;

let pool = null;

export function usingPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
    pool.on("error", (err) => console.error("Postgres pool error:", err.message));
  }
  return pool;
}

export async function query(text, params = []) {
  const p = getPool();
  return p.query(text, params);
}

async function runWipeIfRequested() {
  const email = process.env.WIPE_ACCOUNT_EMAIL?.toLowerCase().trim();
  if (!email) return;
  await query("DELETE FROM sa_users WHERE email = $1", [email]);
  await query("DELETE FROM sa_notebooks WHERE uid NOT IN (SELECT uid FROM sa_users)");
  console.log("Wiped account and orphan notebooks for:", email);
}

export async function initSchema() {
  if (!usingPostgres()) {
    console.warn("DATABASE_URL not set — Postgres schema skipped");
    return false;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS sa_users (
      email         TEXT PRIMARY KEY,
      uid           TEXT NOT NULL UNIQUE,
      username      TEXT NOT NULL,
      salt          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sa_notebooks (
      uid         TEXT PRIMARY KEY,
      notebooks   JSONB NOT NULL DEFAULT '{}',
      updated_at  BIGINT NOT NULL DEFAULT 0,
      owner_email TEXT
    );

    CREATE INDEX IF NOT EXISTS sa_notebooks_updated_idx ON sa_notebooks(updated_at);
  `);
  await query(`
    ALTER TABLE sa_notebooks ADD COLUMN IF NOT EXISTS owner_email TEXT;
  `);
  await runWipeIfRequested();
  return true;
}

export async function checkPostgres() {
  if (!usingPostgres()) return false;
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
