const crypto = require("crypto");

const PASTEFY_API_KEY = process.env.PASTEFY_API_KEY || "";
let PASTEFY_PASTE_ID = (process.env.PASTEFY_PASTE_ID || "").trim();
const HWID_SALT = process.env.HWID_SALT || "default-salt-change-me";

console.log("DB INIT", {
  PASTEFY_API_KEY: PASTEFY_API_KEY ? "set(" + PASTEFY_API_KEY.slice(0, 4) + "**)" : "MISSING",
  PASTEFY_PASTE_ID: PASTEFY_PASTE_ID || "EMPTY",
  SITE_URL: process.env.SITE_URL || "MISSING",
  LOOTLABS_API_KEY: process.env.LOOTLABS_API_KEY ? "set" : "MISSING",
});

const PASTEFY_BASE = "https://pastefy.app/api/v2";
const KEY_LENGTH = 12;
const KEY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_TTL = 24 * 60 * 60;
const GEN_COOLDOWN = 24 * 60 * 60;
const SESSION_TTL = 4 * 60 * 60;
const UNLOCK_TTL = 2 * 60 * 60;

const DEFAULT_DB = { keys: {}, generations: {}, sessions: {} };

function normalizePasteId(raw) {
  if (!raw) return "";
  let id = String(raw).trim();
  id = id.replace(/^["']|["']$/g, "");
  try {
    if (id.includes("pastefy.") || id.includes("http")) {
      const u = new URL(id.startsWith("http") ? id : "https://" + id);
      const parts = u.pathname.split("/").filter(Boolean);
      id = parts[parts.length - 1] || id;
    }
  } catch (_) {}
  id = id.split("?")[0].split("#")[0].trim();
  return id;
}

PASTEFY_PASTE_ID = normalizePasteId(PASTEFY_PASTE_ID);

function headers() {
  return {
    Authorization: `Bearer ${PASTEFY_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function pastefyGetRaw(id) {
  const res = await fetch(`${PASTEFY_BASE}/paste/${id}/raw`, { headers: headers() });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new Error("Pastefy auth failed – check PASTEFY_API_KEY");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Pastefy GET ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.text();
}

async function pastefyEdit(id, content) {
  const res = await fetch(`${PASTEFY_BASE}/paste/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ title: "HWID Key DB", content, visibility: "UNLISTED" }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Pastefy EDIT ${res.status}: ${t.slice(0, 120)}`);
  }
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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pastefy CREATE ${res.status}: ${text.slice(0, 150)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Pastefy CREATE: invalid JSON response");
  }
  const id = (data.paste && data.paste.id) || data.id || (data.paste || data).id;
  if (!id) throw new Error("Pastefy CREATE: no id in response: " + text.slice(0, 150));
  return String(id);
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

function normalizeDb(db) {
  if (!db || typeof db !== "object") db = structuredClone(DEFAULT_DB);
  if (!db.keys) db.keys = {};
  if (!db.generations) db.generations = {};
  if (!db.sessions) db.sessions = {};
  return db;
}

async function loadDb() {
  if (!PASTEFY_API_KEY) throw new Error("PASTEFY_API_KEY not set");

  console.log("loadDb: PASTEFY_PASTE_ID =", JSON.stringify(PASTEFY_PASTE_ID));

  if (!PASTEFY_PASTE_ID) {
    console.log("loadDb: no paste ID, creating new paste...");
    const id = await pastefyCreate(JSON.stringify(DEFAULT_DB, null, 2));
    PASTEFY_PASTE_ID = id;
    console.log(`CREATED_PASTE_ID=${id}  ← set this as PASTEFY_PASTE_ID env var`);
    return structuredClone(DEFAULT_DB);
  }

  console.log("loadDb: fetching paste", PASTEFY_PASTE_ID);
  const raw = await pastefyGetRaw(PASTEFY_PASTE_ID);

  if (raw === null) {
    console.log(`PASTEFY_PASTE_ID=${PASTEFY_PASTE_ID} not found – creating a new paste`);
    const id = await pastefyCreate(JSON.stringify(DEFAULT_DB, null, 2));
    PASTEFY_PASTE_ID = id;
    console.log(`CREATED_PASTE_ID=${id}  ← set this as PASTEFY_PASTE_ID env var`);
    return structuredClone(DEFAULT_DB);
  }

  console.log("loadDb: paste fetched OK, length:", raw.length);

  let db;
  try {
    db = JSON.parse(raw);
  } catch {
    db = structuredClone(DEFAULT_DB);
  }
  db = normalizeDb(db);
  if (cleanExpired(db)) await saveDb(db);
  return db;
}

async function saveDb(db) {
  cleanExpired(db);
  if (!PASTEFY_PASTE_ID) {
    PASTEFY_PASTE_ID = await pastefyCreate(JSON.stringify(db, null, 2));
    console.log(`CREATED_PASTE_ID=${PASTEFY_PASTE_ID}`);
    return;
  }
  try {
    await pastefyEdit(PASTEFY_PASTE_ID, JSON.stringify(db, null, 2));
  } catch (e) {
    if (String(e.message || e).includes("404")) {
      PASTEFY_PASTE_ID = await pastefyCreate(JSON.stringify(db, null, 2));
      console.log(`CREATED_PASTE_ID=${PASTEFY_PASTE_ID} (recreated after 404)`);
      return;
    }
    throw e;
  }
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
