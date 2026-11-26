"use strict";
/* SiteSnap 工地巡查（Claude 版）— 主介面 */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const todayHK = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Hong_Kong" }).format(new Date());
const pad2 = (n) => String(n).padStart(2, "0");
const Desktop = window.SiteSnapDesktop || null; // exe 版由 preload.js 提供
const PREVIEW = !!window.SITESNAP_PREVIEW;       // claude.ai 預覽版：不能列印或下載

const CATEGORIES = ["general", "ppe", "height", "access", "electric", "fire", "housekeeping", "other"];
const MAX_PHOTOS = 200;
const MAX_FILE = 40 * 1024 * 1024;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 私密模式 */ } }

const S = {
  inspections: [],
  cur: null,
  photos: new Map(),
  sel: null,
  urls: new Map(),
  timers: new Map(),
  jobs: new Map(),
  memoryOnly: false,
};

/* ---------- 小工具 ---------- */
let toastTimer;
function toast(msg) {
  const n = $("toast");
  n.textContent = msg;
  n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (n.hidden = true), 5200);
}

function ask(message, yesLabel) {
  return new Promise((resolve) => {
    const d = $("ask");
    $("ask-text").textContent = message;
    $("ask-yes").textContent = yesLabel || t("common.ok");
    const done = (v) => { d.close(); resolve(v); };
    $("ask-yes").onclick = () => done(true);
    $("ask-no").onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}

let lastSave = ["save.ready", false];
function saveState(key, bad = false) {
  lastSave = [key, bad];
  $("save-state").textContent = t(key);
  $("save-state").toggleAttribute("data-bad", bad);
}

function url(p, kind) {
  const k = p.id + ":" + kind;
  if (!S.urls.has(k)) {
    const b = kind === "t" ? p.thumb || p.image : p.image;
    S.urls.set(k, URL.createObjectURL(b));
  }
  return S.urls.get(k);
}
function dropUrls(id) {
  for (const k of ["t", "f"]) {
    const key = id + ":" + k;
    if (S.urls.has(key)) { URL.revokeObjectURL(S.urls.get(key)); S.urls.delete(key); }
  }
}

function ordered() {
  return S.cur ? S.cur.order.map((id) => S.photos.get(id)).filter(Boolean) : [];
}
const current = () => (S.sel ? S.photos.get(S.sel) : null);

/* ---------- 儲存（延遲寫入，避免每次按鍵都寫） ---------- */
function persist(fn) {
  if (S.memoryOnly) { saveState("save.memory", true); return Promise.resolve(); }
  saveState("save.saving");
  return fn().then(
    () => { if (!S.timers.size && !Store.pending) saveState("save.saved"); },
    () => { saveState("save.failed", true); toast(t("save.failedLong")); },
  );
}
function later(key, fn) {
  clearTimeout(S.timers.get(key));
  saveState("save.saving");
  S.jobs.set(key, fn);
  S.timers.set(key, setTimeout(() => { S.timers.delete(key); S.jobs.delete(key); persist(fn); }, 300));
}
// 立即寫入所有待儲存的更改（關閉視窗、切換到其他程式時）
async function flush() {
  const runs = [];
  for (const [key, fn] of S.jobs) {
    clearTimeout(S.timers.get(key));
    S.timers.delete(key);
    S.jobs.delete(key);
    runs.push(persist(fn));
  }
  await Promise.all(runs);
  for (let i = 0; Store.pending && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
  return true;
}
function saveInsp() {
  const insp = S.cur;
  insp.updatedAt = Date.now();
  later("insp:" + insp.id, () => Store.putInspection(insp));
}
function savePhoto(p) {
  later("photo:" + p.id, () => Store.putPhotos([p]));
}

/* ---------- 影像處理 ---------- */
async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    const u = URL.createObjectURL(blob);
    try {
      const im = new Image();
      im.src = u;
      await im.decode();
      return im;
    } finally {
      setTimeout(() => URL.revokeObjectURL(u), 0);
    }
  }
}
function toJpeg(src, max, quality) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode"))), "image/jpeg", quality));
}
async function makeImages(blob) {
  const bmp = await decode(blob);
  const image = await toJpeg(bmp, 2000, 0.85);
  const thumb = await toJpeg(bmp, 260, 0.72);
  if (bmp.close) bmp.close();
  return { image, thumb };
}
function blobToDataURL(b) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
}
function dataURLToBlob(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) throw new Error("image");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/* ---------- 巡查 ---------- */
function blankInspection() {
  return {
    id: uid(), project: "", site: "", date: todayHK(), author: lsGet("sitesnap-author") || "",
    order: [], createdAt: Date.now(), updatedAt: Date.now(), exportedAt: null,
  };
}

