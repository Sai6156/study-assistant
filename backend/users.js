import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return { users: {} };
  }
}

function saveStore(store) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function findUserByEmail(email) {
  const key = email.toLowerCase().trim();
  return loadStore().users[key] || null;
}

export function registerUser({ email, password, username, uid }) {
  const key = email.toLowerCase().trim();
  const store = loadStore();
  if (store.users[key]) return { error: "Email already registered", status: 409 };

  const { salt, hash } = hashPassword(password);
  store.users[key] = {
    uid,
    email: key,
    username: username.trim(),
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
  };
  saveStore(store);
  return { user: store.users[key] };
}

export function authenticateUser(email, password) {
  const key = email.toLowerCase().trim();
  const record = loadStore().users[key];
  if (!record) return { error: "No account found with this email. Please sign up first.", status: 401 };
  if (!verifyPassword(password, record.salt, record.passwordHash)) {
    return { error: "Incorrect password", status: 401 };
  }
  return { user: record };
}
