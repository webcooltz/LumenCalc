// Builds every app icon from assets/icon-source.webp (a blue rounded-square icon on a white page).
//   Android: legacy square + round + adaptive foreground per density, plus the adaptive background color
//   Web:     www/icon.png (favicon and home-screen icon), docs/logo.png (README)
// Run after changing the source:  npm run icons
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "assets", "icon-source.webp");
const RES = path.join(root, "android", "app", "src", "main", "res");

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Find the blue icon on the white page so the crops do not depend on the source's margins.
async function findIcon() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 3] < 150) { // red channel: white is ~255, the blue is ~0-60
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

const mask = (size, shape) =>
  Buffer.from(
    shape === "circle"
      ? `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
      : `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}"/></svg>`
  );

(async () => {
  const icon = await findIcon();
  // frac = how much of the blue icon's width to keep, centered. 0.77 drops the white corners entirely.
  const crop = (frac) => {
    const size = Math.round(icon.w * frac);
    return sharp(SRC).extract({
      left: Math.round(icon.cx - size / 2),
      top: Math.round(icon.cy - size / 2),
      width: size,
      height: size,
    });
  };

  // Background color for the adaptive icon: average of the crop's outer ring.
  const ring = await crop(0.77).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < ring.info.height; y++) {
    for (let x = 0; x < ring.info.width; x++) {
      if (x > 6 && y > 6 && x < ring.info.width - 7 && y < ring.info.height - 7) continue;
      const i = (y * ring.info.width + x) * 3;
      r += ring.data[i]; g += ring.data[i + 1]; b += ring.data[i + 2]; n++;
    }
  }
  const hex = "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("").toUpperCase();

  const masked = async (frac, size, shape) =>
    crop(frac).resize(size, size).composite([{ input: mask(size, shape), blend: "dest-in" }]).png().toBuffer();

  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, "mipmap-" + name);
    if (!fs.existsSync(dir)) throw new Error("Missing " + dir + " (run: npx cap add android)");
    const launcher = Math.round(48 * scale);
    const adaptive = Math.round(108 * scale);

    fs.writeFileSync(path.join(dir, "ic_launcher.png"), await masked(0.94, launcher, "square"));
    fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), await masked(0.944, launcher, "circle"));

    // Adaptive foreground: launchers show only the central 72dp of the 108dp canvas, under a circle or
    // squircle mask. The calculator is taller than wide, so it is scaled to about 53% of the canvas to
    // clear the mask. The artwork is then padded out to the full canvas by repeating its edge pixels,
    // which continues the blue seamlessly (0.84 keeps the source's white corners out of the crop).
    const art = Math.round(adaptive * 0.59);
    const pad = Math.floor((adaptive - art) / 2);
    const fg = await crop(0.84)
      .resize(art, art)
      .extend({ top: pad, left: pad, bottom: adaptive - art - pad, right: adaptive - art - pad, extendWith: "copy" })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), fg);
  }

  fs.writeFileSync(
    path.join(RES, "values", "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`
  );

  fs.writeFileSync(path.join(root, "www", "icon.png"), await masked(0.94, 192, "square"));

  // Larger copy for the README.
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "logo.png"), await masked(0.94, 512, "square"));

  console.log("icons written. adaptive background", hex, "| source icon width", icon.w + "px");
})().catch((e) => { console.error(e); process.exit(1); });
