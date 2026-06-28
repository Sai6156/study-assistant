import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { readJson, writeJson } from "./persist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USERS_KEY = "sa:users";

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

async function loadStore() {
  return readJson(USERS_KEY, { users: {} }, USERS_FILE);
}

async function saveStore(store) {
  await writeJson(USERS_KEY, store, USERS_FILE);
}

export async function findUserByEmail(email) {
  const key = email.toLowerCase().trim();
  const store = await loadStore();
  return store.users[key] || null;
}

export async function registerUser({ email, password, username, uid }) {
  const key = email.toLowerCase().trim();
  const store = await loadStore();
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
  await saveStore(store);
  return { user: store.users[key] };
}

export async function authenticateUser(email, password) {
  const key = email.toLowerCase().trim();
  const store = await loadStore();
  const record = store.users[key];
  if (!record) return { error: "No account found with this email. Please sign up first.", status: 401 };
  if (!verifyPassword(password, record.salt, record.passwordHash)) {
    return { error: "Incorrect password", status: 401 };
  }
  return { user: record };
}
