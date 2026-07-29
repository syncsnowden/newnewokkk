const API_BASE = "";

const gateState = document.getElementById("gate-state");
const idleState = document.getElementById("idle-state");
const resultState = document.getElementById("result-state");
const cooldownState = document.getElementById("cooldown-state");
const errorState = document.getElementById("error-state");

const checkpointBtn = document.getElementById("checkpoint-btn");
const generateBtn = document.getElementById("generate-btn");
const copyBtn = document.getElementById("copy-btn");
const retryBtn = document.getElementById("retry-btn");
const keyValue = document.getElementById("key-value");
const countdownEl = document.getElementById("countdown");
const cooldownTimerEl = document.getElementById("cooldown-timer");
const errorMessage = document.getElementById("error-message");

let countdownInterval = null;
let unlockToken = null;

function getOrCreateDeviceId() {
  const KEY = "hwid_keygen_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : generateFallbackId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function generateFallbackId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    !!window.sessionStorage,
    !!window.localStorage,
    navigator.hardwareConcurrency || 0,
  ];
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 200;
    canvas.height = 50;
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = "#069";
    ctx.fillText("fingerprint", 2, 15);
    parts.push(canvas.toDataURL().slice(-50));
  } catch (_) {}
  const raw = parts.join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function showState(state) {
  [gateState, idleState, resultState, cooldownState, errorState].forEach((el) =>
    el.classList.add("hidden")
  );
  state.classList.remove("hidden");
}

function formatDuration(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function startCountdown(targetEl, expiresAt, onExpire) {
  if (countdownInterval) clearInterval(countdownInterval);
  function tick() {
    const left = expiresAt - Math.floor(Date.now() / 1000);
    targetEl.textContent = formatDuration(left);
    if (left <= 0) {
      clearInterval(countdownInterval);
      if (onExpire) onExpire();
    }
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function setBtnLoading(btn, loading) {
  const text = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = loading;
  if (text) text.classList.toggle("hidden", loading);
  if (loader) loader.classList.toggle("hidden", !loading);
}

function getTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("token") || null;
}

function clearTokenFromUrl() {
  if (!window.history.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.pathname + url.search);
}

async function checkSession(token) {
  const res = await fetch(`${API_BASE}/api/session?id=${encodeURIComponent(token)}`);
  return res.json();
}

async function startCheckpoint() {
  setBtnLoading(checkpointBtn, true);
  try {
    const res = await fetch(`${API_BASE}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!data.success || !data.lootlabs_url) {
      throw new Error(data.message || "Could not start checkpoint");
    }
    window.location.href = data.lootlabs_url;
  } catch (err) {
    errorMessage.textContent = err.message || "Network error";
    showState(errorState);
  } finally {
    setBtnLoading(checkpointBtn, false);
  }
}

async function generateKey() {
  if (!unlockToken) {
    showState(gateState);
    return;
  }
  setBtnLoading(generateBtn, true);
  try {
    const deviceId = getOrCreateDeviceId();
    const fingerprint = await getFingerprint();
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: deviceId,
        fingerprint,
        token: unlockToken,
      }),
    });
    const data = await res.json();
    if (data.success) {
      keyValue.textContent = data.key;
      showState(resultState);
      startCountdown(countdownEl, data.expires_at, () => {
        countdownEl.textContent = "EXPIRED";
        const status = document.getElementById("key-status");
        if (status) status.textContent = "Expired";
      });
      localStorage.setItem(
        "last_key",
        JSON.stringify({ key: data.key, expires_at: data.expires_at })
      );
      unlockToken = null;
      sessionStorage.removeItem("unlock_token");
      clearTokenFromUrl();
    } else if (data.cooldown_remaining != null) {
      showState(cooldownState);
      const ends = Math.floor(Date.now() / 1000) + data.cooldown_remaining;
      startCountdown(cooldownTimerEl, ends, () => showState(gateState));
    } else if (
      ["no_token", "invalid_session", "not_completed", "already_used", "unlock_expired"].includes(
        data.code
      )
    ) {
      unlockToken = null;
      sessionStorage.removeItem("unlock_token");
      clearTokenFromUrl();
      errorMessage.textContent = data.message || "Checkpoint required";
      showState(errorState);
    } else {
      throw new Error(data.message || "Unknown error");
    }
  } catch (err) {
    errorMessage.textContent = err.message || "Network error";
    showState(errorState);
  } finally {
    setBtnLoading(generateBtn, false);
  }
}

checkpointBtn.addEventListener("click", startCheckpoint);
generateBtn.addEventListener("click", generateKey);
copyBtn.addEventListener("click", async () => {
  const text = keyValue.textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  } catch {
    const range = document.createRange();
    range.selectNode(keyValue);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand("copy");
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  }
});
retryBtn.addEventListener("click", () => {
  if (unlockToken) showState(idleState);
  else showState(gateState);
});

(async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem("last_key") || "null");
    if (saved && saved.expires_at > Math.floor(Date.now() / 1000)) {
      keyValue.textContent = saved.key;
      showState(resultState);
      startCountdown(countdownEl, saved.expires_at, () => {
        countdownEl.textContent = "EXPIRED";
      });
      return;
    }
  } catch (_) {}

  const urlToken = getTokenFromUrl();
  const stored = sessionStorage.getItem("unlock_token");
  const candidate = urlToken || stored;

  if (!candidate) {
    showState(gateState);
    return;
  }

  try {
    const data = await checkSession(candidate);
    if (data.success && data.status === "completed" && !data.used) {
      unlockToken = candidate;
      sessionStorage.setItem("unlock_token", candidate);
      if (urlToken) clearTokenFromUrl();
      showState(idleState);
      return;
    }
  } catch (_) {}

  unlockToken = null;
  sessionStorage.removeItem("unlock_token");
  clearTokenFromUrl();
  showState(gateState);
})();
