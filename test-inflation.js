const assert = require("assert");
const I = require("./www/inflation.js");

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// data covers every year with no gaps, and prices only trend up over the long run
assert.strictEqual(I.FIRST_YEAR, 1913);
assert.strictEqual(I.LAST_YEAR, 2024);
assert.strictEqual(I.CPI.length, I.LAST_YEAR - I.FIRST_YEAR + 1);
assert.ok(I.CPI.every((v) => v > 0 && isFinite(v)));
assert.ok(I.CPI[I.CPI.length - 1] > I.CPI[0] * 30);

// known anchors: CPI-U annual averages 1990 = 130.7 and 2024 = 313.689
near(I.adjust(100, 1990, 2024).value, (100 * 313.689) / 130.7);
assert.strictEqual(Math.round(I.adjust(100, 1990, 2024).value), 240);

// same year is a no-op; going back in time is the inverse
const same = I.adjust(50, 2000, 2000);
near(same.value, 50);
near(same.total, 0);
near(same.perYear, 0);
const fwd = I.adjust(100, 1980, 2020), back = I.adjust(fwd.value, 2020, 1980);
near(back.value, 100);
assert.ok(fwd.total > 0 && back.total < 0);
assert.ok(fwd.perYear > 0 && back.perYear < 0);

// average yearly rate compounds back to the total
const r = I.adjust(1, 2000, 2020);
near(Math.pow(1 + r.perYear, 20) - 1, r.total);

// scales linearly with the amount, and works for zero and negatives
near(I.adjust(250, 1999, 2010).value, 2.5 * I.adjust(100, 1999, 2010).value);
assert.strictEqual(I.adjust(0, 1999, 2010).value, 0);
assert.ok(I.adjust(-10, 1999, 2010).value < 0);

// years outside the data (or not whole years) are refused instead of guessed
assert.strictEqual(I.adjust(1, 1912, 2000), null);
assert.strictEqual(I.adjust(1, 2000, 2025), null);
assert.strictEqual(I.adjust(1, 2000.5, 2010), null);
assert.strictEqual(I.adjust(1, NaN, 2010), null);

// steady rate
near(I.atRate(100, 3, 10).value, 100 * Math.pow(1.03, 10));
near(I.atRate(100, 3, 10).total, Math.pow(1.03, 10) - 1);
near(I.atRate(100, 0, 10).value, 100);
near(I.atRate(100, 5, 0).value, 100);
assert.ok(I.atRate(100, -2, 5).value < 100); // deflation
near(I.atRate(100, 10, 0.5).value, 100 * Math.sqrt(1.1)); // part of a year

console.log("inflation tests passed");
