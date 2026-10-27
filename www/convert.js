// Unit converter view. Pick a unit; the "to" list only offers compatible units.
(function () {
  const valueEl = document.getElementById("conv-value");
  const fromEl = document.getElementById("conv-from");
  const toEl = document.getElementById("conv-to");
  const resultEl = document.getElementById("conv-result");
  const noteEl = document.getElementById("conv-note");

  const label = ([id, name]) => name + " (" + Units.symbol(id) + ")";

  function option(u) {
    const o = document.createElement("option");
    o.value = u[0];
    o.textContent = label(u);
    return o;
  }

  // "From" lists every unit, grouped by category.
  Units.CATEGORIES.forEach((c) => {
    const g = document.createElement("optgroup");
    g.label = c.name;
    c.units.forEach((u) => g.append(option(u)));
    fromEl.append(g);
  });

  // What people usually want when they pick a unit; anything else falls back to the first compatible one.
  const USUAL = {
    mm: "in", cm: "in", m: "ft", km: "mi", in: "cm", ft: "m", yd: "m", mi: "km", nmi: "km",
    mg: "g", g: "oz", kg: "lb", tonne: "ton", oz: "g", lb: "kg", stone: "kg", ton: "tonne",
    degC: "degF", degF: "degC", K: "degC",
    ml: "floz", l: "gal", m3: "l", tsp: "ml", tbsp: "ml", floz: "ml", cup: "ml", pt: "l", qt: "l", gal: "l",
    m2: "sqft", cm2: "sqin", km2: "sqmi", hectare: "acre", sqin: "cm2", sqft: "m2", acre: "hectare", sqmi: "km2",
    "m/s": "mph", "km/h": "mph", mph: "km/h", knot: "km/h", "ft/s": "m/s",
    s: "min", min: "h", h: "min", day: "h", week: "day", year: "day", ms: "s",
    B: "kB", kB: "MB", MB: "GB", GB: "MB", TB: "GB", bit: "B",
    J: "cal", kJ: "kcal", cal: "J", kcal: "kJ", Wh: "J", kWh: "kJ", BTU: "kJ",
    W: "hp", kW: "hp", hp: "kW", Pa: "psi", kPa: "psi", bar: "psi", psi: "kPa", atm: "kPa", mmHg: "kPa",
    deg: "rad", rad: "deg", grad: "deg",
  };

  // keep `preferred` (the current "to") if it is still compatible, else the usual target, else the first option
  function fillTo(preferred) {
    const list = Units.compatible(fromEl.value);
    toEl.replaceChildren(...list.map(option));
    const has = (id) => list.some((u) => u[0] === id);
    toEl.value = has(preferred) ? preferred : has(USUAL[fromEl.value]) ? USUAL[fromEl.value] : list[0][0];
  }

  function parseValue() {
    const text = valueEl.value.trim();
    if (!text) return null;
    const r = Calc.evaluate(text, new Map(), "rad"); // allows 1/3, 2*5, etc.
    return r.ok && typeof r.value === "number" ? r.value : null;
  }

  function update() {
    store("conv", JSON.stringify({ from: fromEl.value, to: toEl.value, value: valueEl.value }));
    const v = parseValue();
    valueEl.classList.toggle("bad", v === null && valueEl.value.trim() !== "");
    if (v === null) {
      resultEl.textContent = "—";
      noteEl.textContent = "";
      return;
    }
    const from = fromEl.value, to = toEl.value;
    resultEl.textContent = Units.format(Units.convert(v, from, to));
    noteEl.textContent = "1 " + Units.symbol(from) + " = " + Units.format(Units.convert(1, from, to)) + " " + Units.symbol(to);
  }

  fromEl.addEventListener("change", () => { fillTo(toEl.value); update(); });
  toEl.addEventListener("change", update);
  valueEl.addEventListener("input", update);

  document.getElementById("conv-swap").addEventListener("click", () => {
    const from = fromEl.value, to = toEl.value;
    fromEl.value = to;
    fillTo(from);
    update();
  });

  document.getElementById("conv-sign").addEventListener("click", () => {
    const t = valueEl.value.trim();
    valueEl.value = t.startsWith("-") ? t.slice(1) : "-" + t;
    update();
  });

  let saved = {};
  try { saved = JSON.parse(store("conv") || "{}"); } catch (e) {}
  fromEl.value = saved.from || "lb";
  if (fromEl.value !== (saved.from || "lb")) fromEl.value = "lb";
  fillTo(saved.to || "kg");
  valueEl.value = saved.value || "1";
  update();
})();
