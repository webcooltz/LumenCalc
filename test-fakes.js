// In-memory stand-ins for the browser and Android file APIs, shared by the Node tests.

// ---- File System Access API ----
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

function fakeDir(name) {
  const kids = new Map();
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

const memStore = () => {
  let v;
  return { get: async () => v, set: async (x) => { v = x; }, peek: () => v };
};

// ---- Capacitor Filesystem plugin ----
// failDocuments: make the public Documents folder refuse, like scoped storage can.
function fakeNativeFs({ failDocuments = false } = {}) {
  const calls = [];
  const disk = new Map(); // "DIRECTORY:path" -> {text, modified}
  let t = 1;
  const key = (directory, path) => directory + ":" + path;
  const fs = {
    calls, disk,
    requestPermissions: async () => { calls.push("requestPermissions"); return { publicStorage: "granted" }; },
    mkdir: async ({ path, directory }) => {
      calls.push("mkdir " + directory + " " + path);
      if (failDocuments && directory === "DOCUMENTS") throw new Error("EACCES: permission denied");
    },
    readdir: async ({ path, directory }) => ({
      files: [...disk.keys()]
        .filter((k) => k.startsWith(key(directory, path) + "/"))
        .map((k) => ({ name: k.split("/").pop(), type: "file", size: disk.get(k).text.length, mtime: disk.get(k).modified })),
    }),
    readFile: async ({ path, directory }) => {
      const f = disk.get(key(directory, path));
      if (!f) throw new Error("File does not exist");
      return { data: f.text };
    },
    writeFile: async ({ path, directory, data }) => {
      calls.push("writeFile " + directory + " " + path);
      disk.set(key(directory, path), { text: data, modified: t++ });
    },
    stat: async ({ path, directory }) => {
      if (!disk.has(key(directory, path))) throw new Error("File does not exist");
      return {};
    },
  };
  return fs;
}

module.exports = { fakeFile, fakeDir, memStore, fakeNativeFs };
