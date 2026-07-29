const { loadDb, saveDb, hashHwid, KEY_LENGTH } = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({
      valid: false,
      message: "Method not allowed",
      status: "invalid",
    });
  }

  try {
    const { key: rawKey, hwid: rawHwid } = req.body || {};
    if (!rawKey || !rawHwid) {
      return res.status(400).json({
        valid: false,
        message: "key and hwid are required",
        status: "invalid",
      });
    }

    const key = String(rawKey).trim();
    const hwid = String(rawHwid).trim();

    if (key.length !== KEY_LENGTH) {
      return res.json({
        valid: false,
        message: "Key does not exist",
        status: "invalid",
      });
    }

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);

    if (!db.keys[key]) {
      return res.json({
        valid: false,
        message: "Key does not exist",
        status: "invalid",
      });
    }

    const entry = db.keys[key];

    if ((entry.expires || 0) <= now) {
      delete db.keys[key];
      await saveDb(db);
      return res.json({
        valid: false,
        message: "Key has expired",
        status: "expired",
      });
    }

    const hashed = hashHwid(hwid);

    if (entry.hwid === null) {
      entry.hwid = hashed;
      entry.status = "used";
      db.keys[key] = entry;
      await saveDb(db);
      return res.json({
        valid: true,
        message: "Key verified and bound to this device",
        status: "unused_bound",
      });
    }

    if (entry.hwid === hashed) {
      return res.json({
        valid: true,
        message: "Key verified",
        status: "valid",
      });
    }

    return res.json({
      valid: false,
      message: "HWID mismatch – this key is locked to another device",
      status: "hwid_mismatch",
    });
  } catch (err) {
    console.error("validate:", err);
    return res.status(500).json({
      valid: false,
      message: "Server error",
      status: "invalid",
    });
  }
};