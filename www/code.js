// Code view: a JavaScript scratchpad. Code runs in a Web Worker (no DOM, no access to the app's
// state) that is killed after TIMEOUT_MS, so an infinite loop cannot freeze the calculator.
(function () {
  const TIMEOUT_MS = 5000;
  const MAX_LINES = 500;

  const editor = document.getElementById("code-editor");
  const out = document.getElementById("code-out");
  const runBtn = document.getElementById("code-run");
  const examplesEl = document.getElementById("code-examples");

  const EXAMPLES = [
    ["Hello world", 'console.log("Hello, world!");\n'],
    ["Loop and FizzBuzz", "for (let i = 1; i <= 15; i++) {\n  if (i % 15 === 0) console.log(\"FizzBuzz\");\n  else if (i % 3 === 0) console.log(\"Fizz\");\n  else if (i % 5 === 0) console.log(\"Buzz\");\n  else console.log(i);\n}\n"],
    ["Functions", "function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n\nconst nums = [];\nfor (let i = 0; i < 10; i++) nums.push(fib(i));\nconsole.log(nums);\n"],
    ["Arrays", "const nums = [5, 3, 8, 1, 9, 2];\nconsole.log(\"sorted:\", [...nums].sort((a, b) => a - b));\nconsole.log(\"doubled:\", nums.map((n) => n * 2));\nconsole.log(\"evens:\", nums.filter((n) => n % 2 === 0));\nconsole.log(\"sum:\", nums.reduce((a, b) => a + b, 0));\n"],
    ["Objects and JSON", "const person = { name: \"Ada\", langs: [\"JS\", \"Python\"], age: 36 };\nperson.age += 1;\nconsole.log(person);\nconsole.log(JSON.stringify(person));\nconsole.log(Object.keys(person));\n"],
    ["Primes", "function isPrime(n) {\n  if (n < 2) return false;\n  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;\n  return true;\n}\n\nconst primes = [];\nfor (let n = 2; primes.length < 15; n++) if (isPrime(n)) primes.push(n);\nprimes;\n"],
    ["Quick math", "2 ** 10 + Math.sqrt(144)\n"],
  ];

  // Runs inside the worker. eval returns the last expression's value, REPL style.
  const WORKER_SRC = `
    const fmt = (v) => {
      if (typeof v === "string") return v;
      if (typeof v === "function") return v.toString();
      if (typeof v === "undefined") return "undefined";
      const rep = (k, x) => typeof x === "bigint" ? x + "n" : x === undefined ? "undefined" : x;
      try {
        const short = JSON.stringify(v, rep);
        if (short === undefined) return String(v);
        return short.length <= 60 ? short : JSON.stringify(v, rep, 2); // small values on one line
      } catch (e) { return String(v); }
    };
    const send = (type, text) => postMessage({ type, text });
    console.log = console.info = console.debug = (...a) => send("log", a.map(fmt).join(" "));
    console.warn = console.error = (...a) => send("error", a.map(fmt).join(" "));
    onmessage = (e) => {
      try {
        const r = (0, eval)(e.data);
        if (r !== undefined) send("result", fmt(r));
      } catch (err) {
        send("error", err && err.name ? err.name + ": " + err.message : String(err));
      }
      postMessage({ type: "done" });
    };
  `;
  const workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));

  let worker = null;
  let timer = null;
  let lines = 0;

  function print(cls, text) {
    if (lines === MAX_LINES) {
      line("note", "… output truncated");
      lines++;
    }
    if (lines > MAX_LINES) return;
    line(cls, cls === "result" ? "→ " + text : text);
    lines++;
  }

  function line(cls, text) {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    out.append(d);
    out.scrollTop = out.scrollHeight;
  }

  function finish() {
    clearTimeout(timer);
    if (worker) worker.terminate();
    worker = null;
    runBtn.textContent = "Run";
    runBtn.classList.remove("stop");
    runBtn.classList.add("op");
  }

  function run() {
    if (worker) { // button doubles as Stop
      finish();
      print("note", "Stopped.");
      return;
    }
    out.replaceChildren();
    lines = 0;
    store("code", editor.value);
    worker = new Worker(workerUrl);
    worker.onmessage = (e) => {
      if (e.data.type === "done") { finish(); return; }
      print(e.data.type, e.data.text);
    };
    worker.onerror = (e) => { // e.g. a SyntaxError escaping before eval's own handler
      print("error", e.message || "Script error");
      finish();
    };
    timer = setTimeout(() => {
      finish();
      print("error", "Stopped: ran longer than " + TIMEOUT_MS / 1000 + " seconds (infinite loop?)");
    }, TIMEOUT_MS);
    runBtn.textContent = "Stop";
    runBtn.classList.remove("op");
    runBtn.classList.add("stop");
    worker.postMessage(editor.value);
  }

  function insertAtCaret(text) {
    const s = editor.selectionStart, e = editor.selectionEnd;
    editor.setRangeText(text, s, e, "end");
    // For paired symbols like {} or (), leave the caret between them.
    if (text.length === 2 && /^(\{\}|\(\)|\[\]|"")$/.test(text)) editor.setSelectionRange(s + 1, s + 1);
    editor.focus();
  }

  examplesEl.replaceChildren(
    new Option("Examples…", ""),
    ...EXAMPLES.map(([name], i) => new Option(name, i))
  );
  examplesEl.addEventListener("change", () => {
    if (examplesEl.value === "") return;
    editor.value = EXAMPLES[Number(examplesEl.value)][1];
    store("code", editor.value);
    examplesEl.value = "";
  });

  runBtn.addEventListener("click", run);
  document.getElementById("code-clear").addEventListener("click", () => { out.replaceChildren(); lines = 0; });

  document.getElementById("code-keys").addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault(); // keep the caret in the editor
  });
  document.getElementById("code-keys").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) insertAtCaret(b.dataset.code);
  });

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); insertAtCaret("  "); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });
  editor.addEventListener("input", () => store("code", editor.value));

  editor.value = store("code") || EXAMPLES[0][1];
})();