async function newInspection() {
  const insp = blankInspection();
  S.inspections.unshift(insp);
  if (!S.memoryOnly) await persist(() => Store.putInspection(insp));
  await selectInspection(insp.id);
  $("f-project").focus();
}

async function selectInspection(id) {
  for (const k of S.urls.values()) URL.revokeObjectURL(k);
  S.urls.clear();
  S.cur = S.inspections.find((i) => i.id === id) || S.inspections[0];
  S.photos = new Map();
  if (!S.memoryOnly) {
    try {
      for (const p of await Store.photosOf(S.cur.id)) S.photos.set(p.id, p);
    } catch { toast(t("save.failedLong")); }
  }
  // 修正順序：移除不存在的相片，補回不在順序中的相片
  const known = S.cur.order.filter((x) => S.photos.has(x));
  for (const x of S.photos.keys()) if (!known.includes(x)) known.push(x);
  S.cur.order = known;
  S.sel = S.cur.order[0] || null;
  lsSet("sitesnap-last", S.cur.id);
  render();
}

function renderInspections() {
  const list = $("insp-list");
  list.replaceChildren();
  for (const insp of S.inspections) {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    b.setAttribute("aria-current", String(insp === S.cur));
    const n = insp === S.cur ? S.cur.order.length : insp.order.length;
    b.append(el("strong", "", insp.project.trim() || t("insp.untitled")), el("small", "", (insp.date || "—") + " · " + t("insp.photos", { n })));
    b.onclick = () => { if (insp !== S.cur) selectInspection(insp.id); };
    li.append(b);
    list.append(li);
  }
}

function renderDetails() {
  for (const k of ["project", "site", "date", "author"]) {
    const f = $("f-" + k);
    if (document.activeElement !== f) f.value = S.cur[k] || "";
  }
}

function chipsFor(p) {
  const c = el("span", "chips");
  c.append(el("span", "chip " + (p.review ? "ok" : "pending"), p.review ? t("chip.reviewed") : t("chip.pending")));
  if (p.priority > 0) c.append(el("span", "chip p" + p.priority, t("prio." + p.priority)));
  return c;
}

function renderStrip() {
  const ps = ordered();
  $("photo-count").textContent = ps.length;
  const done = ps.filter((p) => p.review).length;
  $("review-progress").textContent = ps.length ? t("strip.progress", { done, n: ps.length }) : "";
  const list = $("photo-list");
  list.replaceChildren();
  ps.forEach((p, i) => {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    b.setAttribute("aria-current", String(p.id === S.sel));
    const im = el("img");
    im.src = url(p, "t");
    im.alt = "";
    im.loading = "lazy";
    const tx = el("span", "t");
    tx.append(el("b", "", pad2(i + 1) + "　" + (p.location.trim() || p.name)), chipsFor(p));
    b.append(im, tx);
    b.onclick = () => { S.sel = p.id; renderStrip(); renderEditor(); };
    li.append(b);
    list.append(li);
  });
}

function renderEditor() {
  const p = current();
  $("empty").hidden = !!p;
  $("entry").hidden = !p;
  if (!p) return;
  const ps = ordered();
  const i = ps.indexOf(p);
  $("photo").src = url(p, "f");
  $("photo").alt = p.name;
  const when = p.takenAt ? new Date(p.takenAt).toLocaleString(I18n.locale(), { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }) : "";
  $("photo-meta").textContent = pad2(i + 1) + " / " + pad2(ps.length) + "　" + p.name + (when ? "　" + when : "");
  $("move-up").disabled = i <= 0;
  $("move-down").disabled = i >= ps.length - 1;
  for (const k of ["location", "note", "action"]) {
    const f = $("p-" + k);
    if (document.activeElement !== f) f.value = p[k] || "";
  }
  $("p-category").value = p.category;
  for (const b of $("p-priority").children) b.setAttribute("aria-pressed", String(Number(b.dataset.p) === p.priority));
  $("draft").hidden = !p.draft;
  $("draft-text").textContent = p.draft || "";
  $("review").textContent = p.review ? t("review.undo") : t("review.do");
  $("review-note").textContent = p.review
    ? t("review.by", { by: p.review.by, at: new Date(p.review.at).toLocaleString(I18n.locale(), { timeZone: "Asia/Hong_Kong" }) })
    : "";
  if (window.AI) window.AI.refresh();
}

