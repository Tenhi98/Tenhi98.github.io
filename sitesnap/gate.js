"use strict";
(function () {
  const FLAG = "sitesnap-hk-auth";
  const cfg = window.SITESNAP_AUTH || {};
  const expected = String(cfg.passwordHash || "").toLowerCase();

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showApp() {
    const gate = document.getElementById("gate");
    const app = document.getElementById("app");
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    document.body.classList.remove("gated");
    document.body.classList.add("authed");
    loadAppScripts();
  }

  function showGate() {
    const gate = document.getElementById("gate");
    const app = document.getElementById("app");
    if (app) app.hidden = true;
    if (gate) gate.hidden = false;
    document.body.classList.add("gated");
    document.body.classList.remove("authed");
    const input = document.getElementById("gate-password");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 50);
    }
  }

  let scriptsLoaded = false;
  function loadAppScripts() {
    if (scriptsLoaded) return;
    scriptsLoaded = true;
    const load = (src) =>
      new Promise((ok, no) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = ok;
        s.onerror = () => no(new Error("load " + src));
        document.body.appendChild(s);
      });
    load("./app.js")
      .then(() => load("./ai.js"))
      .catch((e) => console.error(e));
  }

  async function tryLogin(ev) {
    if (ev) ev.preventDefault();
    const input = document.getElementById("gate-password");
    const err = document.getElementById("gate-error");
    const btn = document.getElementById("gate-submit");
    const pwd = (input && input.value) || "";
    if (err) err.textContent = "";
    if (!pwd) {
      if (err) err.textContent = "請輸入通行密碼。";
      return;
    }
    if (!expected) {
      if (err) err.textContent = "尚未設定通行密碼雜湊，請聯絡統籌。";
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const hash = await sha256Hex(pwd);
      if (hash !== expected) {
        if (err) err.textContent = "密碼不正確，無法進入私人工作區。";
        if (input) {
          input.value = "";
          input.focus();
        }
        return;
      }
      sessionStorage.setItem(FLAG, "1");
      showApp();
    } catch (e) {
      if (err) err.textContent = "此瀏覽器無法驗證密碼，請改用較新版本。";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function logout() {
    sessionStorage.removeItem(FLAG);
    // Soft reset: reload so app state / SW stay consistent
    location.reload();
  }

  window.sitesnapLogout = logout;

  function bind() {
    const form = document.getElementById("gate-form");
    if (form) form.addEventListener("submit", tryLogin);
    const out = document.getElementById("logout");
    if (out) out.addEventListener("click", logout);
  }

  function boot() {
    bind();
    if (sessionStorage.getItem(FLAG) === "1") showApp();
    else showGate();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
