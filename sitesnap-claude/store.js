"use strict";
/* SiteSnap 本機儲存：IndexedDB
   inspections: { id, project, site, date, author, order:[photoId], createdAt, updatedAt, exportedAt }
   photos:      { id, inspectionId, name, takenAt, location, category, priority, note, action, draft, review, image:Blob, thumb:Blob }
   相片以 Blob 保存（比 base64 細約三分之一），縮圖另存以加快列表。 */
const Store = (() => {
  const DB_NAME = "sitesnap-claude";
  let db = null;
  let pending = 0;

  function open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("inspections", { keyPath: "id" });
        const p = d.createObjectStore("photos", { keyPath: "id" });
        p.createIndex("byInspection", "inspectionId");
      };
      r.onsuccess = () => { db = r.result; ok(); };
      r.onerror = () => no(r.error);
      r.onblocked = () => no(new Error("blocked"));
    });
  }

  function tx(stores, mode, fn) {
    return new Promise((ok, no) => {
      if (!db) return no(new Error("no-db"));
      const t = db.transaction(stores, mode);
      let result;
      t.oncomplete = () => ok(result);
      t.onabort = t.onerror = () => no(t.error || new Error("tx"));
      result = fn(t);
    });
  }

  function req(r) {
    return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  }

  async function write(stores, fn) {
    pending++;
    try { return await tx(stores, "readwrite", fn); }
    finally { pending--; }
  }

  return {
    open,
    get ready() { return !!db; },
    get pending() { return pending; },
    async listInspections() {
      let out = [];
      await tx(["inspections"], "readonly", (t) => { req(t.objectStore("inspections").getAll()).then((v) => (out = v)); });
      return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
    },
    async photosOf(inspectionId) {
      let out = [];
      await tx(["photos"], "readonly", (t) => {
        req(t.objectStore("photos").index("byInspection").getAll(inspectionId)).then((v) => (out = v));
      });
      return out;
    },
    putInspection(insp) {
      return write(["inspections"], (t) => { t.objectStore("inspections").put(insp); });
    },
    putPhotos(photos, insp) {
      return write(["photos", "inspections"], (t) => {
        const s = t.objectStore("photos");
        for (const p of photos) s.put(p);
        if (insp) t.objectStore("inspections").put(insp);
      });
    },
    deletePhoto(id, insp) {
      return write(["photos", "inspections"], (t) => {
        t.objectStore("photos").delete(id);
        if (insp) t.objectStore("inspections").put(insp);
      });
    },
    async deleteInspection(id) {
      const photos = await this.photosOf(id);
      return write(["photos", "inspections"], (t) => {
        for (const p of photos) t.objectStore("photos").delete(p.id);
        t.objectStore("inspections").delete(id);
      });
    },
    async estimate() {
      try {
        const e = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        return { usage: e.usage || 0, quota: e.quota || 0, persisted };
      } catch { return null; }
    },
    async persist() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
      catch { return false; }
    },
  };
})();