function render() {
  renderInspections();
  renderDetails();
  renderStrip();
  renderEditor();
}

/* ---------- 欄位綁定 ---------- */
function buildStaticControls() {
  const cat = $("p-category");
  cat.replaceChildren(...CATEGORIES.map((k) => new Option(t("cat." + k), k)));
  const seg = $("p-priority");
  seg.replaceChildren(...[0, 1, 2].map((n) => {
    const b = el("button", "", t("prio." + n));
    b.type = "button";
    b.dataset.p = n;
    b.onclick = () => { const p = current(); if (p) { p.priority = n; touched(p); renderEditor(); } };
    return b;
  }));
}

function touched(p) {
  if (p.review) {
    p.review = null;
    toast(t("review.reset"));
  }
  savePhoto(p);
  renderStrip();
}

for (const k of ["project", "site", "date", "author"]) {
  $("f-" + k).addEventListener("input", (e) => {
    S.cur[k] = e.target.value;
    if (k === "author") lsSet("sitesnap-author", e.target.value);
    saveInsp();
    if (k === "project" || k === "date") renderInspections();
  });
}
for (const k of ["location", "note", "action"]) {
  $("p-" + k).addEventListener("input", (e) => {
    const p = current();
    if (!p) return;
    p[k] = e.target.value;
    if (p.review) { p.review = null; toast(t("review.reset")); $("review").textContent = t("review.do"); $("review-note").textContent = ""; }
    savePhoto(p);
    if (k === "location") renderStrip();
    else updateChips(p);
  });
}
function updateChips(p) {
  const i = ordered().indexOf(p);
  const b = $("photo-list").children[i]?.querySelector(".t");
  if (b) b.replaceChild(chipsFor(p), b.querySelector(".chips"));
  const ps = ordered();
  $("review-progress").textContent = t("strip.progress", { done: ps.filter((x) => x.review).length, n: ps.length });
}
$("p-category").addEventListener("change", (e) => { const p = current(); if (p) { p.category = e.target.value; touched(p); } });

$("review").onclick = () => {
  const p = current();
  if (!p) return;
  if (p.review) {
    p.review = null;
  } else {
    if (!S.cur.author.trim()) { toast(t("review.needAuthor")); $("f-author").focus(); return; }
    if (!p.note.trim()) { toast(t("review.needNote")); $("p-note").focus(); return; }
    p.review = { by: S.cur.author.trim(), at: new Date().toISOString() };
    // 自動跳到下一張未覆核相片，方便逐張處理
    const next = ordered().find((x) => !x.review && x !== p);
    savePhoto(p);
    if (next) { S.sel = next.id; renderStrip(); renderEditor(); toast(t("review.next")); return; }
  }
  savePhoto(p);
  renderStrip();
  renderEditor();
};

/* ---------- 加入相片 ---------- */
let adding = false;
async function addFiles(files) {
  if (adding || !files.length) return;
  adding = true;
  $("take").disabled = $("pick").disabled = true;
  let ok = 0, bad = 0;
  const added = [];
  try {
    for (const f of files) {
      if (S.cur.order.length + added.length >= MAX_PHOTOS || f.size > MAX_FILE || !/^image\//.test(f.type || "image/")) { bad++; continue; }
      try {
        const { image, thumb } = await makeImages(f);
        const p = {
          id: uid(), inspectionId: S.cur.id, name: f.name || "photo.jpg", takenAt: f.lastModified || Date.now(),
          location: "", category: "general", priority: 0, note: "", action: "", draft: "", review: null, image, thumb,
        };
        S.photos.set(p.id, p);
        added.push(p);
        ok++;
      } catch { bad++; }
    }
    if (added.length) {
      S.cur.order.push(...added.map((p) => p.id));
      S.cur.updatedAt = Date.now();
      S.sel = added[0].id;
      await persist(() => Store.putPhotos(added, S.cur));
      // 第一次加相片時，向瀏覽器申請「持久保存」，減少被自動清除的機會
      if (!lsGet("sitesnap-persist-asked")) { lsSet("sitesnap-persist-asked", "1"); Store.persist(); }
    }
    render();
    toast(t("add.result", { ok }) + (bad ? t("add.skipped", { bad }) : ""));
  } finally {
    adding = false;
    $("take").disabled = $("pick").disabled = false;
  }
}
$("take").onclick = () => $("in-camera").click();
$("pick").onclick = () => $("in-files").click();
for (const id of ["in-camera", "in-files"]) {
  $(id).onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); };
}
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); });
document.addEventListener("paste", (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) addFiles(files);
});

