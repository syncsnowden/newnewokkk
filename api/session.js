const {
  loadDb,
  saveDb,
  generateSessionId,
  SESSION_TTL,
} = require("../lib/db");

const LOOTLABS_API_KEY = process.env.LOOTLABS_API_KEY || "";
const LOOTLABS_LINK = (process.env.LOOTLABS_LINK || "").trim();
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

async function encryptDestination(destinationUrl) {
  const url = "https://creators.lootlabs.gg/api/public/url_encryptor";

  const postRes = await fetch(url, {
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

  if (postRes.ok) {
    const data = await postRes.json();
    if (data.message && data.type !== "error") {
      return String(data.message);
    }
  }

  const getUrl =
    `${url}?destination_url=${encodeURIComponent(destinationUrl)}` +
    `&api_token=${encodeURIComponent(LOOTLABS_API_KEY)}`;

  const getRes = await fetch(getUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!getRes.ok) {
    const text = await getRes.text().catch(() => "");
    throw new Error(`LootLabs encrypt failed: ${getRes.status} ${text}`);
  }

  const data = await getRes.json();
  if (!data.message || data.type === "error") {
    throw new Error(String(data.message || "LootLabs encrypt error"));
  }
  return String(data.message);
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

    if (!SITE_URL) {
      return res.status(500).json({
        success: false,
        message: "SITE_URL env var is required (e.g. https://sppirithub.vercel.app)",
      });
    }

    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);
    const sessionId = generateSessionId();

    const unlockUrl = `${SITE_URL}/?token=${sessionId}`;

    let encrypted;
    try {
      encrypted = await encryptDestination(unlockUrl);
    } catch (err) {
      console.error("encrypt:", err);
      return res.status(502).json({
        success: false,
        message: "Failed to create protected link. Check LOOTLABS_API_KEY. " + (err.message || ""),
      });
    }

    const dataParam = encrypted.includes("%")
      ? encrypted
      : encodeURIComponent(encrypted);

    const base = LOOTLABS_LINK.replace(/[?&]$/, "");
    const separator = base.includes("?") ? "&" : "?";
    const lootlabsUrl =
      `${base}${separator}puid=${encodeURIComponent(sessionId)}&data=${dataParam}`;

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

    console.log("session created", sessionId, "unlock→", unlockUrl);

    return res.json({
      success: true,
      session_id: sessionId,
      lootlabs_url: lootlabsUrl,
      unlock_url: unlockUrl,
      expires_in: SESSION_TTL,
    });
  } catch (err) {
    console.error("session:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
