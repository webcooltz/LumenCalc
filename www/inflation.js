// Inflation maths. No DOM, so it is testable in Node.
// CPI is the US CPI-U annual average (BLS, 1982-84 = 100), bundled so it works offline. It ends at LAST_YEAR;
// to add a year, append it to CPI. Everything else follows.
(function (root) {
  const FIRST_YEAR = 1913;
  const CPI = [
    9.9, 10.0, 10.1, 10.9, 12.8, 15.1, 17.3, 20.0, 17.9, 16.8, // 1913-1922
    17.1, 17.1, 17.5, 17.7, 17.4, 17.1, 17.1, 16.7, 15.2, 13.7, // 1923-1932
    13.0, 13.4, 13.7, 13.9, 14.4, 14.1, 13.9, 14.0, 14.7, 16.3, // 1933-1942
    17.3, 17.6, 18.0, 19.5, 22.3, 24.1, 23.8, 24.1, 26.0, 26.5, // 1943-1952
    26.7, 26.9, 26.8, 27.2, 28.1, 28.9, 29.1, 29.6, 29.9, 30.2, // 1953-1962
    30.6, 31.0, 31.5, 32.4, 33.4, 34.8, 36.7, 38.8, 40.5, 41.8, // 1963-1972
    44.4, 49.3, 53.8, 56.9, 60.6, 65.2, 72.6, 82.4, 90.9, 96.5, // 1973-1982
    99.6, 103.9, 107.6, 109.6, 113.6, 118.3, 124.0, 130.7, 136.2, 140.3, // 1983-1992
    144.5, 148.2, 152.4, 156.9, 160.5, 163.0, 166.6, 172.2, 177.1, 179.9, // 1993-2002
    184.0, 188.9, 195.3, 201.6, 207.342, 215.303, 214.537, 218.056, 224.939, 229.594, // 2003-2012
    232.957, 236.736, 237.017, 240.007, 245.120, 251.107, 255.657, 258.811, 270.970, 292.655, // 2013-2022
    304.702, 313.689, // 2023-2024
  ];
  const LAST_YEAR = FIRST_YEAR + CPI.length - 1;

  const cpi = (year) => CPI[year - FIRST_YEAR];
  const validYear = (y) => Number.isInteger(y) && y >= FIRST_YEAR && y <= LAST_YEAR;

  // What `amount` in `from` buys in `to`. Returns null for years outside the data.
  function adjust(amount, from, to) {
    if (!validYear(from) || !validYear(to)) return null;
    const value = (amount * cpi(to)) / cpi(from);
    const total = cpi(to) / cpi(from) - 1; // 1.4 = prices up 140%
    const years = Math.abs(to - from); // the rate is per year travelled, either direction
    const perYear = years ? Math.pow(cpi(to) / cpi(from), 1 / years) - 1 : 0; // negative when going back in time
    return { value, total, perYear };
  }

  // What `amount` becomes after `years` at a steady `ratePct` per year (negative = deflation).
  function atRate(amount, ratePct, years) {
    const factor = Math.pow(1 + ratePct / 100, years);
    return { value: amount * factor, total: factor - 1 };
  }

  const api = { FIRST_YEAR, LAST_YEAR, CPI, adjust, atRate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Inflation = api;
})(typeof window !== "undefined" ? window : globalThis);