/* ---------- 排序 / 移除 ---------- */
function move(d) {
  const o = S.cur.order, i = o.indexOf(S.sel), j = i + d;
  if (i < 0 || j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]];
  saveInsp();
  renderStrip();
  renderEditor();
}
$("move-up").onclick = () => move(-1);
$("move-down").onclick = () => move(1);
$("remove").onclick = async () => {
  const p = current();
  if (!p || !(await ask(t("photo.removeAsk", { name: p.name }), t("photo.remove")))) return;
  const o = S.cur.order, i = o.indexOf(p.id);
  o.splice(i, 1);
  S.photos.delete(p.id);
  dropUrls(p.id);
  S.sel = o[i] || o[i - 1] || null;
  S.cur.updatedAt = Date.now();
  await persist(() => Store.deletePhoto(p.id, S.cur));
  render();
};

/* ---------- 報告 ---------- */
function fmtTime(iso) {
  return new Date(iso).toLocaleString(I18n.locale(), { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }) + " HKT";
}
function buildReport() {
  const ps = ordered();
  const pages = $("report-pages");
  pages.replaceChildren();
  pages.classList.toggle("compact", $("report-compact").checked);
  const insp = S.cur;
  const title = (insp.project.trim() || t("insp.untitled"));
  const pending = ps.filter((p) => !p.review).length;
  const meta = [insp.site, insp.date, insp.author && t("report.by", { by: insp.author })].filter(Boolean).join("　｜　");

  // 封面 + 摘要 + 索引
  const cover = el("article", "sheet");
  const bar = el("div", "bar");
  bar.append(el("span", "", "SITESNAP · " + t("report.kind")), el("span", "", insp.date || ""));
  cover.append(bar, el("h1", "", title), el("p", "", meta));
  if (pending) cover.append(el("span", "stamp", t("report.draftStamp", { n: pending })));
  const sum = el("div", "summary");
  const tile = (n, label) => { const d = el("div"); d.append(el("b", "", String(n)), el("span", "", label)); return d; };
  sum.append(
    tile(ps.length, t("report.total")),
    tile(ps.length - pending, t("report.reviewed")),
    tile(ps.filter((p) => p.priority === 1).length, t("prio.1")),
    tile(ps.filter((p) => p.priority === 2).length, t("prio.2")),
  );
  cover.append(sum, el("h3", "", t("report.index")));
  const tbl = el("table");
  const hr = el("tr");
  for (const h of ["#", t("p.location"), t("p.category"), t("p.priority"), t("report.status")]) hr.append(el("th", "", h));
  tbl.append(hr);
  ps.forEach((p, i) => {
    const tr = el("tr");
    tr.append(el("td", "num", pad2(i + 1)), el("td", "", p.location || "—"), el("td", "", t("cat." + p.category)));
    const pr = el("td");
    pr.append(el("span", "pill p" + p.priority, t("prio." + p.priority)));
    tr.append(pr, el("td", "", p.review ? t("chip.reviewed") : t("chip.pending")));
    tbl.append(tr);
  });
  cover.append(tbl);
  pages.append(cover);

  // 每張相片一個記錄（精簡模式兩張一頁）
  const recs = ps.map((p, i) => {
    const r = el("section", "rec");
    const im = el("img", "rec-img");
    im.src = url(p, "f");
    im.alt = p.name;
    const head = el("p");
    head.append(el("b", "", pad2(i + 1) + "　" + (p.location || t("report.noLocation"))), document.createTextNode("　"), el("span", "pill p" + p.priority, t("prio." + p.priority)));
    r.append(head, im, el("p", "meta", p.name + (p.takenAt ? "　" + fmtTime(new Date(p.takenAt).toISOString()) : "")));
    r.append(el("h3", "", t("p.category")), el("p", "", t("cat." + p.category)));
    r.append(el("h3", "", t("p.note")), el("p", "", p.note || "—"));
    r.append(el("h3", "", t("p.action")), el("p", "", p.action || t("report.noAction")));
    const sig = el("div", "sig");
    sig.append(el("span", "", p.review ? t("report.reviewedBy", { by: p.review.by }) : t("chip.pending")), el("span", "", p.review ? fmtTime(p.review.at) : ""));
    r.append(sig);
    return r;
  });
  const per = $("report-compact").checked ? 2 : 1;
  for (let i = 0; i < recs.length; i += per) {
    const sheet = el("article", "sheet");
    const b = el("div", "bar");
    b.append(el("span", "", title), el("span", "", t("report.page", { a: Math.floor(i / per) + 2, b: Math.ceil(recs.length / per) + 1 })));
    const wrap = el("div", per > 1 ? "rec-pair" : "");
    wrap.append(...recs.slice(i, i + per));
    sheet.append(b, wrap);
    pages.append(sheet);
  }
}
$("open-report").onclick = () => {
  if (!ordered().length) { toast(t("report.empty")); return; }
  buildReport();
  $("report").showModal();
};
$("report-compact").onchange = buildReport;
$("report-print").onclick = async () => {
  await Promise.all([...$("report-pages").querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
  const name = (S.cur.project.trim() || "SiteSnap") + "-" + (S.cur.date || todayHK()) + ".pdf";
  if (Desktop && Desktop.savePDF) {
    const r = await Desktop.savePDF(name);
    if (r && r.saved) toast(t("report.pdfSaved", { path: r.path }));
  } else {
    window.print();
  }
};

/* ---------- 匯出 / 匯入 ---------- */
async function exportInspection() {
  const insp = S.cur;
  const photos = [];
  for (const p of ordered()) {
    photos.push({
      name: p.name, location: p.location, category: I18n.zh("cat." + p.category), categoryKey: p.category,
      priority: p.priority, takenAt: p.takenAt || null, note: p.note, action: p.action, draft: p.draft || "",
      review: p.review, image: await blobToDataURL(p.image),
    });
  }
  // version 1 與原版 SiteSnap 的記錄檔格式相容（雙向都可匯入）
  const data = JSON.stringify({ version: 1, app: "sitesnap-claude", project: insp.project, site: insp.site, date: insp.date, author: insp.author, photos });
  const name = (insp.project.trim() || "SiteSnap") + "-" + (insp.date || todayHK()) + ".sitesnap.json";
  let saved = false;
  if (Desktop && Desktop.saveFile) {
    const r = await Desktop.saveFile(name, data);
    saved = !!(r && r.saved);
  } else {
    const a = document.createElement("a");
    const u = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.href = u;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 20000);
    saved = true;
  }
  if (saved) {
    insp.exportedAt = Date.now();
    saveInsp();
    refreshData();
    toast(t("data.exported"));
  }
}

const ZH_CAT = Object.fromEntries(CATEGORIES.map((k) => [I18n.zh("cat." + k), k]));
// 原版的類別文字
Object.assign(ZH_CAT, { "一般現場紀錄": "general", "個人防護裝備": "ppe", "高處及臨邊": "height", "通道及物料": "access", "臨時用電": "electric", "其他": "other" });

async function importFile(file) {
  if (file.size > 300 * 1024 * 1024) throw new Error("size");
  const v = JSON.parse(await file.text());
  if (!v || v.version !== 1 || !Array.isArray(v.photos) || v.photos.length > MAX_PHOTOS) throw new Error("format");
  const str = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
  const insp = blankInspection();
  Object.assign(insp, { project: str(v.project, 120), site: str(v.site, 160), date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : todayHK(), author: str(v.author, 80) });
  const photos = [];
  for (const q of v.photos) {
    if (!q || typeof q.image !== "string" || q.image.length > 12_000_000) throw new Error("photo");
    const { image, thumb } = await makeImages(dataURLToBlob(q.image));
    const cat = CATEGORIES.includes(q.categoryKey) ? q.categoryKey : ZH_CAT[q.category] || "other";
    const p = {
      id: uid(), inspectionId: insp.id, name: str(q.name, 200) || "photo.jpg", takenAt: Number.isFinite(q.takenAt) ? q.takenAt : null,
      location: str(q.location, 160), category: cat, priority: [0, 1, 2].includes(q.priority) ? q.priority : 0,
      note: str(q.note, 2400), action: str(q.action, 1400), draft: str(q.draft, 8000), review: null, image, thumb,
    };
    if (q.review && typeof q.review.by === "string" && q.review.by.trim() && p.note.trim() && Number.isFinite(Date.parse(q.review.at))) {
      p.review = { by: q.review.by.slice(0, 80), at: new Date(q.review.at).toISOString() };
    }
    photos.push(p);
  }
  insp.order = photos.map((p) => p.id);
  // 匯入會「新增」一份巡查，不會覆蓋現有記錄
  await persist(() => Store.putPhotos(photos, insp));
  S.inspections.unshift(insp);
  await selectInspection(insp.id);
  return photos.length;
}

async function refreshData() {
  const e = await Store.estimate();
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1) + " MB";
  $("data-usage").textContent = e ? mb(e.usage) + " / " + mb(e.quota) : t("data.unknown");
  $("data-persist").textContent = e ? (e.persisted ? t("data.persistYes") : t("data.persistNo")) : t("data.unknown");
  $("data-last").textContent = S.cur.exportedAt ? new Date(S.cur.exportedAt).toLocaleString(I18n.locale()) : t("data.never");
}
$("open-data").onclick = async () => { await refreshData(); $("data").showModal(); };
$("export").onclick = async () => {
  $("export").disabled = true;
  try { await exportInspection(); } catch { toast(t("data.exportFailed")); }
  finally { $("export").disabled = false; }
};
$("import").onclick = () => $("in-backup").click();
$("in-backup").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("data").close();
  toast(t("data.importing"));
  try { toast(t("data.imported", { n: await importFile(f) })); }
  catch { toast(t("data.importFailed")); }
};
$("delete-insp").onclick = async () => {
  const name = S.cur.project.trim() || t("insp.untitled");
  if (!(await ask(t("data.deleteAsk", { name, n: S.cur.order.length }), t("data.delete")))) return;
  const id = S.cur.id;
  await persist(() => Store.deleteInspection(id));
  S.inspections = S.inspections.filter((i) => i.id !== id);
  $("data").close();
  if (!S.inspections.length) await newInspection();
  else await selectInspection(S.inspections[0].id);
  toast(t("data.deleted"));
};

