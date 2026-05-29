/**
 * Convert an SVG to a transparent PNG sibling (same path, .png extension).
 *
 * Usage:
 *   bun run icon path/to/icon.svg          # → path/to/icon.png
 *   bun run icon path/to/icon.svg 1024     # custom square size (default 512)
 *
 * Uses Chrome headless with --default-background-color=00000000 because this Mac
 * has no cairo/rsvg and qlmanage fills the transparency white.
 * (see memory: reference_svg_to_png_transparent)
 */
import { resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const svgArg = process.argv[2];
if (!svgArg) {
  console.error("usage: bun run icon <path/to/icon.svg> [size]");
  process.exit(1);
}

const size = Number(process.argv[3] ?? "512");
const svgPath = resolve(svgArg);
const pngPath = svgPath.replace(/\.svg$/i, ".png");

const proc = Bun.spawnSync([
  CHROME,
  "--headless",
  "--disable-gpu",
  "--default-background-color=00000000",
  "--force-device-scale-factor=1",
  `--screenshot=${pngPath}`,
  `--window-size=${size},${size}`,
  svgPath,
]);

if (proc.exitCode !== 0) {
  console.error(proc.stderr.toString());
  process.exit(proc.exitCode ?? 1);
}

console.log(`wrote ${pngPath} (${size}x${size})`);
