/**
 * Generates the PWA icons in pure Node (no image libraries):
 *
 *   npx tsx scripts/make-icons.ts
 *
 * writes public/icons/icon-192.png, icon-512.png and maskable-512.png: an olive-700 tile with a yellow-400 accent bar
 * and a white "M" built from rectangles (diagonals are stacks of 1-px-high rectangles). Colours come from src/theme.ts.
 * PNG encoding is hand-written: signature + IHDR + IDAT (node:zlib deflate) + IEND, each chunk with its CRC32.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { palette } from '../src/theme';

export type RGBA = [number, number, number, number];

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------------- PNG encoding ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO-HDLC), as used by PNG chunks. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length (4 bytes BE) + type + data + CRC32(type + data). */
export function pngChunk(type: string, data: Uint8Array): Buffer {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`Invalid chunk type ${type}`);
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encodes 8-bit RGBA pixels (row-major, width*height*4 bytes) as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid size');
  if (rgba.length !== width * height * 4) throw new Error('Pixel buffer does not match the size');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type "None" for each scanline
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- drawing ---------------- */

export function hexToRgba(hex: string): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Invalid colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

export class Canvas {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  /** Fills the rectangle [x0, x1) x [y0, y1), clipped to the canvas. Coordinates are rounded. */
  fillRect(x0: number, y0: number, x1: number, y1: number, color: RGBA): void {
    const ax = Math.max(0, Math.round(x0));
    const bx = Math.min(this.width, Math.round(x1));
    const ay = Math.max(0, Math.round(y0));
    const by = Math.min(this.height, Math.round(y1));
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) this.set(x, y, color);
    }
  }

  set(x: number, y: number, color: RGBA): void {
    const i = (y * this.width + x) * 4;
    this.pixels[i] = color[0];
    this.pixels[i + 1] = color[1];
    this.pixels[i + 2] = color[2];
    this.pixels[i + 3] = color[3];
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    return [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2], this.pixels[i + 3]];
  }
}

/** Clears the four corners outside a rounded rectangle (transparent), for the non-maskable icons. */
function roundCorners(c: Canvas, radius: number): void {
  const r = Math.round(radius);
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      const dx = r - x - 0.5;
      const dy = r - y - 0.5;
      if (dx * dx + dy * dy > r * r) {
        c.set(x, y, [0, 0, 0, 0]);
        c.set(c.width - 1 - x, y, [0, 0, 0, 0]);
        c.set(x, c.height - 1 - y, [0, 0, 0, 0]);
        c.set(c.width - 1 - x, c.height - 1 - y, [0, 0, 0, 0]);
      }
    }
  }
}

/** A thick diagonal from (xa, ya) to (xb, yb), drawn as one horizontal rectangle per pixel row. */
function diagonal(c: Canvas, xa: number, ya: number, xb: number, yb: number, thickness: number, color: RGBA): void {
  const y0 = Math.round(Math.min(ya, yb));
  const y1 = Math.round(Math.max(ya, yb));
  for (let y = y0; y < y1; y++) {
    const t = (y + 0.5 - ya) / (yb - ya);
    const cx = xa + (xb - xa) * t;
    c.fillRect(cx - thickness / 2, y, cx + thickness / 2, y + 1, color);
  }
}

export interface IconOptions {
  /** Maskable icons are full-bleed with the artwork inside the central safe zone (80% circle). */
  maskable?: boolean;
}

export const ICON_COLORS = {
  background: hexToRgba(palette['forest-950']),
  accent: hexToRgba(palette['olive-600']),
  letter: hexToRgba(palette['stone-100']),
};

/** Draws the MastersPath icon at `size` x `size` pixels. */
export function drawIcon(size: number, opts: IconOptions = {}): Canvas {
  const c = new Canvas(size, size);
  const { background, accent, letter } = ICON_COLORS;
  c.fillRect(0, 0, size, size, background);
  if (!opts.maskable) roundCorners(c, size * 0.18);

  // Artwork box: 50% of the tile for maskable (inside the 80% safe-zone circle), 62% for the regular icon.
  const box = size * (opts.maskable ? 0.5 : 0.62);
  const bx = (size - box) / 2;
  const by = (size - box) / 2;

  // Yellow accent bar on the left (the same bar as next to the "MastersPath" wordmark).
  const barW = box * 0.09;
  c.fillRect(bx, by, bx + barW, by + box, accent);

  // White "M": two legs + two diagonals meeting in the middle.
  const mx0 = bx + box * 0.3;
  const mx1 = bx + box;
  const mw = mx1 - mx0;
  const stroke = mw * 0.2;
  c.fillRect(mx0, by, mx0 + stroke, by + box, letter);
  c.fillRect(mx1 - stroke, by, mx1, by + box, letter);
  const midX = (mx0 + mx1) / 2;
  const midY = by + box * 0.62;
  diagonal(c, mx0 + stroke / 2, by, midX, midY, stroke * 1.05, letter);
  diagonal(c, mx1 - stroke / 2, by, midX, midY, stroke * 1.05, letter);
  return c;
}

export function iconPng(size: number, opts: IconOptions = {}): Buffer {
  const c = drawIcon(size, opts);
  return encodePng(size, size, c.pixels);
}

export const ICON_FILES: ReadonlyArray<{ name: string; size: number; maskable: boolean }> = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'maskable-512.png', size: 512, maskable: true },
];

function main() {
  const dir = join(process.cwd(), 'public', 'icons');
  mkdirSync(dir, { recursive: true });
  for (const f of ICON_FILES) {
    const png = iconPng(f.size, { maskable: f.maskable });
    writeFileSync(join(dir, f.name), png);
    console.log(`icons: wrote public/icons/${f.name} (${png.length} bytes)`);
  }
}

// Run only when executed directly (tests import the helpers).
if (/make-icons\.ts$/.test((process.argv[1] ?? '').replace(/\\/g, '/'))) main();