/* ---------- 其他 ---------- */
$("new-insp").onclick = newInspection;
for (const b of document.querySelectorAll(".close-dlg")) b.addEventListener("click", () => b.closest("dialog").close());
$("lang").onclick = () => {
  I18n.set(I18n.lang === "zh" ? "en" : "zh");
};
document.addEventListener("sitesnap:lang", () => {
  $("lang").textContent = I18n.lang === "zh" ? "English" : "中文";
  buildStaticControls();
  saveState(...lastSave);
  render();
  if ($("report").open) buildReport();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
window.addEventListener("beforeunload", (e) => {
  // 桌面版關閉前由主程序呼叫 App.flush()，不需要提示
  if (!Desktop && (S.timers.size || Store.pending)) { flush(); e.preventDefault(); e.returnValue = ""; }
});

async function boot() {
  I18n.apply();
  $("lang").textContent = I18n.lang === "zh" ? "English" : "中文";
  buildStaticControls();
  if (PREVIEW) {
    $("report-print").replaceWith(el("span", "hint", t("preview.noPrint")));
    $("export").replaceWith(el("span", "hint", t("preview.noExport")));
  }
  try {
    await Store.open();
    S.inspections = await Store.listInspections();
  } catch {
    S.memoryOnly = true;
  }
  // 預覽版第一次開啟時放入示例資料，方便試用
  if (PREVIEW && window.SITESNAP_SEED && !S.memoryOnly && !S.inspections.length) {
    try { await window.SITESNAP_SEED({ Store, makeImages, blankInspection, uid }); S.inspections = await Store.listInspections(); } catch { /* 無示例亦可 */ }
  }
  if (!S.inspections.length) {
    await newInspection();
  } else {
    const last = lsGet("sitesnap-last");
    await selectInspection(S.inspections.some((i) => i.id === last) ? last : S.inspections[0].id);
  }
  saveState(S.memoryOnly ? "save.memory" : "save.ready", S.memoryOnly);
  if (S.memoryOnly) toast(t("save.memoryLong"));
}

window.App = { current, url, savePhoto, renderEditor, toast, flush, get cur() { return S.cur; } };
boot();

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !PREVIEW && !Desktop) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
