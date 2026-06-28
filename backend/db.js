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
      updated_at  BIGINT NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS sa_notebooks_updated_idx ON sa_notebooks(updated_at);
  `);
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
