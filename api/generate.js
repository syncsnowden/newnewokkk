const {
  loadDb,
  saveDb,
  generateKey,
  KEY_TTL,
  GEN_COOLDOWN,
} = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { device_id, fingerprint, token } = req.body || {};
    if (!device_id || typeof device_id !== "string" || device_id.length < 8) {
      return res.status(400).json({
        success: false,
        message: "device_id is required (min 8 chars)",
      });
    }

    if (!token || typeof token !== "string" || token.length < 16) {
      return res.status(403).json({
        success: false,
        message: "Complete the LootLabs checkpoint first.",
        code: "no_token",
      });
    }

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);
    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    const session = db.sessions[token];
    if (!session) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired session. Complete the checkpoint again.",
        code: "invalid_session",
      });
    }

    if (session.status !== "completed") {
      return res.status(403).json({
        success: false,
        message: "Checkpoint not completed yet.",
        code: "not_completed",
      });
    }

    if (session.used) {
      return res.status(403).json({
        success: false,
        message: "This unlock was already used. Complete the checkpoint again for a new key.",
        code: "already_used",
      });
    }

    const unlockUntil = session.unlock_expires || session.expires || 0;
    if (unlockUntil <= now) {
      return res.status(403).json({
        success: false,
        message: "Unlock expired. Complete the checkpoint again.",
        code: "unlock_expired",
      });
    }

    const identityKeys = [`device:${device_id}`, `ip:${clientIp}`];
    if (fingerprint) identityKeys.push(`fp:${fingerprint}`);

    for (const ident of identityKeys) {
      const record = db.generations[ident];
      if (record && (record.expires || 0) > now) {
        return res.json({
          success: false,
          message: "You already generated a key recently. Please wait.",
          cooldown_remaining: record.expires - now,
        });
      }
    }

    let key;
    for (let i = 0; i < 20; i++) {
      key = generateKey();
      if (!db.keys[key]) break;
    }

    const expires = now + KEY_TTL;
    db.keys[key] = {
      hwid: null,
      created: now,
      expires,
      status: "unused",
      session: token,
    };

    const genRecord = {
      created: now,
      expires: now + GEN_COOLDOWN,
      key,
      ip: clientIp,
    };
    for (const ident of identityKeys) {
      db.generations[ident] = genRecord;
    }

    session.used = true;
    session.used_at = now;
    session.used_ip = clientIp;
    session.expires = now;
    db.sessions[token] = session;

    await saveDb(db);

    return res.json({
      success: true,
      key,
      expires_at: expires,
      message: "Key generated successfully. Valid for 24 hours.",
    });
  } catch (err) {
    console.error("generate:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
