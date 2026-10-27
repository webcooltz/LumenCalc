// Open / Save UI for the Code view. Storage itself lives in files.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const editor = $("code-editor");
  const nameEl = $("file-name");
  const sheet = $("sheet");
  const toastEl = $("toast");
  const fileInput = $("file-input");

  let backend = null;        // chosen on first use so a picker added later (or mocked in tests) is noticed
  let current = null;        // file name the editor is tied to, or null for "untitled"
  let dirty = false;

  const getBackend = () => backend || (backend = Files.detect());

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function remember() {
    store("codefile", JSON.stringify({ name: current, dirty }));
  }

  function renderName() {
    nameEl.textContent = (dirty ? "● " : "") + (current || "untitled");
    remember();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  // ---- sheet (bottom dialog) ----
  function showSheet(title, build) {
    sheet.replaceChildren(el("h3", "", title));
    const body = el("div", "sheet-body");
    sheet.append(body);
    build(body);
    if (!sheet.open) sheet.showModal();
  }
  const closeSheet = () => { if (sheet.open) sheet.close(); };
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  function button(label, cls, onClick) {
    const b = el("button", cls, label);
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- make sure there is a folder to work in, then run `action` ----
  async function withFolder(action) {
    const b = getBackend();
    let state;
    try { state = await b.status(); } catch (e) { state = "needs-setup"; }
    if (state === "ready") return action();
    showSetup(b, state, action);
  }

  function showSetup(b, state, action) {
    showSheet("Where should LumenCalc keep your code?", (body) => {
      const msg = el("p", "sheet-text");
      const err = el("p", "sheet-error");
      let primary;
      if (b.kind === "native") {
        msg.textContent = "LumenCalc will create a folder called LumenCalc in your Documents and save your code there.";
        primary = "Create folder";
      } else if (state === "needs-permission") {
        msg.textContent = "Your LumenCalc folder is saved, but the browser needs your OK to use it again.";
        primary = "Allow access";
      } else {
        msg.textContent = "Pick any folder. LumenCalc creates a folder named LumenCalc inside it and saves your code there.";
        primary = "Choose folder";
      }

      const run = (opts) => async () => {
        err.textContent = "";
        try {
          await b.setup(opts); // first call in the click handler, so it counts as a user gesture
          closeSheet();
          toast("Using " + b.location);
          action();
        } catch (e) {
          if (e && e.name === "AbortError") return; // they cancelled the picker
          err.textContent = "Couldn't use that folder: " + (e && e.message ? e.message : e);
        }
      };

      body.append(msg, button(primary, "primary", run()));
      if (state === "needs-permission" && b.canChoose) body.append(button("Use a different folder", "plain", run({ change: true })));
      body.append(err);
    });
  }

  // ---- Save ----
  function save(forceAsk) {
    withFolder(() => {
      if (current && !forceAsk) doSave(current);
      else askName();
    });
  }

  function askName() {
    const b = getBackend();
    showSheet("Save as", (body) => {
      const input = el("input", "sheet-input");
      input.type = "text";
      input.value = current || "untitled.js";
      input.setAttribute("aria-label", "File name");
      input.autocomplete = "off";
      input.spellcheck = false;
      const err = el("p", "sheet-error");
      const where = el("p", "sheet-text", b.kind === "download" ? "It will download to your Downloads." : "Saved in " + b.location);

      const go = async () => {
        const name = Files.sanitizeName(input.value);
        if (name !== current && (await b.exists(name)) && !confirm("Replace " + name + "?")) return;
        doSave(name, err);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      body.append(input, where, button("Save", "primary", go), err);
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  async function doSave(name, errEl) {
    const b = getBackend();
    try {
      await b.write(name, editor.value);
      current = name;
      dirty = false;
      renderName();
      closeSheet();
      toast(b.kind === "download" ? "Downloaded " + name : "Saved " + name + " to " + b.location);
    } catch (e) {
      const msg = "Couldn't save: " + (e && e.message ? e.message : e);
      if (errEl) errEl.textContent = msg;
      else toast(msg);
    }
  }

  // ---- Open ----
  const discardOk = () => !dirty || confirm("Discard unsaved changes?");

  function open() {
    const b = getBackend();
    if (!b.list) { pickOther(); return; } // download backend has no folder to show
    withFolder(openSheet);
  }

  async function openSheet() {
    const b = getBackend();
    let files = [], error = "";
    try { files = await b.list(); } catch (e) { error = "Couldn't read the folder: " + (e && e.message ? e.message : e); }

    showSheet("Open", (body) => {
      body.append(el("p", "sheet-text", "Saved in " + b.location));
      if (error) body.append(el("p", "sheet-error", error));
      else if (!files.length) body.append(el("p", "sheet-text", "Nothing saved yet. Use Save and your code shows up here."));
      else {
        const list = el("div", "file-list");
        files.forEach((f) => {
          const row = el("button", "file-item" + (f.name === current ? " current" : ""));
          row.append(el("span", "fi-name", f.name), el("span", "fi-date", formatDate(f.modified)));
          row.addEventListener("click", () => loadFromFolder(f.name));
          list.append(row);
        });
        body.append(list);
      }
      body.append(button("Browse for another file…", "plain", pickOther));
      if (b.canChoose) {
        body.append(button("Change folder", "plain", async () => {
          try { await b.setup({ change: true }); toast("Using " + b.location); openSheet(); }
          catch (e) { if (!e || e.name !== "AbortError") toast("Couldn't use that folder"); }
        }));
      }
    });
  }

  function formatDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function loadFromFolder(name) {
    if (!discardOk()) return;
    try {
      setEditor(await getBackend().read(name), name);
    } catch (e) {
      toast("Couldn't open " + name + ": " + (e && e.message ? e.message : e));
    }
  }

  function pickOther() {
    fileInput.click();
  }

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    fileInput.value = "";
    if (!f || !discardOk()) return;
    setEditor(await f.text(), Files.sanitizeName(f.name));
  });

  function setEditor(text, name) {
    editor.value = text;
    store("code", text);
    current = name;
    dirty = false;
    renderName();
    closeSheet();
    toast("Opened " + name);
  }

  // ---- wiring ----
  $("file-open").addEventListener("click", open);
  $("file-save").addEventListener("click", () => save(false));
  $("file-saveas").addEventListener("click", () => save(true));

  editor.addEventListener("input", () => { dirty = true; renderName(); });
  editor.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); }
  });
  // Loading an example makes the editor an unsaved new file.
  $("code-examples").addEventListener("change", () => { current = null; dirty = true; renderName(); });

  // Settings shares this backend so both screens always agree on the folder.
  window.CodeFiles = { getBackend, toast };

  try {
    const s = JSON.parse(store("codefile") || "null");
    if (s) { current = s.name; dirty = !!s.dirty; }
  } catch (e) {}
  renderName();
})();
