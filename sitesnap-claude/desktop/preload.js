"use strict";
/* 只開放三個功能給網頁：存 PDF、存記錄檔、AI 連線 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SiteSnapDesktop", {
  savePDF: (name) => ipcRenderer.invoke("save-pdf", String(name || "")),
  saveFile: (name, text) => ipcRenderer.invoke("save-file", String(name || ""), text),
  aiFetch: (url, opts) => ipcRenderer.invoke("ai-fetch", String(url), opts),
});
