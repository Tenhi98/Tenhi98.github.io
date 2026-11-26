"use strict";
/* AI 草擬觀察
   - 知名服務商按產品名稱字母排序並列，不預設任何一家；其他服務用「OpenAI 相容接口」。
   - 選定後，接口網址、地區、模型都清楚顯示，亦可自行修改。
   - 相片由使用者裝置直接傳到所選服務，不經 SiteSnap 任何伺服器；API Key 只放在記憶體。
   每家的格式：
     anthropic — Anthropic Messages API
     gemini    — Google generateContent
     openai    — OpenAI 相容 Chat Completions（多數服務商都用這個） */
(() => {
  const Desktop = window.SiteSnapDesktop || null;

  // 按產品名稱字母排序（程式內再排一次，確保次序公平）。模型名稱只是建議，可直接輸入其他名稱。
  // 未列出的服務，選「其他（OpenAI 相容接口）」並填上網址即可。
  const PROVIDERS = [
    { id: "claude", sort: "Claude", name: ["Claude（Anthropic）", "Claude (Anthropic)"], format: "anthropic",
      url: "https://api.anthropic.com/v1/messages", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
    { id: "deepseek", sort: "DeepSeek", name: ["DeepSeek 深度求索", "DeepSeek"], format: "openai",
      url: "https://api.deepseek.com/chat/completions", models: ["deepseek-flash"] },
    { id: "doubao", sort: "Doubao", name: ["Doubao 豆包（字節跳動 火山方舟）", "Doubao (ByteDance Volcano Ark)"], format: "openai",
      url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", models: [], hint: "ai.hint.ark" },
    { id: "gemini", sort: "Gemini", name: ["Gemini（Google）", "Gemini (Google)"], format: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", models: ["gemini-3.5-flash"] },
    { id: "glm", sort: "GLM", name: ["GLM 智譜", "GLM (Zhipu)"], format: "openai", models: ["glm-4.6v", "glm-4.6v-flash", "glm-4.6v-flashx"],
      regions: [
        { id: "bigmodel", name: ["智譜開放平台（中國內地）", "BigModel (Mainland China)"], url: "https://open.bigmodel.cn/api/paas/v4/chat/completions" },
        { id: "zai", name: ["Z.AI（國際）", "Z.AI (International)"], url: "https://api.z.ai/api/paas/v4/chat/completions" },
      ] },
    { id: "gpt", sort: "GPT", name: ["GPT（OpenAI）", "GPT (OpenAI)"], format: "openai", tokens: "max_completion_tokens",
      url: "https://api.openai.com/v1/chat/completions", models: ["gpt-5.4-mini", "gpt-5.4"] },
    { id: "grok", sort: "Grok", name: ["Grok（xAI）", "Grok (xAI)"], format: "openai",
      url: "https://api.x.ai/v1/chat/completions", models: ["grok-4.7", "grok-4.3"] },
    { id: "qwen", sort: "Qwen", name: ["Qwen 通義千問（阿里雲百煉）", "Qwen (Alibaba Cloud Model Studio)"], format: "openai", models: ["qwen3-vl-plus"],
      regions: [
        { id: "cn", name: ["中國內地（北京）", "Mainland China (Beijing)"], url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
        { id: "intl", name: ["國際（新加坡）", "International (Singapore)"], url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" },
      ] },
  ].sort((a, b) => a.sort.localeCompare(b.sort, "en"));
  // 其他服務一律走 OpenAI 相容接口，固定放最後
  PROVIDERS.push({ id: "custom", sort: "~", name: ["其他（OpenAI 相容接口）", "Other (OpenAI-compatible API)"], format: "openai",
    url: "", models: [], hint: "ai.hint.custom" });
  // 這些 Claude 型號支援伺服器端「拒絕後自動改用後備模型」
  const CLAUDE_FALLBACK = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

  const byId = (id) => PROVIDERS.find((p) => p.id === id) || null;
  const nameOf = (p) => p.name[I18n.lang === "en" ? 1 : 0];

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  /* 設定：每家服務各自記住地區、網址、模型；API Key 不保存 */
  let providerId = byId(lsGet("sitesnap-ai-provider")) ? lsGet("sitesnap-ai-provider") : "";
  const savedDepth = lsGet("sitesnap-ai-depth");
  let depth = savedDepth !== null && [0, 1, 2].includes(Number(savedDepth)) ? Number(savedDepth) : 1; // 預設「標準」
  let key = "";
  let busy = false;
  let pendingJob = null;

  function defaults(p, regionId) {
    const region = p.regions ? p.regions.find((r) => r.id === regionId) || p.regions[0] : null;
    return { region: region ? region.id : "", url: region ? region.url : p.url, model: p.models[0] || "" };
  }
  function loadCfg(p) {
    let saved = {};
    try { saved = JSON.parse(lsGet("sitesnap-ai:" + p.id) || "{}") || {}; } catch { saved = {}; }
    const d = defaults(p, saved.region);
    return { region: d.region, url: typeof saved.url === "string" && saved.url ? saved.url : d.url, model: typeof saved.model === "string" ? saved.model : d.model };
  }
  function saveCfg(p, c) { lsSet("sitesnap-ai:" + p.id, JSON.stringify(c)); }
  let cfg = providerId ? loadCfg(byId(providerId)) : null;

  /* ---------- 設定對話框 ---------- */
  function buildProviderSelect() {
    const sel = $("ai-provider");
    const choose = new Option(t("ai.choose"), "");
    choose.disabled = true;
    sel.replaceChildren(choose, ...PROVIDERS.map((p) => new Option(nameOf(p), p.id)));
    sel.value = providerId;
  }

  function syncForm() {
    buildProviderSelect();
    const p = byId(providerId);
    $("ai-fields").hidden = !p;
    $("ai-route").textContent = Desktop ? t("ai.routeDesktop") : t("ai.routeBrowser");
    if (!p) return;
    $("ai-region-wrap").hidden = !p.regions;
    $("ai-region").replaceChildren(...(p.regions || []).map((r) => new Option(r.name[I18n.lang === "en" ? 1 : 0], r.id)));
    if (p.regions) $("ai-region").value = cfg.region;
    $("ai-endpoint").value = cfg.url;
    $("ai-endpoint").placeholder = "https://…/chat/completions";
    $("ai-reset-url").hidden = p.id === "custom" || cfg.url === defaults(p, cfg.region).url;
    $("ai-model").value = cfg.model;
    $("ai-model").placeholder = p.models.length ? "" : t("ai.modelPh");
    $("ai-models").replaceChildren(...p.models.map((m) => new Option(m, m)));
    const hints = [];
    if (p.hint) hints.push(t(p.hint));
    if (p.format === "openai") hints.push(t("ai.hint.vision"));
    $("ai-model-hint").textContent = hints.join(" ");
    $("ai-model-hint").hidden = !hints.length;
    $("ai-depth").value = String(depth);
  }

  $("ai-provider").onchange = (e) => {
    providerId = e.target.value;
    cfg = loadCfg(byId(providerId));
    key = "";
    $("ai-key").value = "";
    lsSet("sitesnap-ai-provider", providerId);
    syncForm();
  };
  $("ai-region").onchange = (e) => {
    const p = byId(providerId);
    const d = defaults(p, e.target.value);
    cfg.region = d.region;
    cfg.url = d.url;
    key = "";
    $("ai-key").value = "";
    saveCfg(p, cfg);
    syncForm();
  };
  $("ai-endpoint").oninput = (e) => {
    cfg.url = e.target.value.trim();
    key = "";
    $("ai-key").value = "";
    saveCfg(byId(providerId), cfg);
    $("ai-reset-url").hidden = providerId === "custom" || cfg.url === defaults(byId(providerId), cfg.region).url;
  };
  $("ai-reset-url").onclick = () => {
    const p = byId(providerId);
    cfg.url = defaults(p, cfg.region).url;
    saveCfg(p, cfg);
    syncForm();
  };
  $("ai-model").oninput = (e) => { cfg.model = e.target.value.trim(); saveCfg(byId(providerId), cfg); };
  $("ai-depth").onchange = (e) => { depth = Number(e.target.value); lsSet("sitesnap-ai-depth", String(depth)); };
  $("ai-key").oninput = (e) => { key = e.target.value.trim(); };
  $("ai-settings").onclick = () => { syncForm(); $("ai").showModal(); };

  /* ---------- 組裝請求 ---------- */
  function endpointFor(p, c) {
    let raw = c.url;
    if (p.format === "gemini") raw = raw.replace("{model}", encodeURIComponent(c.model));
    let u;
    try { u = new URL(raw); } catch { return { error: "ai.badEndpoint" }; }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return { error: "ai.badEndpoint" };
    return { url: u.href };
  }

  function buildRequest(job) {
    const { p, img, model, d, apiKey } = job;
    const prompt = t("ai.prompt");
    const b64 = img.split(",")[1];
    if (p.format === "anthropic") {
      const body = {
        model,
        max_tokens: [8000, 12000, 16000][d],
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: prompt },
        ] }],
      };
      if (!/haiku-4|sonnet-4-5|claude-3/.test(model)) body.output_config = { effort: ["low", "medium", "high"][d] };
      const headers = {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (CLAUDE_FALLBACK.has(model)) {
        body.fallbacks = "default";
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      }
      return { headers, body };
    }
    if (p.format === "gemini") {
      return {
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: b64 } }] }],
          generationConfig: { maxOutputTokens: [2048, 4096, 8192][d] },
        },
      };
    }
    const headers = { "content-type": "application/json", Authorization: "Bearer " + apiKey };
    const body = {
      model,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: img } }, { type: "text", text: prompt }] }],
    };
    body[p.tokens || "max_tokens"] = [1500, 3000, 6000][d];
    return { headers, body };
  }

  function readText(p, json) {
    if (p.format === "anthropic") {
      if (json.stop_reason === "refusal") throw new Error("refused");
      return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    if (p.format === "gemini") {
      const c = json.candidates?.[0];
      if (!c && json.promptFeedback?.blockReason) throw new Error("refused");
      return (c?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join("");
    }
    const c = json.choices?.[0]?.message?.content;
    if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
    return c || "";
  }

  async function send(url, init, ms) {
    if (Desktop && Desktop.aiFetch) {
      // 桌面版：由主程序連線，不受瀏覽器跨域限制，並使用 Windows 的代理設定
      const r = await Desktop.aiFetch(url, { headers: init.headers, body: init.body, timeoutMs: ms });
      if (r.error === "timeout") { const e = new Error("timeout"); e.name = "AbortError"; throw e; }
      if (r.error) throw new Error("network");
      return { ok: r.ok, status: r.status, json: async () => JSON.parse(r.text) };
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

  /* ---------- 分析流程：設定 → 確認 → 傳送 ---------- */
  function openSettings(focusId) {
    syncForm();
    $("ai").showModal();
    if (focusId) $(focusId).focus();
  }

  $("analyse").onclick = async () => {
    if (busy) return;
    const photo = App.current();
    if (!photo) return;
    const p = byId(providerId);
    if (!p) { App.toast(t("ai.needProvider")); openSettings("ai-provider"); return; }
    if (!cfg.model) { App.toast(t("ai.needModel")); openSettings("ai-model"); return; }
    const ep = endpointFor(p, cfg);
    if (ep.error) { App.toast(t(ep.error)); openSettings("ai-endpoint"); return; }
    if (!key) { App.toast(t("ai.needKey")); openSettings("ai-key"); return; }
    // 先縮細才傳送
    const bmp = await decode(photo.image);
    const blob = await toJpeg(bmp, [1024, 1568, 1568][depth], 0.85);
    if (bmp.close) bmp.close();
    const img = await blobToDataURL(blob);
    pendingJob = { photo, p, url: ep.url, img, model: cfg.model, d: depth, apiKey: key };
    $("consent-img").src = img;
    $("consent-dest").textContent = t("ai.dest", { name: nameOf(p), host: new URL(ep.url).host, model: cfg.model });
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
      const { headers, body } = buildRequest(job);
      const res = await send(job.url, { headers, body: JSON.stringify(body) }, [60000, 120000, 180000][job.d]);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = readText(job.p, await res.json()).trim();
      if (!text) throw new Error("empty");
      job.photo.draft = text.slice(0, 8000);
      App.savePhoto(job.photo);
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
  document.addEventListener("sitesnap:lang", () => { refresh(); if ($("ai").open) syncForm(); });
  window.AI = { refresh, providers: PROVIDERS };
  refresh();
})();
