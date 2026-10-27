const assert = require("assert");
const F = require("./www/files.js");

// ---- sanitizeName ----
assert.strictEqual(F.sanitizeName("fib"), "fib.js");
assert.strictEqual(F.sanitizeName("fib.js"), "fib.js");
assert.strictEqual(F.sanitizeName("notes.TXT"), "notes.TXT");
assert.strictEqual(F.sanitizeName("a/b\\c:d"), "a-b-c-d.js");
assert.strictEqual(F.sanitizeName("../../etc/passwd"), "-..-etc-passwd.js"); // no path escape
assert.ok(!/[\\/]/.test(F.sanitizeName("../../x")));
assert.strictEqual(F.sanitizeName("   "), "untitled.js");
assert.strictEqual(F.sanitizeName(""), "untitled.js");
assert.strictEqual(F.sanitizeName(null), "untitled.js");
assert.strictEqual(F.sanitizeName(".hidden"), "hidden.js");
assert.ok(F.sanitizeName("x".repeat(200)).length <= 80);
assert.ok(F.sanitizeName("x".repeat(200)).endsWith(".js"));

// ---- in-memory fake of the File System Access API ----
function fakeDir(name) {
  const kids = new Map(); // name -> {kind, handle|file}
  const dir = {
    kind: "directory", name, kids,
    perm: "granted",
    async queryPermission() { return dir.perm; },
    async requestPermission() { return dir.perm === "denied" ? "denied" : (dir.perm = "granted"); },
    async getDirectoryHandle(n, { create } = {}) {
      if (!kids.has(n)) {
        if (!create) throw new Error("NotFoundError");
        kids.set(n, fakeDir(n));
      }
      return kids.get(n);
    },
    async getFileHandle(n, { create } = {}) {
      if (!kids.has(n)) {
        if (!create) throw new Error("NotFoundError");
        kids.set(n, fakeFile(n));
      }
      return kids.get(n);
    },
    async *entries() { for (const [k, v] of kids) yield [k, v]; },
  };
  return dir;
}
let clock = 1000;
function fakeFile(name) {
  const f = { kind: "file", name, text: "", modified: clock++ };
  f.getFile = async () => ({ text: async () => f.text, lastModified: f.modified, size: f.text.length });
  f.createWritable = async () => {
    let buf = "";
    return { write: async (t) => { buf += t; }, close: async () => { f.text = buf; f.modified = clock++; } };
  };
  return f;
}
const memStore = () => { let v; return { get: async () => v, set: async (x) => { v = x; }, peek: () => v }; };

