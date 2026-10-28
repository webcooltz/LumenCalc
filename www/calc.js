// Expression engine on top of mathjs. No DOM, so it is testable in Node.
(function (root) {
  const math = typeof require === "function" ? require("mathjs") : root.math;

  // Two instances so trig can work in radians or degrees.
  const rad = math.create(math.all);
  const deg = math.create(math.all);

  const wrap = (name) => (x) =>
    typeof x === "number" ? rad[name]((x * Math.PI) / 180) : rad[name](x);
  const wrapInv = (name) => (x) => {
    const r = rad[name](x);
    return typeof r === "number" ? (r * 180) / Math.PI : r;
  };
  deg.import(
    {
      sin: wrap("sin"), cos: wrap("cos"), tan: wrap("tan"),
      asin: wrapInv("asin"), acos: wrapInv("acos"), atan: wrapInv("atan"),
    },
    { override: true }
  );

  // solve("x^2-4=0", "x") -> [-2, 2]. Polynomials up to degree 3.
  function solve(equation, variable) {
    const sides = String(equation).split("=");
    if (sides.length !== 2) throw new Error('solve needs an equation, e.g. solve(x^2-4=0, x)');
    const info = rad.rationalize("(" + sides[0] + ")-(" + sides[1] + ")", {}, true);
    const vars = info.variables;
    if (vars.length === 0) throw new Error("No variable to solve for");
    if (vars.length > 1 && !variable) throw new Error("Several variables, say which: solve(eq, x)");
    if (variable && vars.length === 1 && vars[0] !== variable) throw new Error("No variable " + variable);
    if (variable && vars.length > 1) throw new Error("solve handles one variable only");
    const c = info.coefficients.slice();
    while (c.length > 1 && c[c.length - 1] === 0) c.pop();
    if (c.length === 1) return c[0] === 0 ? "all numbers" : [];
    if (c.length > 4) throw new Error("solve supports up to degree 3");
    const part = (z, k) => (typeof z === "number" ? (k === "re" ? z : 0) : z[k]);
    return rad
      .polynomialRoot(...c)
      .sort((a, b) => part(a, "re") - part(b, "re") || part(a, "im") - part(b, "im"));
  }
  [rad, deg].forEach((m) => m.import({ solve }, { override: true }));

  const SYMBOLIC = ["simplify", "derivative", "solve"];

  function autoClose(expr) {
    let depth = 0;
    for (const ch of expr) {
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
    }
    return expr + ")".repeat(depth);
  }

  function splitTopLevel(s) {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    parts.push(s.slice(start));
    return parts;
  }

  // simplify(2x+3x) -> simplify("2x+3x"): symbolic functions take their text as-is.
  function quoteSymbolic(expr) {
    const re = new RegExp("\\b(" + SYMBOLIC.join("|") + ")\\(", "g");
    let out = "", last = 0, m;
    while ((m = re.exec(expr))) {
      const start = m.index + m[0].length;
      let depth = 1, i = start;
      for (; i < expr.length && depth; i++) {
        if (expr[i] === "(") depth++;
        else if (expr[i] === ")") depth--;
      }
      if (depth) break;
      const args = splitTopLevel(expr.slice(start, i - 1)).map((a, n) => {
        const t = a.trim();
        if (n > 1 || /^["'{]/.test(t) || t === "") return t;
        return JSON.stringify(t);
      });
      out += expr.slice(last, m.index) + m[1] + "(" + args.join(", ") + ")";
      last = re.lastIndex = i;
    }
    return out + expr.slice(last);
  }

  function normalize(expr) {
    let s = expr
      .replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-")
      .replace(/π/g, "pi")
      .replace(/√\(/g, "sqrt(")
      .replace(/√\s*([\w.]+)/g, "sqrt($1)");
    return quoteSymbolic(autoClose(s));
  }

  function format(v) {
    if (v === undefined || v === null) return "";
    if (v.isNode) return v.toString();
    if (v.isResultSet) return v.entries.map(format).join(", ");
    if (typeof v === "function") return v.syntax || "function defined";
    // Whole numbers that JS holds exactly print every digit (2^40 = 1099511627776, not rounded to 12 digits).
    if (Number.isSafeInteger(v)) return String(v);
    // Otherwise 14 significant digits hides float noise (0.1+0.2 -> 0.3). mathjs defaults to exponent form
    // from 1e5 (120000 -> 1.2e+5), so push that out to 1e15.
    return math.format(v, { precision: 14, lowerExp: -6, upperExp: 15 });
  }

  function storable(v) {
    return typeof v === "number" || (v && (v.isComplex || v.isMatrix)) || Array.isArray(v);
  }

  // scope is a Map holding variables/functions; "ans" is set on success.
  function evaluate(expr, scope, mode) {
    try {
      const v = (mode === "deg" ? deg : rad).evaluate(normalize(expr), scope);
      if (storable(v)) scope.set("ans", v);
      return { ok: true, value: v, text: format(v) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Display only: 1234567.89 -> 1,234,567.89. Lists, exponent form and complex numbers are left alone,
  // since a comma inside [1, 2] already means something. Never feed the grouped text back into an expression.
  function group(text) {
    const m = /^(-?)(\d{4,})(\.\d+)?$/.exec(text);
    if (!m) return text;
    return m[1] + m[2].replace(/\B(?=(\d{3})+$)/g, ",") + (m[3] || "");
  }

  const api = { evaluate, normalize, format, group };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
