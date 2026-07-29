const crypto = require("crypto");

const PASTEFY_API_KEY = process.env.PASTEFY_API_KEY || "";
let PASTEFY_PASTE_ID = (process.env.PASTEFY_PASTE_ID || "").trim();
const HWID_SALT = process.env.HWID_SALT || "default-salt-change-me";

const PASTEFY_BASE = "https://pastefy.app/api/v2";
const KEY_LENGTH = 12;
const KEY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_TTL = 24 * 60 * 60;
const GEN_COOLDOWN = 24 * 60 * 60;
const SESSION_TTL = 30 * 60;
const UNLOCK_TTL = 15 * 60;

const DEFAULT_DB = { keys: {}, generations: {}, sessions: {} };

function headers() {
  return {
    Authorization: `Bearer ${PASTEFY_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function pastefyGetRaw(id) {
  const res = await fetch(`${PASTEFY_BASE}/paste/${id}/raw`, { headers: headers() });
  if (res.status === 404) throw new Error("Storage paste not found");
  if (!res.ok) throw new Error(`Pastefy GET ${res.status}`);
  return res.text();
}

async function pastefyEdit(id, content) {
  const res = await fetch(`${PASTEFY_BASE}/paste/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ title: "HWID Key DB", content, visibility: "UNLISTED" }),
  });
  if (!res.ok) throw new Error(`Pastefy EDIT ${res.status}`);
}

async function pastefyCreate(content) {
  const res = await fetch(`${PASTEFY_BASE}/paste`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      title: "HWID Key DB",
      content,
      visibility: "UNLISTED",
      encrypted: false,
    }),
  });
  if (!res.ok) throw new Error(`Pastefy CREATE ${res.status}`);
  const data = await res.json();
  return (data.paste || data).id;
}

function hashHwid(hwid) {
  return crypto.createHash("sha256").update(`${HWID_SALT}:${hwid}`).digest("hex");
}

function cleanExpired(db) {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const [k, v] of Object.entries(db.keys || {})) {
    if ((v.expires || 0) <= now) {
      delete db.keys[k];
      changed = true;
    }
  }
  for (const [k, v] of Object.entries(db.generations || {})) {
    if ((v.expires || 0) <= now) {
      delete db.generations[k];
      changed = true;
    }
  }
  for (const [k, v] of Object.entries(db.sessions || {})) {
    if ((v.expires || 0) <= now) {
      delete db.sessions[k];
      changed = true;
    }
  }
  return changed;
}

async function loadDb() {
  if (!PASTEFY_API_KEY) throw new Error("PASTEFY_API_KEY not set");

  if (!PASTEFY_PASTE_ID) {
    const id = await pastefyCreate(JSON.stringify(DEFAULT_DB, null, 2));
    PASTEFY_PASTE_ID = id;
    console.log(`CREATED_PASTE_ID=${id}  ← set this as PASTEFY_PASTE_ID env var`);
    return structuredClone(DEFAULT_DB);
  }

  const raw = await pastefyGetRaw(PASTEFY_PASTE_ID);
  let db;
  try {
    db = JSON.parse(raw);
  } catch {
    db = structuredClone(DEFAULT_DB);
  }
  if (!db.keys) db.keys = {};
  if (!db.generations) db.generations = {};
  if (!db.sessions) db.sessions = {};
  if (cleanExpired(db)) await saveDb(db);
  return db;
}

async function saveDb(db) {
  cleanExpired(db);
  await pastefyEdit(PASTEFY_PASTE_ID, JSON.stringify(db, null, 2));
}

function generateKey() {
  const bytes = crypto.randomBytes(KEY_LENGTH);
  let key = "";
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  }
  return key;
}

function generateSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  loadDb,
  saveDb,
  hashHwid,
  generateKey,
  generateSessionId,
  KEY_LENGTH,
  KEY_TTL,
  GEN_COOLDOWN,
  SESSION_TTL,
  UNLOCK_TTL,
  PASTEFY_PASTE_ID: () => PASTEFY_PASTE_ID,
};
