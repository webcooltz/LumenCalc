// UI tests: load the real www/index.html and scripts into jsdom and drive the app like a user would.
// Covers the keypad, menu, converter, Code view, Save/Open and Settings on all three storage backends.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const { fakeDir, memStore, fakeNativeFs } = require("./test-fakes");

// www/vendor is generated (math.js and about.json with the version and licenses). Always refresh it so a stale
// copy from an earlier version can't make the tests pass or fail for the wrong reason.
require("./scripts/vendor.js");
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const INDEX = read("www", "index.html");
const SCRIPTS = [...INDEX.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const ABOUT = read("www", "vendor", "about.json");

const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(e));

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what = "condition") {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick(10);
  }
  throw new Error("Timed out waiting for " + what);
}

// ---- boot the app ----
// capacitor: a fake window.Capacitor (Android). Without it the app sees a plain browser.
// seed: localStorage entries to have in place before the app starts (like data saved in an earlier session).
async function boot({ capacitor, seed } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(INDEX, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  const downloads = [];
  const blobs = new Map();

  // jsdom gaps
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  w.Blob = class { constructor(parts) { this.parts = parts; } };
  let n = 0;
  w.URL.createObjectURL = (b) => { const u = "blob:fake-" + n++; blobs.set(u, b); return u; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, text: blobs.get(this.href).parts.join("") });
  };
  w.confirm = () => true;
  w.fetch = async () => ({ json: async () => JSON.parse(ABOUT) });
  w.Worker = class { // runs the editor's code in Node instead of a worker thread
    postMessage(code) {
      setTimeout(() => {
        const logs = [];
        let result, err;
        try { result = vm.runInNewContext(code, { console: { log: (...a) => logs.push(a.join(" ")) } }); } catch (e) { err = e; }
        logs.forEach((text) => this.onmessage({ data: { type: "log", text } }));
        if (err) this.onmessage({ data: { type: "error", text: err.name + ": " + err.message } });
        else if (result !== undefined) this.onmessage({ data: { type: "result", text: String(result) } });
        this.onmessage({ data: { type: "done" } });
      }, 0);
    }
    terminate() {}
  };
  if (capacitor) w.Capacitor = capacitor;
  for (const [k, v] of Object.entries(seed || {})) w.localStorage.setItem(k, v);

  const ctx = dom.getInternalVMContext();
  for (const src of SCRIPTS) new vm.Script(read("www", src), { filename: src }).runInContext(ctx);
  await tick();

  const $ = (id) => w.document.getElementById(id);
  const app = {
    w, $, errors, downloads,
    close: () => w.close(),
    press: (label) => { // a keypad or chip button by its label
      const b = [...w.document.querySelectorAll("#keys button, #chips button")].find((x) => x.textContent.trim() === label);
      assert.ok(b, "no button labelled " + label);
      b.click();
    },
    type: (text) => { $("expr").value = text; $("expr").dispatchEvent(new w.Event("input", { bubbles: true })); },
    go: async (view) => { $("menu-btn").click(); w.document.querySelector(`[data-view=${view}]`).click(); await tick(); },
    sheetTitle: () => ($("sheet").open ? $("sheet").querySelector("h3").textContent : null),
    sheetButton: (cls = "primary") => $("sheet").querySelector("button." + cls),
    history: () => [...w.document.querySelectorAll(".entry-row")].map((r) => [r.querySelector(".expr").textContent, r.querySelector(".res").textContent]),
  };
  return app;
}

// Mirrors the bridge Android really injects (checked on an emulator): plugins live under Capacitor.Plugins and
// there is NO registerPlugin. An earlier version of this mock invented registerPlugin and hid a crash.
const nativeCapacitor = (fsMock) => ({ isNativePlatform: () => true, Plugins: { Filesystem: fsMock } });