(async () => {
  // ---- folder backend ----
  const docs = fakeDir("Documents");
  const store = memStore();
  let b = F.createFolderBackend({ pickDirectory: async () => docs, handleStore: store });

  assert.strictEqual(await b.status(), "needs-setup");
  await b.setup();
  assert.ok(docs.kids.has("LumenCalc"), "creates LumenCalc inside the chosen folder");
  assert.strictEqual(b.location, "Documents / LumenCalc");
  assert.strictEqual(await b.status(), "ready");

  assert.deepStrictEqual(await b.list(), []);
  await b.write("a.js", "console.log(1)");
  await b.write("b.js", "console.log(2)");
  await b.write("note.txt", "hi");
  docs.kids.get("LumenCalc").kids.set("image.png", fakeFile("image.png")); // not code
  docs.kids.get("LumenCalc").kids.set("sub", fakeDir("sub"));              // not a file
  await b.write("a.js", "console.log(3)");                                 // a.js is now newest
  const names = (await b.list()).map((f) => f.name);
  assert.deepStrictEqual(names, ["a.js", "note.txt", "b.js"]);
  assert.strictEqual(await b.read("a.js"), "console.log(3)");
  assert.strictEqual(await b.exists("b.js"), true);
  assert.strictEqual(await b.exists("zzz.js"), false);

  // a new session reuses the saved folder; permission must be re-granted from a gesture
  b = F.createFolderBackend({ pickDirectory: async () => { throw new Error("should not pick"); }, handleStore: store });
  const lc = docs.kids.get("LumenCalc");
  lc.perm = "prompt";
  assert.strictEqual(await b.status(), "needs-permission");
  await b.setup();
  assert.strictEqual(await b.status(), "ready");

  // picking a folder already named LumenCalc does not nest another one
  const direct = fakeDir("LumenCalc");
  b = F.createFolderBackend({ pickDirectory: async () => direct, handleStore: memStore() });
  await b.setup();
  assert.strictEqual(direct.kids.size, 0);
  await b.write("x.js", "1");
  assert.ok(direct.kids.has("x.js"));
  assert.strictEqual(b.location, "LumenCalc");

  // change folder
  const other = fakeDir("Projects");
  b = F.createFolderBackend({ pickDirectory: async () => other, handleStore: store });
  await b.status();
  await b.setup({ change: true });
  assert.ok(other.kids.has("LumenCalc"));
  assert.strictEqual(b.location, "Projects / LumenCalc");

  // ---- native backend ----
  const calls = [];
  const disk = new Map();
  const mkNative = (failDocuments) => {
    const fs = {
      requestPermissions: async () => calls.push("perm"),
      mkdir: async ({ path, directory }) => {
        if (failDocuments && directory === "DOCUMENTS") throw new Error("EACCES");
        calls.push("mkdir " + directory + ":" + path);
      },
      readdir: async ({ path, directory }) => ({
        files: [...disk.keys()].filter((k) => k.startsWith(directory + ":" + path + "/")).map((k) => ({
          name: k.split("/").pop(), type: "file", size: 1, mtime: disk.get(k).m,
        })).concat([{ name: "sub", type: "directory" }, { name: "pic.png", type: "file" }]),
      }),
      readFile: async ({ path, directory }) => ({ data: disk.get(directory + ":" + path).t }),
      writeFile: async ({ path, directory, data }) => disk.set(directory + ":" + path, { t: data, m: disk.size + 1 }),
      stat: async ({ path, directory }) => { if (!disk.has(directory + ":" + path)) throw new Error("nope"); },
    };
    let v = null;
    return F.createNativeBackend({ fs, store: { get: () => v, set: (x) => { v = x; } } });
  };

  let n = mkNative(false);
  assert.strictEqual(await n.status(), "needs-setup");
  await n.setup();
  assert.strictEqual(n.location, "Documents / LumenCalc");
  assert.deepStrictEqual(calls, ["perm", "mkdir DOCUMENTS:LumenCalc"]);
  await n.write("one.js", "1");
  await n.write("two.js", "2");
  assert.deepStrictEqual((await n.list()).map((f) => f.name), ["two.js", "one.js"]);
  assert.strictEqual(await n.read("one.js"), "1");
  assert.strictEqual(await n.exists("one.js"), true);
  assert.strictEqual(await n.exists("nah.js"), false);

  n = mkNative(true); // public Documents refused -> app storage
  await n.setup();
  assert.strictEqual(n.location, "App storage / LumenCalc");
  assert.strictEqual(await n.status(), "ready");

  // ---- download backend ----
  let got = null;
  const d = F.createDownloadBackend({ download: (name, text) => { got = [name, text]; } });
  assert.strictEqual(await d.status(), "ready");
  await d.write("q.js", "x");
  assert.deepStrictEqual(got, ["q.js", "x"]);
  assert.strictEqual(d.list, null);

  // ---- detect picks the right backend ----
  assert.strictEqual(F.detect({}).kind, "download");
  assert.strictEqual(F.detect({ showDirectoryPicker() {}, indexedDB: {} }).kind, "folder");
  assert.strictEqual(
    F.detect({ Capacitor: { isNativePlatform: () => true, registerPlugin: () => ({}) } }).kind,
    "native"
  );

  console.log("file tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
