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

  // ---- favorites: saved from/to pairs, newest first, shown as chips at the top ----
  const favsEl = document.getElementById("conv-favs");
  const starEl = document.getElementById("conv-star");

  const validPair = (f) =>
    f && typeof f.from === "string" && typeof f.to === "string" && Units.compatible(f.from).some((u) => u[0] === f.to);

  function loadFavs() {
    try {
      const list = JSON.parse(store("convFavs") || "[]");
      return Array.isArray(list) ? list.filter(validPair).map((f) => ({ from: f.from, to: f.to })) : [];
    } catch (e) { return []; }
  }

  let favs = loadFavs();
  const samePair = (f, from, to) => f.from === from && f.to === to;
  const isFav = () => favs.some((f) => samePair(f, fromEl.value, toEl.value));

  function toggleFav() {
    const from = fromEl.value, to = toEl.value;
    favs = isFav() ? favs.filter((f) => !samePair(f, from, to)) : [{ from, to }, ...favs];
    store("convFavs", JSON.stringify(favs));
    renderFavs();
  }

  function renderFavs() {
    const fav = isFav();
    const label = fav ? "Remove from favorites" : "Add to favorites";
    starEl.textContent = fav ? "★" : "☆";
    starEl.classList.toggle("on", fav);
    starEl.setAttribute("aria-pressed", String(fav));
    starEl.setAttribute("aria-label", label);
    starEl.title = label;

    if (!favs.length) {
      const hint = document.createElement("p");
      hint.className = "fav-empty";
      hint.textContent = "Tap ☆ to save a conversion here for quick access.";
      favsEl.replaceChildren(hint);
      return;
    }
    favsEl.replaceChildren(
      ...favs.map((f) => {
        const b = document.createElement("button");
        b.className = "fav" + (samePair(f, fromEl.value, toEl.value) ? " current" : "");
        b.textContent = Units.symbol(f.from) + " → " + Units.symbol(f.to);
        b.title = Units.name(f.from) + " to " + Units.name(f.to);
        b.addEventListener("click", () => { fromEl.value = f.from; fillTo(f.to); update(); }); // keeps the typed value
        return b;
      })
    );
  }

  starEl.addEventListener("click", toggleFav);

  function update() {
    renderFavs();
    store("conv", JSON.stringify({ from: fromEl.value, to: toEl.value, value: valueEl.value }));
    const v = parseValue();
    valueEl.classList.toggle("bad", v === null && valueEl.value.trim() !== "");
    if (v === null) {
      resultEl.textContent = "—";
      noteEl.textContent = "";
      return;
    }
    const from = fromEl.value, to = toEl.value;
    resultEl.textContent = Calc.group(Units.format(Units.convert(v, from, to)));
    noteEl.textContent = "1 " + Units.symbol(from) + " = " + Calc.group(Units.format(Units.convert(1, from, to))) + " " + Units.symbol(to);
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
