const {
  loadDb,
  saveDb,
  generateSessionId,
  SESSION_TTL,
  UNLOCK_TTL,
} = require("../lib/db");

const LOOTLABS_API_KEY = process.env.LOOTLABS_API_KEY || "";
const LOOTLABS_LINK = (process.env.LOOTLABS_LINK || "").trim();
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

async function encryptDestination(destinationUrl) {
  const res = await fetch("https://creators.lootlabs.gg/api/public/url_encryptor", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOOTLABS_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      destination_url: destinationUrl,
      api_token: LOOTLABS_API_KEY,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LootLabs encrypt failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.message || data.type === "error") {
    throw new Error(data.message || "LootLabs encrypt error");
  }
  return data.message;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const sessionId = String(req.query.id || req.query.session || "").trim();
      if (!sessionId) {
        return res.status(400).json({ success: false, message: "session id required" });
      }

      const db = await loadDb();
      const session = db.sessions[sessionId];
      const now = Math.floor(Date.now() / 1000);

      if (!session || (session.expires || 0) <= now) {
        return res.json({ success: true, status: "missing" });
      }

      return res.json({
        success: true,
        status: session.status,
        used: !!session.used,
        expires: session.expires,
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    if (!LOOTLABS_API_KEY || !LOOTLABS_LINK) {
      return res.status(500).json({
        success: false,
        message: "LOOTLABS_API_KEY or LOOTLABS_LINK not configured",
      });
    }

    const origin =
      SITE_URL ||
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;

    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);
    const sessionId = generateSessionId();

    const unlockUrl = `${origin}/?token=${sessionId}`;

    let encrypted;
    try {
      encrypted = await encryptDestination(unlockUrl);
    } catch (err) {
      console.error("encrypt:", err);
      return res.status(502).json({
        success: false,
        message: "Failed to create protected link. Try again.",
      });
    }

    const separator = LOOTLABS_LINK.includes("?") ? "&" : "?";
    const lootlabsUrl = `${LOOTLABS_LINK}${separator}puid=${encodeURIComponent(sessionId)}&data=${encrypted}`;

    db.sessions[sessionId] = {
      status: "pending",
      created: now,
      expires: now + SESSION_TTL,
      ip: clientIp,
      completed_ip: null,
      unique_id: null,
      used: false,
      unlock_expires: null,
    };

    await saveDb(db);

    return res.json({
      success: true,
      session_id: sessionId,
      lootlabs_url: lootlabsUrl,
      expires_in: SESSION_TTL,
    });
  } catch (err) {
    console.error("session:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
