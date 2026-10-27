// Unit conversion on top of mathjs units. No DOM, so it is testable in Node.
(function (root) {
  const math = (typeof require === "function" ? require("mathjs") : root.math).create(
    typeof require === "function" ? require("mathjs").all : undefined
  );

  // Units mathjs lacks. US customary teaspoon/tablespoon, thermochemical calorie.
  math.createUnit("nmi", "1852 m");
  math.createUnit("mph", "1 mi/h");
  math.createUnit("knot", "1 nmi/h");
  math.createUnit("tsp", "4.92892159375 ml");
  math.createUnit("tbsp", "14.78676478125 ml");
  math.createUnit("cal", "4.184 J");
  math.createUnit("kcal", "4184 J");
  // mathjs rounds the acre to 4046.86 m2; use the exact survey-free definition (43560 ft2).
  math.createUnit("acre", "43560 sqft", { override: true });

  // [mathjs id, display name]. A unit can only convert within its own category.
  const CATEGORIES = [
    { name: "Length", units: [
      ["mm", "Millimeters"], ["cm", "Centimeters"], ["m", "Meters"], ["km", "Kilometers"],
      ["in", "Inches"], ["ft", "Feet"], ["yd", "Yards"], ["mi", "Miles"], ["nmi", "Nautical miles"],
    ] },
    { name: "Mass", units: [
      ["mg", "Milligrams"], ["g", "Grams"], ["kg", "Kilograms"], ["tonne", "Metric tons"],
      ["oz", "Ounces"], ["lb", "Pounds"], ["stone", "Stone"], ["ton", "US tons"],
    ] },
    { name: "Temperature", units: [
      ["degC", "Celsius"], ["degF", "Fahrenheit"], ["K", "Kelvin"],
    ] },
    { name: "Volume", units: [
      ["ml", "Milliliters"], ["l", "Liters"], ["m3", "Cubic meters"],
      ["tsp", "Teaspoons (US)"], ["tbsp", "Tablespoons (US)"], ["floz", "Fluid ounces (US)"],
      ["cup", "Cups (US)"], ["pt", "Pints (US)"], ["qt", "Quarts (US)"], ["gal", "Gallons (US)"],
    ] },
    { name: "Area", units: [
      ["cm2", "Square centimeters"], ["m2", "Square meters"], ["km2", "Square kilometers"],
      ["hectare", "Hectares"], ["sqin", "Square inches"], ["sqft", "Square feet"],
      ["acre", "Acres"], ["sqmi", "Square miles"],
    ] },
    { name: "Speed", units: [
      ["m/s", "Meters per second"], ["km/h", "Kilometers per hour"], ["mph", "Miles per hour"],
      ["knot", "Knots"], ["ft/s", "Feet per second"],
    ] },
    { name: "Time", units: [
      ["ms", "Milliseconds"], ["s", "Seconds"], ["min", "Minutes"], ["h", "Hours"],
      ["day", "Days"], ["week", "Weeks"], ["year", "Years"],
    ] },
    { name: "Data", units: [
      ["bit", "Bits"], ["B", "Bytes"], ["kB", "Kilobytes"], ["MB", "Megabytes"],
      ["GB", "Gigabytes"], ["TB", "Terabytes"], ["KiB", "Kibibytes"], ["MiB", "Mebibytes"], ["GiB", "Gibibytes"],
    ] },
    { name: "Energy", units: [
      ["J", "Joules"], ["kJ", "Kilojoules"], ["cal", "Calories"], ["kcal", "Kilocalories"],
      ["Wh", "Watt-hours"], ["kWh", "Kilowatt-hours"], ["BTU", "BTU"],
    ] },
    { name: "Power", units: [
      ["W", "Watts"], ["kW", "Kilowatts"], ["hp", "Horsepower"],
    ] },
    { name: "Pressure", units: [
      ["Pa", "Pascals"], ["kPa", "Kilopascals"], ["bar", "Bar"], ["psi", "PSI"],
      ["atm", "Atmospheres"], ["mmHg", "mmHg"],
    ] },
    { name: "Angle", units: [
      ["deg", "Degrees"], ["rad", "Radians"], ["grad", "Gradians"],
    ] },
  ];

  const SYMBOLS = { degC: "°C", degF: "°F", deg: "°", hectare: "ha", "m/s": "m/s", sqin: "in²",
    sqft: "ft²", sqmi: "mi²", cm2: "cm²", m2: "m²", km2: "km²", m3: "m³", day: "d", week: "wk", year: "yr" };
  const symbol = (id) => SYMBOLS[id] || id;

  function categoryOf(id) {
    return CATEGORIES.find((c) => c.units.some((u) => u[0] === id));
  }

  // Every unit a given unit can convert to (same category, itself excluded).
  function compatible(id) {
    const c = categoryOf(id);
    return c ? c.units.filter((u) => u[0] !== id) : [];
  }

  function convert(value, from, to) {
    const c = categoryOf(from);
    if (!c || !c.units.some((u) => u[0] === to)) throw new Error("Units are not compatible");
    return math.unit(value, from).toNumber(to);
  }

  function format(n) {
    if (!isFinite(n)) return "—";
    return math.format(n, { precision: 10, lowerExp: -6, upperExp: 12 });
  }

  const api = { CATEGORIES, categoryOf, compatible, convert, format, symbol };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Units = api;
})(typeof window !== "undefined" ? window : globalThis);
