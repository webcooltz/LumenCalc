const input = document.getElementById("expr");
const preview = document.getElementById("preview");
const historyEl = document.getElementById("history");
const angleBtn = document.getElementById("angle");
const kbdBtn = document.getElementById("kbd");

const scope = new Map(); // variables, user functions, ans
let mode = store("angle") || "rad";
let history = JSON.parse(store("history") || "[]");

// localStorage can throw (private mode, blocked data), so wrap it.
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem("calc." + key);
    localStorage.setItem("calc." + key, value);
  } catch (e) {}
}

// Replay history so variables and functions survive a reload.
history.forEach((h) => Calc.evaluate(h.expr, scope, h.mode || "rad"));

function insert(text) {
  if (input.value === "" && /^[+*/^]/.test(text) && scope.has("ans")) text = "ans" + text;
  const s = input.selectionStart ?? input.value.length;
  const e = input.selectionEnd ?? s;
  input.setRangeText(text, s, e, "end");
  refresh();
}

function backspace() {
  let s = input.selectionStart, e = input.selectionEnd;
  if (s === e && s > 0) s--;
  input.setRangeText("", s, e, "end");
  refresh();
}

function moveCaret(delta) {
  const p = Math.max(0, Math.min(input.value.length, input.selectionStart + delta));
  input.setSelectionRange(p, p);
}

function refresh() {
  preview.classList.remove("error");
  const v = input.value.trim();
  if (!v) { preview.textContent = ""; preview.classList.remove("tap"); return; }
  const r = Calc.evaluate(v, new Map(scope), mode); // copy: previewing must not change state
  const show = r.ok && r.text && r.text !== v;
  // There is no = key: tapping the live result (or pressing Enter) saves it to the history.
  preview.textContent = show ? "= " + Calc.group(r.text) + "  ↵" : "";
  preview.classList.toggle("tap", !!show);
}

function equals() {
  const v = input.value.trim();
  if (!v) return;
  const r = Calc.evaluate(v, scope, mode);
  if (!r.ok) {
    preview.textContent = r.error;
    preview.classList.add("error");
    return;
  }
  history.push({ expr: v, text: r.text, mode });
  history = history.slice(-100);
  store("history", JSON.stringify(history));
  input.value = "";
  preview.textContent = "";
  renderHistory();
}

function renderHistory() {
  historyEl.replaceChildren(
    ...history.map((h) => {
      const row = document.createElement("div");
      row.className = "entry-row";
      const ex = document.createElement("div");
      ex.className = "expr";
      ex.textContent = h.expr;
      ex.title = "Tap to reuse expression";
      ex.addEventListener("click", () => insert(h.expr));
      const res = document.createElement("div");
      res.className = "res";
      res.textContent = "= " + Calc.group(h.text); // shown with commas; tapping inserts the plain h.text
      res.title = "Tap to insert result";
      res.addEventListener("click", () => insert(h.text));
      row.append(ex, res);
      return row;
    })
  );
  historyEl.scrollTop = historyEl.scrollHeight;
}

function clearAll() {
  if (input.value) {
    input.value = "";
  } else {
    history = [];
    scope.clear();
    store("history", "[]");
    renderHistory();
  }
  refresh();
}

// Keep focus (and the caret) in the input while tapping keys.
const calcView = document.getElementById("view-calc");
calcView.addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) e.preventDefault();
});

calcView.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.insert !== undefined) insert(b.dataset.insert);
  else if (b.dataset.action === "equals") equals();
  else if (b.dataset.action === "back") backspace();
  else if (b.dataset.action === "clear") clearAll();
  else if (b.dataset.action === "left") moveCaret(-1);
  else if (b.dataset.action === "right") moveCaret(1);
  else if (b.dataset.action === "keyboard") toggleKeyboard();
  else if (b === angleBtn) setMode(mode === "rad" ? "deg" : "rad");
  if (b !== kbdBtn) input.focus({ preventScroll: true });
});

function setMode(m) {
  mode = m;
  store("angle", m);
  angleBtn.textContent = m.toUpperCase();
  refresh();
}

function toggleKeyboard() {
  const on = input.inputMode === "none";
  input.inputMode = on ? "text" : "none";
  kbdBtn.classList.toggle("on", on);
  input.blur();
  input.focus();
}

preview.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret in the input
preview.addEventListener("click", () => { if (preview.classList.contains("tap")) equals(); });

input.addEventListener("input", refresh);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); equals(); }
  else if (e.key === "Escape") clearAll();
});

setMode(mode);
renderHistory();
