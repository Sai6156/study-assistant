import path from "path";
import { fileURLToPath } from "url";
import { readJson, writeJson } from "./persist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "notebooks");

function notebookPath(uid) {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

function notebookKey(uid) {
  return `sa:notebooks:${uid}`;
}

export async function loadNotebooks(uid) {
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

export async function saveNotebooks(uid, notebooks) {
  const payload = {
    notebooks: notebooks && typeof notebooks === "object" ? notebooks : {},
    updatedAt: Date.now(),
  };
  await writeJson(notebookKey(uid), payload, notebookPath(uid));
  return payload;
}
