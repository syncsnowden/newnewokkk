const { loadDb } = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ exists: false });
  }

  try {
    // Vercel: /api/status?key=XXXX  or  /api/status/XXXX via rewrite
    const key = String(req.query.key || req.query.id || "").trim();
    if (!key) return res.json({ exists: false });

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);

    if (!db.keys[key]) return res.json({ exists: false });

    const entry = db.keys[key];
    if ((entry.expires || 0) <= now) {
      return res.json({ exists: false, expired: true });
    }

    return res.json({
      exists: true,
      status: entry.status,
      created: entry.created,
      expires: entry.expires,
      bound: entry.hwid !== null,
      seconds_left: Math.max(0, entry.expires - now),
    });
  } catch (err) {
    console.error("status:", err);
    return res.status(500).json({ exists: false });
  }
};