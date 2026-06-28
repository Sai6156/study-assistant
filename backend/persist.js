import fs from "fs";
import path from "path";
import { createClient } from "redis";

let redisClient = null;
let redisReady = false;

function redisUrl() {
  return process.env.REDIS_URL || process.env.REDIS_INTERNAL_URL || "";
}

export function usingRedis() {
  return Boolean(redisUrl());
}

async function getRedis() {
  if (!redisUrl()) return null;
  if (redisClient && redisReady) return redisClient;
  redisClient = createClient({ url: redisUrl() });
  redisClient.on("error", (err) => console.error("Redis error:", err.message));
  await redisClient.connect();
  redisReady = true;
  return redisClient;
}

function readFileJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeFileJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readJson(key, fallback, filePath) {
  try {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw);
      return fallback;
    }
  } catch (e) {
    console.error(`readJson(${key}) redis failed, using file:`, e.message);
  }
  return readFileJson(filePath, fallback);
}

export async function writeJson(key, data, filePath) {
  const payload = JSON.stringify(data);
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set(key, payload);
      return;
    }
  } catch (e) {
    console.error(`writeJson(${key}) redis failed, using file:`, e.message);
  }
  writeFileJson(filePath, data);
}
