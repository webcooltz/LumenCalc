// Release hygiene: mistakes that don't break the logic but ship a broken or inconsistent build.
// Each check exists because it happened (or nearly did) on this project.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
let failed = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + String(e.message).split("\n")[0]); }
}

const pkg = JSON.parse(read("package.json"));

// ---- one version number everywhere ----
check("version is the same in package.json, lockfile, Android build, About fallback and README", () => {
  const v = pkg.version;
  assert.match(v, /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(read("package-lock.json"));
  assert.strictEqual(lock.version, v, "package-lock.json version");
  assert.strictEqual(lock.packages[""].version, v, "package-lock.json root package version");
  assert.strictEqual(read("android", "app", "build.gradle").match(/versionName "([^"]+)"/)[1], v, "android versionName");
  assert.strictEqual(read("www", "index.html").match(/id="set-version">([^<]+)</)[1], v, "About fallback in index.html");
  assert.strictEqual(read("README.md").match(/\*\*Version ([\d.]+)\.\*\*/)[1], v, "README version line");
});

check("Android versionCode is a positive integer", () => {
  const code = Number(read("android", "app", "build.gradle").match(/versionCode (\d+)/)[1]);
  assert.ok(Number.isInteger(code) && code >= 1);
});

check("app id and name agree between Capacitor config and Android", () => {
  const cfg = JSON.parse(read("capacitor.config.json"));
  assert.strictEqual(read("android", "app", "build.gradle").match(/applicationId "([^"]+)"/)[1], cfg.appId);
  assert.ok(read("android", "app", "src", "main", "res", "values", "strings.xml").includes(`<string name="app_name">${cfg.appName}</string>`));
});

// ---- text encoding: the garbled-symbols bug ----
function textFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "vendor", "build", ".gradle", "assets"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) textFiles(p, out);
    else if (/\.(html|js|css|md|json|xml|gradle|properties|txt)$/i.test(e.name) && e.name !== "package-lock.json") out.push(p);
  }
  return out;
}
// UTF-8 decoded as Windows-1252 and re-saved looks like Ã Â â followed by cp1252 punctuation
const MOJIBAKE = /[ÂÃâ][\u0080-¿ŒœŠšŸŽžˆ˜–—‘-„†-•…‰‹›€™]/;

check("no garbled characters (mojibake) in any source file", () => {
  const bad = textFiles(root).filter((f) => MOJIBAKE.test(fs.readFileSync(f, "utf8")));
  assert.deepStrictEqual(bad.map((f) => path.relative(root, f)), []);
});

check("no byte-order marks in source files", () => {
  const bad = textFiles(root).filter((f) => { const b = fs.readFileSync(f); return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf; });
  assert.deepStrictEqual(bad.map((f) => path.relative(root, f)), []);
});

check("symbols the UI depends on survive in index.html", () => {
  const html = read("www", "index.html");
  for (const s of ["☰", "÷", "×", "−", "⌫", "⌨", "π", "√", "x²", "⇅", "☆"]) assert.ok(html.includes(s), "missing " + s);
});

// ---- npm scripts ----
check("npm test runs every test file, with plain && (no stray backslashes)", () => {
  const t = pkg.scripts.test;
  assert.ok(!t.includes("\\"), t);
  const files = fs.readdirSync(root).filter((f) => /^test-.*\.js$/.test(f) && f !== "test-fakes.js").concat("test.js");
  for (const f of files) assert.ok(t.includes("node " + f), "npm test skips " + f);
});

// ---- wiring: every script and view is hooked up ----
check("every www script is loaded by index.html, and every loaded script exists", () => {
  const html = read("www", "index.html");
  const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of loaded) assert.ok(fs.existsSync(path.join(root, "www", s)) || s.startsWith("vendor/"), "missing " + s);
  const onDisk = fs.readdirSync(path.join(root, "www")).filter((f) => f.endsWith(".js"));
  for (const f of onDisk) assert.ok(loaded.includes(f), f + " is not loaded by index.html");
});

check("every menu entry has a view and a title", () => {
  const html = read("www", "index.html");
  const nav = read("www", "nav.js");
  const views = [...html.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]);
  assert.ok(views.length >= 4, "found only " + views.join(", ")); // calc, convert, code, settings
  for (const v of views) {
    assert.ok(html.includes(`id="view-${v}"`), "no <main id=view-" + v + ">");
    assert.ok(new RegExp(`\\b${v}:\\s*"`).test(nav), "nav.js has no title for " + v);
  }
});

check("web and Android icons exist", () => {
  assert.ok(fs.existsSync(path.join(root, "www", "icon.png")));
  for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    for (const f of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
      assert.ok(fs.existsSync(path.join(root, "android", "app", "src", "main", "res", "mipmap-" + d, f)), d + "/" + f);
    }
  }
});

check("Android manifest keeps the storage permissions Save needs", () => {
  const m = read("android", "app", "src", "main", "AndroidManifest.xml");
  assert.ok(m.includes("READ_EXTERNAL_STORAGE") && m.includes("WRITE_EXTERNAL_STORAGE"));
});

check("the Filesystem plugin is a dependency and is registered in the Android project", () => {
  assert.ok(pkg.dependencies["@capacitor/filesystem"]);
  const plugins = read("android", "app", "src", "main", "assets", "capacitor.plugins.json");
  assert.ok(plugins.includes("FilesystemPlugin") || plugins.includes("Filesystem"));
});

console.log(failed ? `${failed} release checks failed` : "release checks passed");
process.exit(failed ? 1 : 0);
