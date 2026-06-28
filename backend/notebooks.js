import path from "path";
import { fileURLToPath } from "url";
import { usingPostgres, query } from "./db.js";
import { readJson, writeJson } from "./persist.js";
import { mergeNotebooks } from "./merge-notebooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "notebooks");

function notebookPath(uid) {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

function notebookKey(uid) {
  return `sa:notebooks:${uid}`;
}

async function loadNotebooksFile(uid) {
  const file = notebookPath(uid);
  const parsed = await readJson(notebookKey(uid), null, file);
  if (!parsed) return { notebooks: {}, updatedAt: 0 };
  if (parsed.notebooks && typeof parsed.notebooks === "object") {
    return {
      notebooks: parsed.notebooks,
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  }
  if (typeof parsed === "object") {
    return { notebooks: parsed, updatedAt: 0 };
  }
  return { notebooks: {}, updatedAt: 0 };
}

async function saveNotebooksFile(uid, payload) {
  await writeJson(notebookKey(uid), payload, notebookPath(uid));
}

export async function loadNotebooks(uid) {
  if (usingPostgres()) {
    const { rows } = await query(
      "SELECT notebooks, updated_at FROM sa_notebooks WHERE uid = $1",
      [uid]
    );
    if (!rows.length) return { notebooks: {}, updatedAt: 0 };
    return {
      notebooks: rows[0].notebooks || {},
      updatedAt: Number(rows[0].updated_at) || 0,
    };
  }
  return loadNotebooksFile(uid);
}

export async function saveNotebooks(uid, notebooks) {
  const existing = await loadNotebooks(uid);
  const merged = mergeNotebooks(existing.notebooks, notebooks);
  const payload = {
    notebooks: merged,
    updatedAt: Date.now(),
  };

  if (usingPostgres()) {
    await query(
      `INSERT INTO sa_notebooks (uid, notebooks, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (uid) DO UPDATE
       SET notebooks = EXCLUDED.notebooks, updated_at = EXCLUDED.updated_at`,
      [uid, JSON.stringify(merged), payload.updatedAt]
    );
    return payload;
  }

  await saveNotebooksFile(uid, payload);
  return payload;
}

export async function upsertNotebooksFromMigration(uid, notebooks, updatedAt) {
  if (!usingPostgres()) return;
  const existing = await loadNotebooks(uid);
  const merged = mergeNotebooks(existing.notebooks, notebooks);
  const ts = updatedAt || Date.now();
  await query(
    `INSERT INTO sa_notebooks (uid, notebooks, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (uid) DO UPDATE
     SET notebooks = $2::jsonb, updated_at = GREATEST(sa_notebooks.updated_at, $3)`,
    [uid, JSON.stringify(merged), ts]
  );
}
