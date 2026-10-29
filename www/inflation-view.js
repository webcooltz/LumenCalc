// Inflation view: what money was worth in another year (US CPI), or what it becomes at a steady rate.
(function () {
  const $ = (id) => document.getElementById(id);
  const modeEl = $("inf-mode"), amountEl = $("inf-amount"), fromEl = $("inf-from"), toEl = $("inf-to");
  const rateEl = $("inf-rate"), yearsEl = $("inf-years"), resultEl = $("inf-result"), noteEl = $("inf-note");

  for (let y = Inflation.LAST_YEAR; y >= Inflation.FIRST_YEAR; y--) {
    fromEl.append(new Option(y, y));
    toEl.append(new Option(y, y));
  }

  const num = (el) => {
    const text = el.value.trim();
    if (!text) return null;
    const r = Calc.evaluate(text, new Map(), "rad"); // allows 1/3, 2*5, etc.
    return r.ok && typeof r.value === "number" && isFinite(r.value) ? r.value : null;
  };
  const money = (v) => Calc.group(v.toFixed(2));
  const pct = (v, digits = 1) => (v >= 0 ? "+" : "−") + Calc.group(Math.abs(v * 100).toFixed(digits)) + "%";

  const isCpi = () => modeEl.value === "cpi";

  function update() {
    const cpi = isCpi();
    document.querySelectorAll("#view-inflation [data-mode]").forEach((el) => { el.hidden = el.dataset.mode !== modeEl.value; });
    store("inflation", JSON.stringify({
      mode: modeEl.value, amount: amountEl.value, from: fromEl.value, to: toEl.value, rate: rateEl.value, years: yearsEl.value,
    }));

    const amount = num(amountEl);
    const rate = num(rateEl), years = num(yearsEl);
    [amountEl, rateEl, yearsEl].forEach((el) => el.classList.toggle("bad", el.value.trim() !== "" && num(el) === null));

    let r = null;
    if (amount !== null) {
      r = cpi
        ? Inflation.adjust(amount, +fromEl.value, +toEl.value)
        : rate !== null && years !== null && rate > -100 ? Inflation.atRate(amount, rate, years) : null;
    }
    if (!r || !isFinite(r.value)) {
      resultEl.textContent = "—";
      noteEl.textContent = "";
      return;
    }
    resultEl.textContent = (cpi ? "$" : "") + money(r.value);
    noteEl.textContent = cpi
      ? "Prices " + pct(r.total) + " in total, about " + pct(r.perYear, 2) + " a year"
      : "Total change " + pct(r.total);
  }

  [modeEl, fromEl, toEl].forEach((el) => el.addEventListener("change", update));
  [amountEl, rateEl, yearsEl].forEach((el) => el.addEventListener("input", update));
  $("inf-swap").addEventListener("click", () => {
    const from = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = from;
    update();
  });

  let saved = {};
  try { saved = JSON.parse(store("inflation") || "{}"); } catch (e) {}
  modeEl.value = saved.mode === "rate" ? "rate" : "cpi";
  amountEl.value = saved.amount || "100";
  fromEl.value = saved.from || "2000";
  if (fromEl.value !== (saved.from || "2000")) fromEl.value = "2000";
  toEl.value = saved.to || String(Inflation.LAST_YEAR);
  if (toEl.value !== (saved.to || String(Inflation.LAST_YEAR))) toEl.value = String(Inflation.LAST_YEAR);
  rateEl.value = saved.rate || "3";
  yearsEl.value = saved.years || "10";
  update();
})();