// ---- tiny test runner ----
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// =========================== Calculator ===========================
test("keypad layout: backspace top-right, operators down the right, no = key", async () => {
  const a = await boot();
  const labels = [...a.w.document.querySelectorAll("#keys button")].map((b) => b.textContent.trim());
  assert.deepStrictEqual(labels, ["AC", "(", ")", "⌫", "7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "%", "0", ".", "+"]);
  assert.strictEqual(a.w.document.querySelector("[data-action=equals]"), null);
  a.close();
});

test("typing shows a live result and tapping it saves to history", async () => {
  const a = await boot();
  ["1", "2", "×", "5"].forEach(a.press);
  assert.strictEqual(a.$("expr").value, "12*5");
  assert.ok(a.$("preview").textContent.startsWith("= 60"), a.$("preview").textContent);
  a.$("preview").click();
  assert.deepStrictEqual(a.history(), [["12*5", "= 60"]]);
  assert.strictEqual(a.$("expr").value, "");
  assert.strictEqual(a.$("preview").textContent, "");
  a.close();
});

test("Enter saves too, and tapping an empty preview does nothing", async () => {
  const a = await boot();
  a.$("preview").click();
  assert.strictEqual(a.history().length, 0);
  a.type("2+2");
  a.$("expr").dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepStrictEqual(a.history(), [["2+2", "= 4"]]);
  a.close();
});

test("backspace removes the character before the caret", async () => {
  const a = await boot();
  ["1", "2", "3"].forEach(a.press);
  a.press("⌫");
  assert.strictEqual(a.$("expr").value, "12");
  a.close();
});

test("x² chip appends ^2", async () => {
  const a = await boot();
  ["1", "2"].forEach(a.press);
  a.press("x²");
  assert.strictEqual(a.$("expr").value, "12^2");
  assert.ok(a.$("preview").textContent.startsWith("= 144"));
  a.close();
});

test("results show thousands separators but tapping inserts the plain number", async () => {
  const a = await boot();
  a.type("100*100*12");
  a.$("preview").click();
  assert.deepStrictEqual(a.history(), [["100*100*12", "= 120,000"]]);
  a.w.document.querySelector(".entry-row .res").click();
  assert.strictEqual(a.$("expr").value, "120000");
  a.close();
});

test("an operator on an empty line continues from ans", async () => {
  const a = await boot();
  a.type("12*5");
  a.$("preview").click();
  a.press("+");
  assert.strictEqual(a.$("expr").value, "ans+");
  a.press("5");
  assert.ok(a.$("preview").textContent.startsWith("= 65"), a.$("preview").textContent);
  a.close();
});

test("caret arrows are gone; only the keyboard button remains in that row", async () => {
  const a = await boot();
  const labels = [...a.w.document.querySelectorAll(".caret-row button")].map((b) => b.textContent.trim());
  assert.deepStrictEqual(labels, ["⌨"]);
  assert.strictEqual(a.w.document.querySelector("[data-action=left]"), null);
  assert.strictEqual(a.w.document.querySelector("[data-action=right]"), null);
  a.close();
});

test("keyboard button opens the system keyboard once; using the keypad never re-opens it", async () => {
  const a = await boot();
  const mode = () => a.$("expr").getAttribute("inputmode");
  assert.strictEqual(mode(), "none"); // the on-screen keypad is the default, so no system keyboard
  a.$("kbd").click();
  assert.strictEqual(mode(), "text"); // keyboard requested
  assert.strictEqual(a.w.document.activeElement, a.$("expr"));
  a.$("kbd").click(); // tapping it again is not a toggle that turns it off for good...
  assert.strictEqual(mode(), "text");
  a.press("7"); // ...but using the keypad hands control back and the keyboard stays away
  assert.strictEqual(mode(), "none");
  a.press("8");
  a.press("9");
  assert.strictEqual(mode(), "none");
  assert.strictEqual(a.$("expr").value, "789");
  a.$("kbd").click(); // and it can be requested again whenever the user wants
  assert.strictEqual(mode(), "text");
  a.close();
});

test("leaving the input (keyboard dismissed) resets it so the keyboard doesn't come back", async () => {
  const a = await boot();
  a.$("kbd").click();
  assert.strictEqual(a.$("expr").getAttribute("inputmode"), "text");
  a.$("expr").blur();
  assert.strictEqual(a.$("expr").getAttribute("inputmode"), "none");
  a.close();
});

test("dismissing the keyboard (page grows back to full height) resets the input right away", async () => {
  const a = await boot();
  const mode = () => a.$("expr").getAttribute("inputmode");
  const resize = (h) => { a.w.innerHeight = h; a.w.dispatchEvent(new a.w.Event("resize")); };
  a.$("kbd").click();
  resize(500);                       // keyboard opens: the page shrinks
  assert.strictEqual(mode(), "text");
  assert.strictEqual(a.w.document.activeElement, a.$("expr"));
  resize(800);                       // keyboard dismissed: the page grows back, field still focused
  assert.strictEqual(mode(), "none");
  a.close();
});

test("percent key", async () => {
  const a = await boot();
  ["5", "0", "%"].forEach(a.press);
  assert.strictEqual(a.$("expr").value, "50%");
  assert.ok(a.$("preview").textContent.startsWith("= 0.5"));
  a.close();
});

test("variables and functions defined by saving are remembered", async () => {
  const a = await boot();
  a.type("x = 7"); a.$("preview").click();
  a.type("f(t) = t^2 + 1"); a.$("preview").click();
  a.type("f(x)");
  assert.ok(a.$("preview").textContent.startsWith("= 50"), a.$("preview").textContent);
  a.close();
});

test("errors show in red and nothing is saved", async () => {
  const a = await boot();
  a.type("2+*");
  a.$("expr").dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.ok(a.$("preview").classList.contains("error"));
  assert.strictEqual(a.history().length, 0);
  a.close();
});

test("AC clears the input first, then the history", async () => {
  const a = await boot();
  a.type("1+1"); a.$("preview").click();
  a.type("9");
  a.press("AC");
  assert.strictEqual(a.$("expr").value, "");
  assert.strictEqual(a.history().length, 1);
  a.press("AC");
  assert.strictEqual(a.history().length, 0);
  a.close();
});

test("RAD/DEG toggle changes trig results", async () => {
  const a = await boot();
  a.type("sin(90)");
  const rad = a.$("preview").textContent;
  a.$("angle").click();
  assert.strictEqual(a.$("angle").textContent, "DEG");
  assert.ok(a.$("preview").textContent.startsWith("= 1"), a.$("preview").textContent);
  assert.notStrictEqual(rad, a.$("preview").textContent);
  a.close();
});

// =========================== Menu ===========================
test("menu opens, switches views and closes", async () => {
  const a = await boot();
  assert.ok(a.$("drawer").hidden);
  a.$("menu-btn").click();
  assert.ok(!a.$("drawer").hidden);
  a.w.document.querySelector("[data-view=convert]").click();
  assert.ok(a.$("drawer").hidden);
  assert.strictEqual(a.$("title").textContent, "Unit Converter");
  assert.ok(a.$("view-calc").hidden && !a.$("view-convert").hidden);
  for (const [view, title] of [["code", "Code"], ["settings", "Settings"], ["calc", "Calculator"]]) {
    await a.go(view);
    assert.strictEqual(a.$("title").textContent, title);
  }
  a.close();
});

test("Escape and the backdrop close the menu", async () => {
  const a = await boot();
  a.$("menu-btn").click();
  a.w.document.dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(a.$("drawer").hidden);
  a.$("menu-btn").click();
  a.w.document.querySelector(".backdrop").click();
  assert.ok(a.$("drawer").hidden);
  a.close();
});

// =========================== Converter ===========================
test("converter starts at 1 lb to kg", async () => {
  const a = await boot();
  assert.strictEqual(a.$("conv-from").value, "lb");
  assert.strictEqual(a.$("conv-to").value, "kg");
  assert.strictEqual(a.$("conv-result").textContent, "0.45359237");
  a.close();
});

test("converter only offers compatible units and picks a usual target", async () => {
  const a = await boot();
  a.$("conv-from").value = "mi";
  a.$("conv-from").dispatchEvent(new a.w.Event("change"));
  const ids = [...a.$("conv-to").options].map((o) => o.value);
  assert.ok(ids.includes("km") && !ids.includes("kg") && !ids.includes("mi"));
  assert.strictEqual(a.$("conv-to").value, "km");
  a.close();
});

test("converter result is grouped, accepts expressions, and flags bad input", async () => {
  const a = await boot();
  a.$("conv-from").value = "mi"; a.$("conv-from").dispatchEvent(new a.w.Event("change"));
  a.$("conv-to").value = "mm"; a.$("conv-to").dispatchEvent(new a.w.Event("change"));
  a.$("conv-value").value = "26.2"; a.$("conv-value").dispatchEvent(new a.w.Event("input"));
  assert.strictEqual(a.$("conv-result").textContent, "42,164,812.8");
  a.$("conv-value").value = "1/2"; a.$("conv-value").dispatchEvent(new a.w.Event("input"));
  assert.strictEqual(a.$("conv-result").textContent, "804,672");
  a.$("conv-value").value = "abc"; a.$("conv-value").dispatchEvent(new a.w.Event("input"));
  assert.ok(a.$("conv-value").classList.contains("bad"));
  assert.strictEqual(a.$("conv-result").textContent, "—");
  a.close();
});

test("swap and sign buttons", async () => {
  const a = await boot();
  a.$("conv-swap").click();
  assert.strictEqual(a.$("conv-from").value, "kg");
  assert.strictEqual(a.$("conv-to").value, "lb");
  a.$("conv-sign").click();
  assert.strictEqual(a.$("conv-value").value, "-1");
  a.close();
});

// ---- favorites ----
const favChips = (a) => [...a.w.document.querySelectorAll("#conv-favs button.fav")].map((b) => b.textContent);
const pick = (a, id, from, to) => {
  a.$("conv-from").value = from; a.$("conv-from").dispatchEvent(new a.w.Event("change"));
  if (to) { a.$("conv-to").value = to; a.$("conv-to").dispatchEvent(new a.w.Event("change")); }
};

test("favorites: empty state explains the star; star starts outlined", async () => {
  const a = await boot();
  assert.strictEqual(favChips(a).length, 0);
  assert.ok(a.$("conv-favs").textContent.includes("☆"));
  assert.strictEqual(a.$("conv-star").textContent, "☆");
  assert.strictEqual(a.$("conv-star").getAttribute("aria-pressed"), "false");
  a.close();
});

test("favorites: the star saves the current conversion to the top list and unsaves it", async () => {
  const a = await boot();
  a.$("conv-star").click();
  assert.deepStrictEqual(favChips(a), ["lb → kg"]);
  assert.strictEqual(a.$("conv-star").textContent, "★");
  assert.strictEqual(a.$("conv-star").getAttribute("aria-pressed"), "true");
  assert.strictEqual(a.w.document.querySelector("#conv-favs button.fav").title, "Pounds to Kilograms");
  assert.ok(a.w.document.querySelector("#conv-favs button.fav").classList.contains("current"));
  a.$("conv-star").click(); // tapping the filled star removes it
  assert.deepStrictEqual(favChips(a), []);
  assert.strictEqual(a.$("conv-star").textContent, "☆");
  a.close();
});

test("favorites: several pairs, newest first, no duplicates; star follows the selected pair", async () => {
  const a = await boot();
  a.$("conv-star").click();                       // lb -> kg
  pick(a, "x", "mi", "km");
  assert.strictEqual(a.$("conv-star").textContent, "☆"); // a different pair is not a favorite yet
  a.$("conv-star").click();                       // mi -> km
  pick(a, "x", "degF", "degC");
  a.$("conv-star").click();                       // °F -> °C
  assert.deepStrictEqual(favChips(a), ["°F → °C", "mi → km", "lb → kg"]);
  pick(a, "x", "lb", "kg");
  assert.strictEqual(a.$("conv-star").textContent, "★");
  assert.deepStrictEqual(favChips(a).length, 3);  // selecting a favorite doesn't add a copy
  a.close();
});

test("favorites: tapping a chip jumps to that conversion and keeps the typed value", async () => {
  const a = await boot();
  a.$("conv-value").value = "150"; a.$("conv-value").dispatchEvent(new a.w.Event("input"));
  a.$("conv-star").click();                       // 150 lb -> kg saved
  pick(a, "x", "mi", "km");
  a.$("conv-value").value = "26.2"; a.$("conv-value").dispatchEvent(new a.w.Event("input"));
  assert.strictEqual(a.$("conv-result").textContent, "42.1648128");
  a.w.document.querySelector("#conv-favs button.fav").click();
  assert.strictEqual(a.$("conv-from").value, "lb");
  assert.strictEqual(a.$("conv-to").value, "kg");
  assert.strictEqual(a.$("conv-value").value, "26.2");
  assert.strictEqual(a.$("conv-result").textContent, "11.88412009"); // 26.2 lb in kg
  a.close();
});

test("favorites are remembered between sessions and bad saved data is ignored", async () => {
  const a = await boot();
  a.$("conv-star").click();
  const saved = a.w.localStorage.getItem("calc.convFavs");
  assert.deepStrictEqual(JSON.parse(saved), [{ from: "lb", to: "kg" }]);
  a.close();

  const b = await boot({ seed: { "calc.convFavs": JSON.stringify([{ from: "mi", to: "km" }, { from: "lb", to: "m" }, { from: "zzz", to: "kg" }, null, "x"]) } });
  assert.deepStrictEqual(favChips(b), ["mi → km"]); // incompatible, unknown and malformed entries dropped
  b.close();

  const c = await boot({ seed: { "calc.convFavs": "not json" } });
  assert.deepStrictEqual(favChips(c), []);
  c.close();
});

// =========================== Code view ===========================
test("Code: Run prints output and the result of the last expression", async () => {
  const a = await boot();
  await a.go("code");
  a.$("code-editor").value = 'console.log("hi", 1 + 1); 6 * 7';
  a.$("code-run").click();
  await waitFor(() => a.$("code-run").textContent === "Run", "run to finish");
  const lines = [...a.$("code-out").children].map((d) => d.textContent);
  assert.deepStrictEqual(lines, ["hi 2", "→ 42"]);
  a.close();
});

test("Code: errors print in red", async () => {
  const a = await boot();
  await a.go("code");
  a.$("code-editor").value = "nope.x";
  a.$("code-run").click();
  await waitFor(() => a.$("code-out").children.length > 0, "error output");
  assert.ok(a.$("code-out").querySelector(".error").textContent.includes("ReferenceError"));
  a.close();
});

test("Code: examples load, symbol keys insert pairs with the caret between", async () => {
  const a = await boot();
  await a.go("code");
  a.$("code-examples").value = "1";
  a.$("code-examples").dispatchEvent(new a.w.Event("change"));
  assert.ok(a.$("code-editor").value.includes("FizzBuzz"));
  assert.ok(a.$("file-name").textContent.includes("untitled"));
  a.$("code-editor").value = "";
  a.w.document.querySelector('[data-code="{}"]').click();
  assert.strictEqual(a.$("code-editor").value, "{}");
  assert.strictEqual(a.$("code-editor").selectionStart, 1);
  a.close();
});

// =========================== Save / Open ===========================
async function fillSaveName(a, name) {
  await waitFor(() => a.sheetTitle() === "Save as", "Save as sheet");
  a.$("sheet").querySelector("input").value = name;
  a.sheetButton().click();
}

test("Save (download browser): asks for a name, downloads the file, clears the unsaved dot", async () => {
  const a = await boot();
  await a.go("code");
  a.$("code-editor").value = "console.log(1)";
  a.$("code-editor").dispatchEvent(new a.w.Event("input"));
  assert.ok(a.$("file-name").textContent.startsWith("●"));
  a.$("file-save").click();
  await fillSaveName(a, "my code");
  await waitFor(() => a.downloads.length === 1, "download");
  assert.deepStrictEqual(a.downloads[0], { name: "my code.js", text: "console.log(1)" });
  assert.strictEqual(a.$("file-name").textContent, "my code.js");
  assert.strictEqual(a.sheetTitle(), null);
  a.close();
});

test("Save again reuses the name; Save as asks again", async () => {
  const a = await boot();
  await a.go("code");
  a.$("file-save").click();
  await fillSaveName(a, "a");
  await waitFor(() => a.downloads.length === 1);
  a.$("file-save").click();
  await waitFor(() => a.downloads.length === 2, "second download");
  assert.strictEqual(a.downloads[1].name, "a.js");
  a.$("file-saveas").click();
  await waitFor(() => a.sheetTitle() === "Save as");
  assert.strictEqual(a.$("sheet").querySelector("input").value, "a.js");
  a.close();
});

test("Save (Android): sets up Documents/LumenCalc, then saves there", async () => {
  const mock = fakeNativeFs();
  const a = await boot({ capacitor: nativeCapacitor(mock) });
  await a.go("code");
  a.$("code-editor").value = "1+1";
  a.$("file-save").click();
  await waitFor(() => a.sheetTitle() !== null, "a sheet to appear after tapping Save");
  assert.ok(a.sheetTitle().startsWith("Where should LumenCalc keep"), a.sheetTitle());
  assert.strictEqual(a.sheetButton().textContent, "Create folder");
  a.sheetButton().click();
  await fillSaveName(a, "sum");
  await waitFor(() => mock.disk.size === 1, "file written");
  assert.deepStrictEqual(mock.calls, ["requestPermissions", "mkdir DOCUMENTS LumenCalc", "writeFile DOCUMENTS LumenCalc/sum.js"]);
  assert.strictEqual(mock.disk.get("DOCUMENTS:LumenCalc/sum.js").text, "1+1");
  assert.strictEqual(a.$("file-name").textContent, "sum.js");
  assert.ok(a.$("toast").textContent.includes("Documents / LumenCalc"), a.$("toast").textContent);
  a.close();
});

test("Save as (Android): works on a second tap without setup", async () => {
  const mock = fakeNativeFs();
  const a = await boot({ capacitor: nativeCapacitor(mock) });
  await a.go("code");
  a.$("file-saveas").click();
  await waitFor(() => a.sheetTitle() !== null, "a sheet to appear after tapping Save as");
  a.sheetButton().click();
  await fillSaveName(a, "one");
  await waitFor(() => mock.disk.size === 1);
  a.$("file-saveas").click();
  await fillSaveName(a, "two");
  await waitFor(() => mock.disk.size === 2, "second file");
  assert.deepStrictEqual([...mock.disk.keys()].sort(), ["DOCUMENTS:LumenCalc/one.js", "DOCUMENTS:LumenCalc/two.js"]);
  a.close();
});

test("Save (Android): falls back to app storage when Documents is refused", async () => {
  const mock = fakeNativeFs({ failDocuments: true });
  const a = await boot({ capacitor: nativeCapacitor(mock) });
  await a.go("code");
  a.$("file-save").click();
  await waitFor(() => a.sheetTitle() !== null);
  a.sheetButton().click();
  await fillSaveName(a, "x");
  await waitFor(() => mock.disk.size === 1);
  assert.ok(mock.disk.has("DATA:LumenCalc/x.js"));
  assert.ok(a.$("toast").textContent.includes("App storage"));
  a.close();
});

test("Save and Open say so when saving can't be set up, instead of doing nothing", async () => {
  const a = await boot();
  a.w.Files.detect = () => { throw new Error("boom"); };
  await a.go("code");
  a.$("file-save").click();
  await waitFor(() => !a.$("toast").hidden, "a message after tapping Save");
  assert.ok(a.$("toast").textContent.includes("boom"), a.$("toast").textContent);
  a.$("toast").hidden = true;
  a.$("file-open").click();
  await waitFor(() => !a.$("toast").hidden, "a message after tapping Open");
  assert.ok(a.$("toast").textContent.includes("boom"));
  a.close();
});

test("Native app without the Filesystem plugin falls back to downloads", async () => {
  const a = await boot({ capacitor: { isNativePlatform: () => true, Plugins: {} } });
  await a.go("code");
  a.$("file-save").click();
  await fillSaveName(a, "fallback");
  await waitFor(() => a.downloads.length === 1, "download");
  assert.strictEqual(a.downloads[0].name, "fallback.js");
  a.close();
});

test("Open (Android): lists saved files newest first and loads one", async () => {
  const mock = fakeNativeFs();
  mock.disk.set("DOCUMENTS:LumenCalc/old.js", { text: "// old", modified: 1 });
  mock.disk.set("DOCUMENTS:LumenCalc/new.js", { text: "// new", modified: 2 });
  mock.disk.set("DOCUMENTS:LumenCalc/pic.png", { text: "x", modified: 3 });
  const a = await boot({ capacitor: nativeCapacitor(mock) });
  a.w.localStorage.setItem("calc.nativeDir", "DOCUMENTS"); // folder was set up in an earlier session
  await a.go("code");
  a.$("file-open").click();
  await waitFor(() => a.sheetTitle() === "Open", "Open sheet");
  const names = [...a.w.document.querySelectorAll(".file-item .fi-name")].map((e) => e.textContent);
  assert.deepStrictEqual(names, ["new.js", "old.js"]);
  a.w.document.querySelector(".file-item").click();
  await waitFor(() => a.$("code-editor").value === "// new", "file loaded");
  assert.strictEqual(a.$("file-name").textContent, "new.js");
  a.close();
});

test("Save / Open (desktop folder): choose a folder, save into LumenCalc, list and load", async () => {
  const docs = fakeDir("Documents");
  const a = await boot();
  a.w.Files.detect = () => a.w.Files.createFolderBackend({ pickDirectory: async () => docs, handleStore: memStore() });
  await a.go("code");
  a.$("code-editor").value = "// hello";
  a.$("file-save").click();
  await waitFor(() => a.sheetTitle() !== null, "setup sheet");
  assert.strictEqual(a.sheetButton().textContent, "Choose folder");
  a.sheetButton().click();
  await fillSaveName(a, "hello");
  await waitFor(() => docs.kids.get("LumenCalc") && docs.kids.get("LumenCalc").kids.has("hello.js"), "file in LumenCalc");
  a.$("code-editor").value = "";
  a.$("file-open").click();
  await waitFor(() => a.sheetTitle() === "Open");
  a.w.document.querySelector(".file-item").click();
  await waitFor(() => a.$("code-editor").value === "// hello", "file loaded");
  a.close();
});

// =========================== Settings ===========================
async function openSettings(a) {
  await a.go("settings");
  await waitFor(() => a.$("set-folder-text").textContent !== "Checking…", "Settings to stop saying Checking…");
}

test("Settings (Android): not set up, then Create folder shows the location", async () => {
  const mock = fakeNativeFs();
  const a = await boot({ capacitor: nativeCapacitor(mock) });
  await openSettings(a);
  assert.strictEqual(a.$("set-folder-text").textContent, "Not set up yet");
  assert.strictEqual(a.$("set-folder-btn").textContent, "Create folder now");
  a.$("set-folder-btn").click();
  await waitFor(() => a.$("set-folder-text").textContent === "Documents / LumenCalc", "location");
  assert.ok(a.$("set-folder-btn").hidden);
  a.close();
});

test("Settings (Android): shows the saved location when already set up", async () => {
  const a = await boot({ capacitor: nativeCapacitor(fakeNativeFs()) });
  a.w.localStorage.setItem("calc.nativeDir", "DATA");
  await openSettings(a);
  assert.strictEqual(a.$("set-folder-text").textContent, "App storage / LumenCalc");
  a.close();
});

test("Settings (download browser): explains there is no folder", async () => {
  const a = await boot();
  await openSettings(a);
  assert.strictEqual(a.$("set-folder-text").textContent, "This browser can't use a folder");
  assert.ok(a.$("set-folder-btn").hidden);
  a.close();
});

test("Settings (desktop folder): choose, then change folder", async () => {
  const docs = fakeDir("Documents");
  const projects = fakeDir("Projects");
  let next = docs;
  const a = await boot();
  a.w.Files.detect = () => a.w.Files.createFolderBackend({ pickDirectory: async () => next, handleStore: memStore() });
  await openSettings(a);
  assert.strictEqual(a.$("set-folder-text").textContent, "No folder chosen yet");
  a.$("set-folder-btn").click();
  await waitFor(() => a.$("set-folder-text").textContent === "Documents / LumenCalc");
  assert.strictEqual(a.$("set-folder-btn").textContent, "Change folder");
  next = projects;
  a.$("set-folder-btn").click();
  await waitFor(() => a.$("set-folder-text").textContent === "Projects / LumenCalc", "new location");
  a.close();
});

test("Settings never stays on Checking… when saving can't be set up", async () => {
  const a = await boot();
  a.w.Files.detect = () => { throw new Error("boom"); };
  await openSettings(a);
  assert.strictEqual(a.$("set-folder-text").textContent, "Saving isn't available");
  assert.ok(a.$("set-folder-note").textContent.includes("boom"));
  a.close();
});

test("Settings: version, privacy policy and open source libraries", async () => {
  const a = await boot();
  await openSettings(a);
  const pkg = JSON.parse(read("package.json"));
  await waitFor(() => a.$("set-version").textContent === pkg.version, "version from about.json");
  assert.ok(a.w.document.querySelector("details.card summary").textContent.length > 0);
  await waitFor(() => a.w.document.querySelectorAll("#set-libs details.lib").length >= 4, "library list");
  const libs = [...a.w.document.querySelectorAll("#set-libs details.lib summary")].map((s) => s.textContent);
  assert.ok(libs.some((l) => l.startsWith("mathjs") && l.includes("Apache-2.0")), libs.join(" | "));
  a.close();
});

// =========================== run ===========================
(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    unhandled.length = 0;
    try {
      await fn();
      await tick(5);
      if (unhandled.length) throw new Error("unhandled promise rejection: " + (unhandled[0] && unhandled[0].stack || unhandled[0]));
      console.log("  ok   " + name);
    } catch (e) {
      failed++;
      console.log("  FAIL " + name + "\n       " + String(e && e.message ? e.message : e).split("\n")[0]);
    }
  }
  console.log(failed ? `${failed} of ${tests.length} UI tests failed` : `ui tests passed (${tests.length})`);
  process.exit(failed ? 1 : 0);
})();
