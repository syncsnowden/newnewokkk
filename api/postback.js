const { loadDb, saveDb, UNLOCK_TTL } = require("../lib/db");

function findSession(db, clickId, ip) {
  if (clickId && db.sessions[clickId]) return db.sessions[clickId];
  if (ip) {
    for (const s of Object.values(db.sessions)) {
      if (s.ip === ip && s.status === "pending") return s;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = {
      ...(req.query || {}),
      ...((req.method === "POST" && req.body) || {}),
    };

    const clickId = String(
      q.click_id || q.clickid || q.CLICK_ID || q.puid || q.token || ""
    ).trim();
    const ip = String(q.ip || q.IP || "").trim();
    const uniqueId = String(
      q.unique_id || q.uniqueid || q.UNIQUE_ID || ""
    ).trim();

    console.log("postback hit", { clickId, ip, uniqueId, query: q });

    const db = await loadDb();
    const now = Math.floor(Date.now() / 1000);
    const session = findSession(db, clickId, ip);

    if (!session) {
      console.log("postback: no matching session", { clickId, ip });
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

    await saveDb(db);

    console.log("postback: completed", clickId || ip);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("postback:", err);
    return res.status(200).send("ok");
  }
};
