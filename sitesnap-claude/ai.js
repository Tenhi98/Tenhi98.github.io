"use strict";
/* AI 草擬觀察：Anthropic Claude，或任何 OpenAI 相容的 Chat Completions 服務。
   API Key 只放在記憶體；每次傳送前都要使用者確認。 */
(() => {
  const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
  const CLAUDE_DEFAULT = "claude-opus-5-5";
  // 這些型號支援伺服器端「拒絕後自動改用後備模型」
  const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
  const Desktop = window.SiteSnapDesktop || null;
  let key = "";
  let busy = false;
  let pendingJob = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  const cfg = {
    provider: lsGet("sitesnap-ai-provider") === "compat" ? "compat" : "claude",
    model: lsGet("sitesnap-ai-model") || CLAUDE_DEFAULT,
    endpoint: lsGet("sitesnap-ai-endpoint") || "",
    depth: Number(lsGet("sitesnap-ai-depth") ?? 1) || 0,
  };
  if (![0, 1, 2].includes(cfg.depth)) cfg.depth = 1;

  function syncForm() {
    $("ai-provider").value = cfg.provider;
    $("ai-model").value = cfg.model;
    $("ai-endpoint").value = cfg.endpoint;
    $("ai-depth").value = String(cfg.depth);
    $("ai-endpoint-wrap").hidden = cfg.provider === "claude";
    $("ai-route").textContent = Desktop ? t("ai.routeDesktop") : t("ai.routeBrowser");
  }
  $("ai-provider").onchange = (e) => {
    cfg.provider = e.target.value;
    if (cfg.provider === "claude" && !cfg.model.startsWith("claude-")) cfg.model = CLAUDE_DEFAULT;
    if (cfg.provider === "compat" && cfg.model.startsWith("claude-")) cfg.model = "";
    key = "";
    $("ai-key").value = "";
    save();
    syncForm();
  };
  $("ai-model").oninput = (e) => { cfg.model = e.target.value.trim(); save(); };
  $("ai-endpoint").oninput = (e) => { cfg.endpoint = e.target.value.trim(); key = ""; $("ai-key").value = ""; save(); };
  $("ai-depth").onchange = (e) => { cfg.depth = Number(e.target.value); save(); };
  $("ai-key").oninput = (e) => { key = e.target.value.trim(); };
  function save() {
    lsSet("sitesnap-ai-provider", cfg.provider);
    lsSet("sitesnap-ai-model", cfg.model);
    lsSet("sitesnap-ai-endpoint", cfg.endpoint);
    lsSet("sitesnap-ai-depth", String(cfg.depth));
  }
  $("ai-settings").onclick = () => { syncForm(); $("ai").showModal(); };

  function target() {
    if (cfg.provider === "claude") return CLAUDE_URL;
    let u;
    try { u = new URL(cfg.endpoint); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return u.href;
  }

  function request(job) {
    const { img, model, depth } = job;
    const prompt = t("ai.prompt");
    const b64 = img.split(",")[1];
    if (cfg.provider === "claude") {
      const body = {
        model,
        max_tokens: [8000, 12000, 16000][depth],
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            { type: "text", text: prompt },
          ],
        }],
      };
      if (!/haiku-4|sonnet-4-5|claude-3/.test(model)) body.output_config = { effort: ["low", "medium", "high"][depth] };
      const headers = {
        "content-type": "application/json",
        "x-api-key": job.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (FALLBACK_MODELS.has(model)) {
        body.fallbacks = "default";
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      }
      return { headers, body };
    }
    return {
      headers: { "content-type": "application/json", Authorization: "Bearer " + job.key },
      body: {
        model,
        max_tokens: [1500, 3000, 6000][depth],
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: img } }, { type: "text", text: prompt }] }],
      },
    };
  }

  function readText(json) {
    if (cfg.provider === "claude") {
      if (json.stop_reason === "refusal") throw new Error("refused");
      return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    const c = json.choices?.[0]?.message?.content;
    if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
    return c || "";
  }

  async function send(url, init, ms) {
    if (Desktop && Desktop.aiFetch) {
      // 桌面版：由主程序連線，不受瀏覽器跨域限制
      const r = await Desktop.aiFetch(url, { headers: init.headers, body: init.body, timeoutMs: ms });
      if (r.error === "timeout") { const e = new Error("timeout"); e.name = "AbortError"; throw e; }
      if (r.error) throw new Error("network");
      return { ok: r.ok, status: r.status, json: () => JSON.parse(r.text) };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, {
        method: "POST", headers: init.headers, body: init.body, signal: ctl.signal,
        credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store",
      });
      return { ok: r.ok, status: r.status, json: () => r.json() };
    } finally { clearTimeout(timer); }
  }

  $("analyse").onclick = async () => {
    if (busy) return;
    const p = App.current();
    if (!p) return;
    const url = target();
    if (cfg.provider === "compat" && !url) { App.toast(t("ai.badEndpoint")); syncForm(); $("ai").showModal(); return; }
    if (!cfg.model || !key) { App.toast(t("ai.needSetup")); syncForm(); $("ai").showModal(); $(key ? "ai-model" : "ai-key").focus(); return; }
    // 縮細後才傳送
    const bmp = await decode(p.image);
    const blob = await toJpeg(bmp, [1024, 1568, 1568][cfg.depth], 0.85);
    if (bmp.close) bmp.close();
    const img = await blobToDataURL(blob);
    pendingJob = { p, url, img, model: cfg.model, depth: cfg.depth, key, provider: cfg.provider };
    $("consent-img").src = img;
    $("consent-dest").textContent = p.name + "　｜　" + t("ai.dest", { host: new URL(url).host, model: cfg.model });
    $("consent").showModal();
  };
  $("consent").addEventListener("close", () => { if (!busy) pendingJob = null; $("consent-img").removeAttribute("src"); });

  $("consent-send").onclick = async () => {
    const job = pendingJob;
    if (!job || busy) return;
    busy = true;
    $("consent").close();
    refresh();
    try {
      const { headers, body } = request(job);
      const res = await send(job.url, { headers, body: JSON.stringify(body) }, [60000, 120000, 180000][job.depth]);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = readText(await res.json()).trim();
      if (!text) throw new Error("empty");
      job.p.draft = text.slice(0, 8000);
      App.savePhoto(job.p);
      App.toast(t("ai.received"));
    } catch (e) {
      const why = e.name === "AbortError" ? t("ai.timeout")
        : e.message === "refused" ? t("ai.refused")
        : e.message === "empty" ? t("ai.empty")
        : /^HTTP \d+$/.test(e.message) ? e.message
        : t("ai.network");
      App.toast(t("ai.failed", { why }));
    } finally {
      busy = false;
      pendingJob = null;
      App.renderEditor();
    }
  };

  $("draft-adopt").onclick = () => {
    const p = App.current();
    if (!p || !p.draft) return;
    const note = [p.note.trim(), p.draft.trim()].filter(Boolean).join("\n\n");
    if (note.length > 2400) { App.toast(t("ai.tooLong")); return; }
    p.note = note;
    p.draft = "";
    p.review = null;
    App.savePhoto(p);
    App.renderEditor();
    $("p-note").focus();
  };
  $("draft-drop").onclick = () => {
    const p = App.current();
    if (!p) return;
    p.draft = "";
    App.savePhoto(p);
    App.renderEditor();
  };

  function refresh() {
    const b = $("analyse");
    b.disabled = busy;
    b.textContent = busy ? t("ai.busy") : t("ai.analyse");
  }
  document.addEventListener("sitesnap:lang", () => { refresh(); syncForm(); });
  window.AI = { refresh };
  refresh();
})();
