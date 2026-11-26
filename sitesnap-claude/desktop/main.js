"use strict";
/* SiteSnap 桌面版（Windows exe）主程序
   - 用自訂的 app:// 協定載入網頁版檔案，令資料庫位置固定，記錄不會因為換埠而遺失
   - 報告直接存成 PDF、記錄檔用「另存新檔」對話框
   - AI 請求由主程序發出，不受瀏覽器跨域限制，並會使用 Windows 的代理設定 */
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

const WEB_DIR = path.join(__dirname, "web");
const ORIGIN = "app://sitesnap";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// 只容許開一個視窗，避免兩個程式同時寫入同一個資料庫
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: "SiteSnap 工地巡查",
    icon: path.join(WEB_DIR, "icon-512.png"),
    backgroundColor: "#eef0ee",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadURL(ORIGIN + "/index.html");

  // 關閉前先把未寫入的更改存好（最多等 3 秒）
  let flushed = false;
  win.on("close", (e) => {
    if (flushed) return;
    e.preventDefault();
    const flush = win.webContents.executeJavaScript("window.App && window.App.flush ? window.App.flush() : true", true).catch(() => true);
    Promise.race([flush, new Promise((r) => setTimeout(r, 3000))]).then(() => {
      flushed = true;
      if (!win.isDestroyed()) win.close();
    });
  });

  // 不可離開本程式頁面；外部 https 連結交給預設瀏覽器
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN + "/")) {
      e.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  protocol.handle("app", async (req) => {
    const u = new URL(req.url);
    if (u.host !== "sitesnap") return new Response("Not found", { status: 404 });
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR + path.sep)) return new Response("Forbidden", { status: 403 });
    try {
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  // 本程式不需要相機以外的任何權限；檔案選擇不經權限系統
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  createWindow();
});

app.on("window-all-closed", () => app.quit());

/* ---------- 給網頁使用的功能（經 preload.js） ---------- */
function safeName(name, ext) {
  const base = String(name || "SiteSnap").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
}

ipcMain.handle("save-pdf", async (e, name) => {
  const wc = e.sender;
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(wc), {
    defaultPath: path.join(app.getPath("documents"), safeName(name, ".pdf")),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled || !r.filePath) return { saved: false };
  const pdf = await wc.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
  await fs.writeFile(r.filePath, pdf);
  shell.showItemInFolder(r.filePath);
  return { saved: true, path: r.filePath };
});

ipcMain.handle("save-file", async (e, name, text) => {
  if (typeof text !== "string") return { saved: false };
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(app.getPath("documents"), safeName(name, ".json")),
    filters: [{ name: "SiteSnap", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return { saved: false };
  await fs.writeFile(r.filePath, text, "utf8");
  return { saved: true, path: r.filePath };
});

ipcMain.handle("ai-fetch", async (e, url, opts) => {
  // 只接受來自本程式頁面、發往 https 網址的 POST
  if (!e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN + "/")) return { error: "forbidden" };
  let u;
  try { u = new URL(url); } catch { return { error: "bad-url" }; }
  if (u.protocol !== "https:" || u.username || u.password) return { error: "bad-url" };
  const headers = opts && typeof opts.headers === "object" ? opts.headers : {};
  const body = opts && typeof opts.body === "string" ? opts.body : "";
  const ms = Math.min(Math.max(Number(opts && opts.timeoutMs) || 60000, 5000), 300000);
  try {
    const res = await net.fetch(u.href, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(ms) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err) {
    return { error: err && err.name === "TimeoutError" ? "timeout" : "network" };
  }
});
