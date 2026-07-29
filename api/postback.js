const { loadDb, saveDb, UNLOCK_TTL } = require("../lib/db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = req.method === "POST" ? { ...(req.query || {}), ...(req.body || {}) } : req.query || {};

    const clickId = String(q.click_id || q.clickid || q.puid || "").trim();
    const ip = String(q.ip || "").trim();
    const uniqueId = String(q.unique_id || q.uniqueid || "").trim();

    if (!clickId) {
      return res.status(400).send("missing click_id");
    }

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);
    const session = db.sessions[clickId];

    if (!session) {
      console.log("postback: unknown session", clickId);
      return res.status(200).send("ok");
    }

    if ((session.expires || 0) <= now && session.status !== "completed") {
      console.log("postback: expired session", clickId);
      return res.status(200).send("ok");
    }

    if (session.status === "completed") {
      return res.status(200).send("ok");
    }

    session.status = "completed";
    session.completed_ip = ip || session.ip;
    session.unique_id = uniqueId || null;
    session.completed_at = now;
    session.unlock_expires = now + UNLOCK_TTL;
    session.expires = Math.max(session.expires || 0, now + UNLOCK_TTL);

    db.sessions[clickId] = session;
    await saveDb(db);

    console.log("postback: completed", clickId, "ip=", session.completed_ip);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("postback:", err);
    return res.status(200).send("ok");
  }
};
