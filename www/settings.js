// Settings view: save folder, version, open source libraries. Policy and About text live in index.html.
(function () {
  const $ = (id) => document.getElementById(id);
  const folderText = $("set-folder-text");
  const folderNote = $("set-folder-note");
  const folderBtn = $("set-folder-btn");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- save folder ----
  async function renderFolder() {
    const b = CodeFiles.getBackend();
    let state;
    try { state = await b.status(); } catch (e) { state = "needs-setup"; }

    folderBtn.hidden = true;
    folderBtn.onclick = null;
    const offer = (label, opts) => {
      folderBtn.textContent = label;
      folderBtn.hidden = false;
      folderBtn.onclick = async () => {
        try {
          await b.setup(opts); // straight from the click, so the browser treats it as a user gesture
          CodeFiles.toast("Using " + b.location);
          renderFolder();
        } catch (e) {
          if (e && e.name === "AbortError") return; // picker cancelled
          folderNote.textContent = "Couldn't use that folder: " + (e && e.message ? e.message : e);
        }
      };
    };

    if (b.kind === "download") {
      folderText.textContent = "This browser can't use a folder";
      folderNote.textContent = "Saved code downloads to your Downloads folder, and Open picks a file from your device. Use Chrome or Edge on a computer, or the Android app, to keep code in a LumenCalc folder.";
    } else if (b.kind === "native") {
      if (state === "ready") {
        folderText.textContent = b.location;
        folderNote.textContent = "Your saved code lives here. Android doesn't give LumenCalc a folder picker yet, so this location is fixed.";
      } else {
        folderText.textContent = "Not set up yet";
        folderNote.textContent = "LumenCalc creates a LumenCalc folder in Documents. It also does this the first time you save.";
        offer("Create folder now");
      }
    } else if (state === "ready") {
      folderText.textContent = b.location;
      folderNote.textContent = "Your saved code lives in this LumenCalc folder. Changing it doesn't move files you already saved.";
      offer("Change folder", { change: true });
    } else if (state === "needs-permission") {
      folderText.textContent = "Access needed";
      folderNote.textContent = "LumenCalc remembers your folder, but the browser needs your OK to use it again.";
      offer("Allow access");
    } else {
      folderText.textContent = "No folder chosen yet";
      folderNote.textContent = "Pick any folder. LumenCalc creates a folder named LumenCalc inside it and saves your code there.";
      offer("Choose folder", { change: true });
    }
  }

  // ---- version and libraries ----
  async function renderAbout() {
    const libs = $("set-libs");
    try {
      const about = await (await fetch("vendor/about.json")).json();
      $("set-version").textContent = about.version;
      libs.replaceChildren(
        el("p", "card-note", "LumenCalc is built with these open source libraries. Tap one to read its license."),
        ...about.libraries.map((l) => {
          const d = el("details", "lib");
          const s = el("summary");
          s.append(el("b", "", l.name), el("span", "lib-meta", l.version + " · " + l.license));
          d.append(s, el("p", "card-note", l.homepage), el("pre", "license", l.text));
          return d;
        })
      );
    } catch (e) {
      libs.replaceChildren(el("p", "card-note", "Library list unavailable. Run npm install to generate it."));
    }
  }

  document.addEventListener("viewchange", (e) => { if (e.detail === "settings") renderFolder(); });
  renderAbout();
})();
