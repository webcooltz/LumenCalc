const assert = require("assert");
const U = require("./www/units.js");

const near = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// Known conversions
near(U.convert(1, "lb", "kg"), 0.45359237);
near(U.convert(1, "kg", "lb"), 2.2046226218, 1e-8);
near(U.convert(1, "in", "cm"), 2.54);
near(U.convert(1, "mi", "km"), 1.609344);
near(U.convert(32, "degF", "degC"), 0);
near(U.convert(100, "degC", "degF"), 212);
near(U.convert(0, "K", "degC"), -273.15);
near(U.convert(-40, "degC", "degF"), -40);
near(U.convert(1, "gal", "l"), 3.785411784);
near(U.convert(3, "tsp", "tbsp"), 1);
near(U.convert(60, "mph", "km/h"), 96.56064);
near(U.convert(1, "knot", "km/h"), 1.852);
near(U.convert(1, "KiB", "B"), 1024);
near(U.convert(1, "kB", "B"), 1000);
near(U.convert(1, "kcal", "cal"), 1000);
near(U.convert(1, "kWh", "J"), 3.6e6);
near(U.convert(180, "deg", "rad"), Math.PI);
near(U.convert(1, "acre", "m2"), 4046.8564224, 1e-8);
near(U.convert(1, "hp", "W"), 745.69987, 1e-6);
near(U.convert(1, "atm", "kPa"), 101.325);

// Every listed unit is valid in mathjs and converts to every compatible unit
for (const c of U.CATEGORIES) {
  for (const [from] of c.units) {
    for (const [to] of U.compatible(from)) {
      const v = U.convert(1, from, to);
      assert.ok(isFinite(v), `${from} -> ${to}`);
      near(U.convert(v, to, from), 1, 1e-7); // round trip
    }
  }
}

// Compatibility: lb only offers mass units
const ids = U.compatible("lb").map((u) => u[0]);
assert.ok(ids.includes("kg") && !ids.includes("lb") && !ids.includes("m"));
assert.throws(() => U.convert(1, "lb", "m"), /not compatible/);

// No duplicate ids across categories
const all = U.CATEGORIES.flatMap((c) => c.units.map((u) => u[0]));
assert.strictEqual(new Set(all).size, all.length);

// Display names and symbols (used by the favorites chips)
assert.strictEqual(U.name("lb"), "Pounds");
assert.strictEqual(U.name("degC"), "Celsius");
assert.strictEqual(U.name("nope"), "nope");
assert.strictEqual(U.symbol("degF"), "°F");

assert.strictEqual(U.format(2.2046226218488), "2.204622622");
assert.strictEqual(U.format(0.1 + 0.2), "0.3");

console.log("unit tests passed");
