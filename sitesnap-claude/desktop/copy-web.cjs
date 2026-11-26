"use strict";
/* 把網頁版檔案複製到 desktop/web/，供 Electron 打包。網頁版是唯一的原始碼。 */
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..");
const out = path.join(__dirname, "web");
const files = ["index.html", "style.css", "i18n.js", "store.js", "app.js", "ai.js", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, f));
console.log("copied " + files.length + " files to web/");
