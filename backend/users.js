import crypto from "crypto";
import { usingPostgres, query } from "./db.js";
import { readJson, writeJson } from "./persist.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, "data", "users.json");
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

function rowToUser(row) {
  return {
    uid: row.uid,
    email: row.email,
    username: row.username,
    salt: row.salt,
    passwordHash: row.password_hash,
    createdAt: Number(row.created_at),
  };
}

async function loadStoreFile() {
  return readJson(USERS_KEY, { users: {} }, USERS_FILE);
}

async function saveStoreFile(store) {
  await writeJson(USERS_KEY, store, USERS_FILE);
}

export async function findUserByEmail(email) {
  const key = email.toLowerCase().trim();
  if (usingPostgres()) {
    const { rows } = await query("SELECT * FROM sa_users WHERE email = $1", [key]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  const store = await loadStoreFile();
  return store.users[key] || null;
}

export async function registerUser({ email, password, username, uid }) {
  const key = email.toLowerCase().trim();
  const existing = await findUserByEmail(key);
  if (existing) return { error: "Email already registered", status: 409 };

  const { salt, hash } = hashPassword(password);
  const createdAt = Date.now();
  const user = {
    uid,
    email: key,
    username: username.trim(),
    salt,
    passwordHash: hash,
    createdAt,
  };

  if (usingPostgres()) {
    await query(
      `INSERT INTO sa_users (email, uid, username, salt, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [key, uid, user.username, salt, hash, createdAt]
    );
    return { user };
  }

  const store = await loadStoreFile();
  store.users[key] = user;
  await saveStoreFile(store);
  return { user };
}

export async function authenticateUser(email, password) {
  const key = email.toLowerCase().trim();
  const record = await findUserByEmail(key);
  if (!record) return { error: "No account found with this email. Please sign up first.", status: 401 };
  if (!verifyPassword(password, record.salt, record.passwordHash)) {
    return { error: "Incorrect password", status: 401 };
  }
  return { user: record };
}

export async function upsertUserFromMigration(user) {
  if (!usingPostgres()) return;
  await query(
    `INSERT INTO sa_users (email, uid, username, salt, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    [user.email, user.uid, user.username, user.salt, user.passwordHash, user.createdAt || Date.now()]
  );
}
