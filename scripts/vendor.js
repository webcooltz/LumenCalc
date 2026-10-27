// Prepare www/vendor for the browser and the Android app:
//   math.js     browser build of mathjs, so the app works offline
//   about.json  app version plus the open source libraries (name, version, license, license text) for Settings
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dest = path.join(root, "www", "vendor");
const modules = path.join(root, "node_modules");
fs.mkdirSync(dest, { recursive: true });

fs.copyFileSync(path.join(modules, "mathjs", "lib", "browser", "math.js"), path.join(dest, "math.js"));

const read = (...p) => {
  try { return fs.readFileSync(path.join(...p), "utf8").trim(); } catch (e) { return ""; }
};

// Libraries that ship inside the app. Build tools (sharp, live-server) are not included.
const SHIPPED = [
  ["mathjs", "https://mathjs.org", ["lib/browser/math.js.LICENSE.txt"]],
  ["@capacitor/core", "https://capacitorjs.com", []],
  ["@capacitor/android", "https://capacitorjs.com", []],
  ["@capacitor/filesystem", "https://capacitorjs.com/docs/apis/filesystem", []],
];

const libraries = SHIPPED.map(([name, fallbackHome, extra]) => {
  const dir = path.join(modules, ...name.split("/"));
  const pkg = JSON.parse(read(dir, "package.json"));
  const text = ["LICENSE", "NOTICE", ...extra]
    .map((f) => read(dir, ...f.split("/")))
    .filter(Boolean)
    .join("\n\n----------\n\n");
  return { name, version: pkg.version, license: pkg.license, homepage: pkg.homepage || fallbackHome, text };
});

const app = JSON.parse(read(root, "package.json"));
fs.writeFileSync(path.join(dest, "about.json"), JSON.stringify({ version: app.version, libraries }));

console.log("vendored mathjs + about.json (" + libraries.length + " libraries) ->", path.join("www", "vendor"));
