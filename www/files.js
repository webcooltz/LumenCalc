// Where LumenCalc keeps saved code. One interface, three backends:
//   folder   desktop Chrome/Edge: the user picks a folder, we create LumenCalc inside it (File System Access API)
//   native   Android app: Documents/LumenCalc through the Capacitor Filesystem plugin
//   download anything else: Save downloads a file, Open uses the file picker (no folder to list)
// No DOM here, so the backends are testable in Node with fakes.
(function (root) {
  const FOLDER = "LumenCalc";
  const CODE_FILE = /\.(js|mjs|txt)$/i;

  // File names the user types become real file names, so strip anything a file system rejects.
  function sanitizeName(raw) {
    let n = String(raw == null ? "" : raw)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "");
    if (!n) n = "untitled";
    if (!CODE_FILE.test(n)) n = n.slice(0, 76) + ".js";
    return n.slice(0, 80);
  }

  const byNewest = (a, b) => b.modified - a.modified || a.name.localeCompare(b.name);

  // ---- folder (File System Access API) ----
  // handleStore persists {dir, parentName} between sessions (IndexedDB can hold directory handles).
  function createFolderBackend({ pickDirectory, handleStore }) {
    let saved = null;
    const b = {
      kind: "folder",
      canChoose: true,
      location: "",

      async status() {
        try { saved = await handleStore.get(); } catch (e) { saved = null; }
        if (!saved || !saved.dir) return "needs-setup";
        const perm = await saved.dir.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") return "needs-permission";
        b.location = label(saved);
        return "ready";
      },

      // Needs a user gesture. `change` forces the folder picker even if a folder is already saved.
      async setup({ change } = {}) {
        if (saved && saved.dir && !change) {
          if ((await saved.dir.requestPermission({ mode: "readwrite" })) === "granted") {
            b.location = label(saved);
            return;
          }
        }
        const parent = await pickDirectory();
        // If they picked a folder that is already called LumenCalc, use it instead of nesting another.
        const dir = parent.name === FOLDER ? parent : await parent.getDirectoryHandle(FOLDER, { create: true });
        saved = { dir, parentName: parent.name === FOLDER ? "" : parent.name };
        await handleStore.set(saved);
        b.location = label(saved);
      },

      async list() {
        const out = [];
        for await (const [name, handle] of saved.dir.entries()) {
          if (handle.kind !== "file" || !CODE_FILE.test(name)) continue;
          const f = await handle.getFile();
          out.push({ name, modified: f.lastModified, size: f.size });
        }
        return out.sort(byNewest);
      },

      async read(name) {
        return (await (await saved.dir.getFileHandle(name)).getFile()).text();
      },

      async write(name, text) {
        const w = await (await saved.dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      },

      async exists(name) {
        try { await saved.dir.getFileHandle(name); return true; } catch (e) { return false; }
      },
    };
    const label = (s) => (s.parentName ? s.parentName + " / " : "") + s.dir.name;
    return b;
  }

  // ---- native (Capacitor Filesystem) ----
  // Tries public Documents first. If the OS refuses (scoped storage), falls back to the app's own storage.
  function createNativeBackend({ fs, store }) {
    const PLACES = { DOCUMENTS: "Documents", DATA: "App storage" };
    let directory = null;
    const path = (name) => FOLDER + (name ? "/" + name : "");
    const b = {
      kind: "native",
      canChoose: false,
      location: "",

      async status() {
        directory = store.get();
        if (!directory) return "needs-setup";
        b.location = PLACES[directory] + " / " + FOLDER;
        return "ready";
      },

      async setup() {
        try { await fs.requestPermissions(); } catch (e) { /* older plugin versions or already granted */ }
        for (const dir of ["DOCUMENTS", "DATA"]) {
          try {
            await fs.mkdir({ path: FOLDER, directory: dir, recursive: true });
          } catch (e) {
            if (!/exist/i.test(String(e && e.message))) continue; // "already exists" is fine
          }
          directory = dir;
          store.set(dir);
          b.location = PLACES[dir] + " / " + FOLDER;
          return;
        }
        throw new Error("Could not create the LumenCalc folder");
      },

      async list() {
        const r = await fs.readdir({ path: path(), directory });
        return r.files
          .filter((f) => (f.type || "file") === "file" && CODE_FILE.test(f.name))
          .map((f) => ({ name: f.name, modified: f.mtime || 0, size: f.size || 0 }))
          .sort(byNewest);
      },

      async read(name) {
        return (await fs.readFile({ path: path(name), directory, encoding: "utf8" })).data;
      },

      async write(name, text) {
        await fs.writeFile({ path: path(name), directory, data: text, encoding: "utf8", recursive: true });
      },

      async exists(name) {
        try { await fs.stat({ path: path(name), directory }); return true; } catch (e) { return false; }
      },
    };
    return b;
  }

  // ---- download (no folder access) ----
  function createDownloadBackend({ download }) {
    return {
      kind: "download",
      canChoose: false,
      location: "your Downloads",
      async status() { return "ready"; },
      async setup() {},
      list: null,
      read: null,
      async write(name, text) { download(name, text); },
      async exists() { return false; },
    };
  }

  // ---- real-browser wiring ----
  function idbHandleStore() {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open("lumencalc", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction("kv", mode);
        const req = fn(t.objectStore("kv"));
        t.oncomplete = () => res(req.result);
        t.onerror = () => rej(t.error);
      });
    };
    return { get: () => run("readonly", (s) => s.get("folder")), set: (v) => run("readwrite", (s) => s.put(v, "folder")) };
  }

  function downloadText(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function lsStore() {
    return {
      get: () => { try { return localStorage.getItem("calc.nativeDir"); } catch (e) { return null; } },
      set: (v) => { try { localStorage.setItem("calc.nativeDir", v); } catch (e) {} },
    };
  }

  function detect(win) {
    win = win || root;
    const cap = win.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      // The Android bridge lists its plugins under Capacitor.Plugins. It has no registerPlugin (that only
      // exists when the plugin's own JS is bundled), so only fall back to it if the plugin is missing.
      const fs = (cap.Plugins && cap.Plugins.Filesystem) || (cap.registerPlugin && cap.registerPlugin("Filesystem"));
      if (fs) return createNativeBackend({ fs, store: lsStore() });
    }
    if (typeof win.showDirectoryPicker === "function") {
      return createFolderBackend({
        pickDirectory: () => win.showDirectoryPicker({ id: "lumencalc", mode: "readwrite", startIn: "documents" }),
        handleStore: idbHandleStore(),
      });
    }
    return createDownloadBackend({ download: downloadText });
  }

  const api = { FOLDER, sanitizeName, createFolderBackend, createNativeBackend, createDownloadBackend, detect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Files = api;
})(typeof window !== "undefined" ? window : globalThis);
