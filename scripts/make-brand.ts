/**
 * Builds every logo asset from the master artwork in assets/brand/logo-source.jpg (olive "MP" + arrow on cream):
 *
 *   npm run icons
 *
 * writes
 *   public/brand/logo-mark.png            transparent, trimmed mark in the original olive (for light backgrounds)
 *   public/brand/logo-mark-light.png      the same mark recoloured muted olive, keeping its shading (dark site header, icons)
 *   public/icons/icon-192.png, icon-512.png, maskable-512.png   PWA icons (manifest + service-worker precache):
 *                                         the muted-olive mark on a forest-950 tile
 *   src/app/icon.png, src/app/apple-icon.png, src/app/favicon.ico   Next.js file-convention icons
 *
 * The cream background is keyed out by brightness: pixels at or above BG_LUM are transparent, at or below SOLID_LUM
 * opaque, with the cream blended back out of the anti-aliased edge pixels in between.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { palette } from '../src/theme';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'assets', 'brand', 'logo-source.jpg');
const BG_LUM = 226;
const SOLID_LUM = 175;
/** Icon tiles use the header colour (forest-950), so the installed app matches the site chrome. */
const TILE = palette['forest-950'];

async function transparentMark(): Promise<Buffer> {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height * 4);
  // Background colour: average of the four corners.
  const bg = [0, 0, 0];
  for (const [x, y] of [[4, 4], [width - 5, 4], [4, height - 5], [width - 5, height - 5]]) {
    for (let k = 0; k < 3; k++) bg[k] += data[(y * width + x) * 3 + k] / 4;
  }
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = Math.min(1, Math.max(0, (BG_LUM - lum) / (BG_LUM - SOLID_LUM)));
    const un = (c: number, k: number) => (a > 0 ? Math.min(255, Math.max(0, Math.round((c - (1 - a) * bg[k]) / a))) : 0);
    out[i * 4] = un(r, 0);
    out[i * 4 + 1] = un(g, 1);
    out[i * 4 + 2] = un(b, 2);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
}

/**
 * Recolours the mark for dark backgrounds: its shading (dark to light) is mapped onto LIGHT_LO to LIGHT_HI, a muted
 * olive that sits between olive-600 and olive-100 so it does not glare against forest-950.
 */
const LIGHT_LO = [128, 140, 84];
const LIGHT_HI = [206, 210, 180];
async function lightMark(mark: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(mark).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const lum = (i: number) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] > 200) {
      lo = Math.min(lo, lum(i));
      hi = Math.max(hi, lum(i));
    }
  }
  const out = Buffer.from(data);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (lum(i) - lo) / (hi - lo || 1)));
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(LIGHT_LO[k] + (LIGHT_HI[k] - LIGHT_LO[k]) * t);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/** The mark centred on a cream square; `scale` is the mark's share of the tile width; `radius` rounds the corners. */
async function tile(mark: Buffer, size: number, scale: number, radius: number): Promise<Buffer> {
  const inner = Math.round(size * scale);
  const m = await sharp(mark).resize(inner, inner, { fit: 'inside' }).toBuffer();
  const meta = await sharp(m).metadata();
  const left = Math.round((size - (meta.width ?? inner)) / 2);
  const top = Math.round((size - (meta.height ?? inner)) / 2);
  const r = Math.round(size * radius);
  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${TILE}"/></svg>`,
  );
  return sharp(bgSvg).composite([{ input: m, left, top }]).png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

function write(rel: string, buf: Buffer) {
  const path = join(ROOT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, buf);
  console.log(`brand: wrote ${rel} (${buf.length} bytes)`);
}

async function main() {
  const mark = await transparentMark();
  const small = await sharp(mark).resize({ height: 160 }).png({ compressionLevel: 9 }).toBuffer();
  write('public/brand/logo-mark.png', small);
  const light = await lightMark(small);
  write('public/brand/logo-mark-light.png', light);
  // Icons are built from the full-resolution mark so small sizes stay sharp.
  const iconMark = await lightMark(mark);
  write('public/icons/icon-192.png', await tile(iconMark, 192, 0.74, 0.18));
  write('public/icons/icon-512.png', await tile(iconMark, 512, 0.74, 0.18));
  // Maskable: full bleed, artwork inside the central 80% safe-zone circle.
  write('public/icons/maskable-512.png', await tile(iconMark, 512, 0.56, 0));
  write('src/app/icon.png', await tile(iconMark, 192, 0.8, 0.18));
  write('src/app/apple-icon.png', await tile(iconMark, 180, 0.7, 0));
  const favs = await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await tile(iconMark, size, 0.9, 0.15) })));
  write('src/app/favicon.ico', ico(favs));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
