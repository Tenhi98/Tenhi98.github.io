"use strict";
const $ = (id) => document.getElementById(id),
  el = (tag, s) => {
    const n = document.createElement(tag);
    if (s !== undefined) n.textContent = s;
    return n;
  };
const fields = ["project", "site", "date", "author"],
  details = ["location", "category", "note", "action"];
const fresh = () => ({
  version: 1,
  project: "",
  site: "",
  date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Hong_Kong" }).format(
    new Date(),
  ),
  author: "",
  photos: [],
});
let book = fresh(),
  selected = "",
  db,
  pics = new Map(),
  saving = Promise.resolve(),
  msgTimer,
  loading = false,
  busy = false,
  request,
  revision = 0,
  stored = 0;
const uid = () => crypto.randomUUID(),
  current = () => book.photos.find((p) => p.id === selected);
function say(s) {
  $("message").textContent = s;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ($("message").textContent = ""), 7000);
}
function status(s, bad = false) {
  $("save").textContent = s;
  $("save").toggleAttribute("data-error", bad);
}
function txwork(stores, mode, fn) {
  return new Promise((ok, no) => {
    const t = db.transaction(stores, mode);
    t.oncomplete = ok;
    t.onabort = t.onerror = () => no(t.error || Error("storage"));
    fn(t);
  });
}
function save(add = [], del = [], clear = false) {
  const snap = structuredClone(book),
    ver = ++revision;
  status("儲存中…");
  saving = saving
    .then(async () => {
      if (!db) throw Error();
      await txwork(["book", "pics"], "readwrite", (t) => {
        const p = t.objectStore("pics");
        if (clear) p.clear();
        for (const id of del) p.delete(id);
        for (const [id, src] of add) p.put(src, id);
        t.objectStore("book").put(snap, "current");
      });
      stored = ver;
      if (ver === revision) status("已儲存於本機");
    })
    .catch(() => {
      status("未能儲存 · 請備份工程", true);
      say("瀏覽器無法保存本次更改，請立即備份工程。");
    });
  return saving;
}
async function boot() {
  try {
    db = await new Promise((ok, no) => {
      const r = indexedDB.open("sitesnap-fieldbook-v1", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("book");
        r.result.createObjectStore("pics");
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    let saved;
    await txwork(["book", "pics"], "readonly", (t) => {
      let r = t.objectStore("book").get("current");
      r.onsuccess = () => (saved = r.result);
      let c = t.objectStore("pics").openCursor();
      c.onsuccess = () => {
        let v = c.result;
        if (v) {
          pics.set(v.key, v.value);
          v.continue();
        }
      };
    });
    if (saved) book = saved;
    status("已就緒 · 本機儲存");
  } catch {
    status("暫存模式 · 請手動備份", true);
  }
  selected = book.photos[0]?.id;
  draw();
  document.querySelector("main").inert = false;
}
function draw() {
  for (const k of fields) $(k).value = book[k];
  const p = current(),
    n = book.photos.length;
  $("count").textContent = String(n).padStart(2, "0");
  $("progress").textContent = n
    ? book.photos.filter((i) => i.review).length + " / " + n + " 已覆核"
    : "";
  $("list").replaceChildren();
  for (const [i, r] of book.photos.entries()) {
    const b = el("button"),
      im = el("img"),
      v = el(
        "span",
        String(i + 1).padStart(2, "0") + "　" + (r.location || r.name),
      );
    b.className = "tile" + (r === p ? " active" : "");
    im.src = pics.get(r.id);
    im.alt = "";
    v.append(el("small", r.review ? "已覆核" : "待覆核"));
    b.append(im, v);
    b.onclick = () => {
      selected = r.id;
      draw();
    };
    $("list").append(b);
  }
  $("empty").hidden = !!p;
  $("entry").hidden = !p;
  $("report").disabled = !n;
  if (!p) return;
  $("photo").src = pics.get(p.id);
  $("filename").textContent = p.name;
  $("up").disabled = book.photos[0] === p;
  $("down").disabled = book.photos.at(-1) === p;
  for (const k of details) $(k).value = p[k];
  $("draft").hidden = !p.draft;
  $("drafttext").textContent = p.draft || "";
  $("review").textContent = p.review ? "撤回覆核" : "確認已覆核";
  $("analyse").disabled = busy;
  $("analyse").textContent = busy ? "分析中…" : "✧ AI 輔助觀察";
}
for (const k of fields)
  $(k).oninput = () => {
    book[k] = $(k).value;
    save();
  };
for (const k of details)
  $(k).oninput = () => {
    const p = current();
    p[k] = $(k).value;
    p.review = null;
    $("review").textContent = "確認已覆核";
    $("progress").textContent =
      book.photos.filter((i) => i.review).length +
      " / " +
      book.photos.length +
      " 已覆核";
    const v = $("list").querySelector(".active span");
    if (v) {
      v.firstChild.textContent =
        String(book.photos.indexOf(p) + 1).padStart(2, "0") +
        "　" +
        (p.location || p.name);
      v.querySelector("small").textContent = "待覆核";
    }
    save();
  };
function review() {
  const p = current();
  if (!p.review) {
    if (!p.note.trim() || !book.author.trim()) {
      say("請先填寫記錄人和現場觀察，再確認覆核。");
      (!book.author.trim() ? $("author") : $("note")).focus();
      return;
    }
    p.review = { by: book.author.trim(), at: new Date().toISOString() };
  } else p.review = null;
  save();
  draw();
}
$("review").onclick = review;
async function resize(source, limit) {
  const im = new Image();
  im.src = source;
  await im.decode();
  const w = im.naturalWidth,
    h = im.naturalHeight,
    scale = Math.min(1, limit / Math.max(w, h)),
    c = el("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.84);
}
function lock(v) {
  loading = v;
  document.querySelector("main").inert = v;
}
async function addFiles(files) {
  if (loading || !files.length) return;
  lock(true);
  let total = 0,
    failed = 0,
    added = [];
  try {
    for (const f of files) {
      if (book.photos.length >= 120 || f.size > 40 * 1024 * 1024) {
        failed++;
        continue;
      }
      let u = URL.createObjectURL(f);
      try {
        const src = await resize(u, 1800),
          id = uid();
        pics.set(id, src);
        added.push([id, src]);
        book.photos.push({
          id,
          name: f.name,
          location: "",
          category: "一般現場紀錄",
          note: "",
          action: "",
          draft: "",
          review: null,
        });
        if (!total) selected = id;
        total++;
      } catch {
        failed++;
      } finally {
        URL.revokeObjectURL(u);
      }
    }
    if (total) await save(added);
    draw();
    say(
      "已加入 " +
        total +
        " 張相片" +
        (failed
          ? "；有 " + failed + " 張未能加入（格式、大小或數量限制）。"
          : "。"),
    );
  } finally {
    lock(false);
  }
}
for (const [b, i] of [
  ["capture", "camera"],
  ["import", "files"],
]) {
  $(b).onclick = () => $(i).click();
  $(i).onchange = () => {
    const f = [...$(i).files];
    $(i).value = "";
    addFiles(f);
  };
}
for (const [k, d] of [
  ["up", -1],
  ["down", 1],
])
  $(k).onclick = () => {
    const i = book.photos.indexOf(current()),
      j = i + d;
    if (j >= 0 && j < book.photos.length) {
      [book.photos[i], book.photos[j]] = [book.photos[j], book.photos[i]];
      save();
      draw();
    }
  };
$("remove").onclick = () => {
  const p = current();
  if (!confirm("從本工程移除「" + p.name + "」及其觀察？")) return;
  const i = book.photos.indexOf(p);
  book.photos.splice(i, 1);
  pics.delete(p.id);
  selected = (book.photos[i] || book.photos.at(-1))?.id;
  save([], [p.id]);
  draw();
};
function download(data, name, type) {
  const a = el("a"),
    u = URL.createObjectURL(new Blob([data], { type }));
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 15000);
}
$("backup").onclick = () =>
  download(
    JSON.stringify({
      ...book,
      photos: book.photos.map((p) => ({ ...p, image: pics.get(p.id) })),
    }),
    (book.project || "SiteSnap") + "-" + book.date + ".sitesnap.json",
    "application/json",
  );
$("restore").onclick = () => $("backupfile").click();
$("backupfile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  lock(true);
  try {
    if (f.size > 220 * 1024 * 1024) throw Error();
    const v = JSON.parse(await f.text()),
      next = fresh(),
      set = new Map();
    if (v.version !== 1 || !Array.isArray(v.photos) || v.photos.length > 120)
      throw Error();
    for (const k of fields) {
      if (typeof v[k] !== "string") throw Error();
      next[k] = v[k].slice(0, 300);
    }
    for (const q of v.photos) {
      if (
        !q ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(q.image) ||
        q.image.length > 6000000
      )
        throw Error();
      const im = new Image();
      im.src = q.image;
      await im.decode();
      const p = { id: uid(), review: null };
      for (const k of [...details, "name", "draft"]) {
        if (typeof q[k] !== "string") throw Error();
        p[k] = q[k].slice(0, 9000);
      }
      if (
        q.review &&
        typeof q.review.by === "string" &&
        q.review.by.trim() &&
        p.note.trim() &&
        Number.isFinite(Date.parse(q.review.at))
      )
        p.review = {
          by: q.review.by.slice(0, 80),
          at: new Date(q.review.at).toISOString(),
        };
      next.photos.push(p);
      set.set(p.id, q.image);
    }
    if (!confirm("以此備份取代目前工程？請先確定目前工程已備份。")) return;
    book = next;
    pics = set;
    selected = book.photos[0]?.id;
    await save([...pics], [], true);
    draw();
    say("已開啟工程備份。");
  } catch {
    say("無法開啟：請選擇完整的 SiteSnap 工程備份。");
  } finally {
    lock(false);
  }
};
$("fresh").onclick = () => {
  if (!confirm("建立空白工程並取代目前草稿？請先備份需要保留的紀錄。")) return;
  book = fresh();
  pics.clear();
  selected = "";
  save([], [], true);
  draw();
};
function buildReport() {
  const missing = book.photos.find((p) => !p.review);
  if (!book.project.trim() || !book.date) {
    say("請填寫工程名稱及巡查日期。");
    (!book.project.trim() ? $("project") : $("date")).focus();
    return;
  }
  if (missing) {
    selected = missing.id;
    draw();
    say(
      "尚有 " +
        book.photos.filter((p) => !p.review).length +
        " 張相片待覆核，已選取第一張。",
    );
    return;
  }
  const pages = $("pages");
  pages.replaceChildren();
  for (const [i, p] of book.photos.entries()) {
    const section = el("article");
    section.className = "record";
    const im = el("img");
    im.src = pics.get(p.id);
    im.alt = p.name;
    const flag = el("span", "已覆核　／　" + p.review.by);
    flag.className = "flag";
    section.append(
      el(
        "small",
        "SITESNAP HK　 /　 FIELD REPORT　　" +
          String(i + 1).padStart(2, "0") +
          " / " +
          book.photos.length,
      ),
      el("h2", book.project + " · 工地巡查報告"),
      el(
        "p",
        [book.date, book.site, book.author].filter(Boolean).join("　｜　"),
      ),
      im,
      el("small", p.name),
      el("h3", "位置及類別"),
      el("p", (p.location || "未填寫位置") + "　／　" + p.category),
      el("h3", "現場觀察"),
      el("p", p.note),
      el("h3", "跟進措施"),
      el("p", p.action || "未有記錄"),
      flag,
      el(
        "small",
        "　" +
          new Date(p.review.at).toLocaleString("zh-HK", {
            timeZone: "Asia/Hong_Kong",
          }) +
          " HKT",
      ),
    );
    pages.append(section);
  }
  $("preview").showModal();
}
$("report").onclick = buildReport;
$("closepreview").onclick = () => $("preview").close();
$("print").onclick = async () => {
  await Promise.all(
    [...$("pages").querySelectorAll("img")].map((im) => im.decode()),
  );
  window.print();
};
window.addEventListener("beforeunload", (e) => {
  if (revision !== stored) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.querySelector("main").inert = true;
boot();
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol))
  navigator.serviceWorker.register("./sw.js").catch(() => {});
