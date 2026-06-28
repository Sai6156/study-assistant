import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "notebooks");

function notebookPath(uid) {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadNotebooks(uid) {
  ensureDataDir();
  const file = notebookPath(uid);
  if (!fs.existsSync(file)) return { notebooks: {}, updatedAt: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      notebooks: parsed.notebooks && typeof parsed.notebooks === "object" ? parsed.notebooks : {},
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return { notebooks: {}, updatedAt: 0 };
  }
}

export function saveNotebooks(uid, notebooks) {
  ensureDataDir();
  const payload = {
    notebooks: notebooks && typeof notebooks === "object" ? notebooks : {},
    updatedAt: Date.now(),
  };
  fs.writeFileSync(notebookPath(uid), JSON.stringify(payload), "utf8");
  return payload;
}
