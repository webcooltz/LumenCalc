const assert = require("assert");
const C = require("./www/calc.js");

function ev(expr, mode, scope) {
  const r = C.evaluate(expr, scope || new Map(), mode);
  return r.ok ? r.text : "ERR: " + r.error;
}

// Arithmetic, precedence, parentheses
assert.strictEqual(ev("2+3*4"), "14");
assert.strictEqual(ev("(2+3)*4"), "20");
assert.strictEqual(ev("2(3+4)"), "14");               // implicit multiplication
assert.strictEqual(ev("2^3^2"), "512");                // right-associative
assert.strictEqual(ev("-2^2"), "-4");
assert.strictEqual(ev("0.1+0.2"), "0.3");
assert.strictEqual(ev("5!"), "120");
assert.strictEqual(ev("10 mod 3"), "1");
assert.strictEqual(ev("(2+3"), "5");                   // unclosed paren auto-closes
assert.strictEqual(ev("6×7÷2−1"), "20");               // keypad symbols
assert.strictEqual(ev("√16"), "4");
assert.strictEqual(ev("2π"), "6.28318530718");

// Functions, constants
assert.strictEqual(ev("sqrt(16)"), "4");
assert.strictEqual(ev("log10(1000)"), "3");
assert.strictEqual(ev("log(e)"), "1");
assert.strictEqual(ev("abs(-7)"), "7");
assert.strictEqual(ev("sin(pi/2)"), "1");
assert.strictEqual(ev("sin(90)", "deg"), "1");
assert.strictEqual(ev("asin(1)", "deg"), "90");
assert.strictEqual(ev("sqrt(-4)"), "2i");

// Errors
assert.ok(ev("2+*").startsWith("ERR"));
assert.ok(ev("foo(1)").startsWith("ERR"));

// Variables, functions, ans
const scope = new Map();
assert.strictEqual(ev("x = 5", "rad", scope), "5");
assert.strictEqual(ev("2x + 1", "rad", scope), "11");
assert.strictEqual(ev("ans * 2", "rad", scope), "22");
ev("f(t) = t^2 + 1", "rad", scope);
assert.strictEqual(ev("f(3)", "rad", scope), "10");

// Symbolic
assert.strictEqual(ev("simplify(2x+3x)"), "5 * x");
assert.strictEqual(ev("derivative(x^3, x)"), "3 * x ^ 2");
assert.strictEqual(ev("derivative(sin(x)*x, x)"), "cos(x) * x + sin(x)");
assert.strictEqual(ev("solve(2x+3=7, x)"), "[2]");
assert.strictEqual(ev("solve(x^2-4=0, x)"), "[-2, 2]");
assert.strictEqual(ev("solve(x^2+1=0)"), "[-i, i]");
assert.strictEqual(ev("solve(x^2-5x+6=0)"), "[2, 3]");
assert.ok(ev("solve(x^5=1)").startsWith("ERR"));
assert.ok(ev("solve(2+2)").startsWith("ERR"));

console.log("all tests passed");
