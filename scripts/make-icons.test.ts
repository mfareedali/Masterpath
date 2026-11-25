import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { ICON_COLORS, ICON_FILES, PNG_SIGNATURE, crc32, drawIcon, encodePng, hexToRgba, iconPng, pngChunk } from './make-icons';

interface Chunk {
  type: string;
  data: Buffer;
  crcOk: boolean;
}

function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    const crc = png.readUInt32BE(off + 8 + len);
    chunks.push({ type, data, crcOk: crc === crc32(png.subarray(off + 4, off + 8 + len)) });
    off += 12 + len;
  }
  return chunks;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('pngChunk', () => {
  it('writes length, type, data and CRC', () => {
    const c = pngChunk('IEND', Buffer.alloc(0));
    expect(c.length).toBe(12);
    expect(c.readUInt32BE(0)).toBe(0);
    expect(c.toString('ascii', 4, 8)).toBe('IEND');
    expect(c.readUInt32BE(8)).toBe(0xae426082); // well-known IEND CRC
    expect(() => pngChunk('BAD!', Buffer.alloc(0))).toThrow();
  });
});

describe('encodePng', () => {
  it('produces a valid PNG signature, IHDR, IDAT and IEND', () => {
    const rgba = new Uint8Array(3 * 2 * 4).fill(255);
    const png = encodePng(3, 2, rgba);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const ihdr = chunks[0].data;
    expect(ihdr.length).toBe(13);
    expect(ihdr.readUInt32BE(0)).toBe(3);
    expect(ihdr.readUInt32BE(4)).toBe(2);
    expect([...ihdr.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    const raw = inflateSync(chunks[1].data);
    expect(raw.length).toBe((3 * 4 + 1) * 2);
    expect(raw[0]).toBe(0);
    expect(raw[13]).toBe(0);
  });

  it('rejects mismatched buffers', () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow();
    expect(() => encodePng(0, 2, new Uint8Array(0))).toThrow();
  });
});

describe('drawIcon', () => {
  it('uses the theme colours: olive background, yellow bar, white letter', () => {
    const c = drawIcon(512);
    expect(c.get(256, 20)).toEqual(ICON_COLORS.background);
    expect(c.get(0, 0)[3]).toBe(0); // rounded corner is transparent
    const pixels = new Set<string>();
    for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) pixels.add(c.get(x, y).join(','));
    expect(pixels.has(ICON_COLORS.accent.join(','))).toBe(true);
    expect(pixels.has(ICON_COLORS.letter.join(','))).toBe(true);
  });

  it('maskable icons are full-bleed (no transparent corners)', () => {
    const c = drawIcon(512, { maskable: true });
    expect(c.get(0, 0)).toEqual(ICON_COLORS.background);
    expect(c.get(511, 511)).toEqual(ICON_COLORS.background);
  });

  it('hexToRgba parses theme colours', () => {
    expect(hexToRgba('#FFFFFF')).toEqual([255, 255, 255, 255]);
    expect(() => hexToRgba('red')).toThrow();
  });
});

describe('generated icon files', () => {
  it.each(ICON_FILES)('public/icons/$name exists with the right IHDR size', ({ name, size, maskable }) => {
    const file = readFileSync(join(process.cwd(), 'public', 'icons', name));
    expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const ihdr = readChunks(file)[0];
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.data.readUInt32BE(0)).toBe(size);
    expect(ihdr.data.readUInt32BE(4)).toBe(size);
    // The committed pixels match what the generator draws today (run `npx tsx scripts/make-icons.ts` after edits).
    // Compare decompressed scanlines, not bytes: deflate output may differ between zlib versions.
    const idat = (png: Buffer) => inflateSync(Buffer.concat(readChunks(png).filter((c) => c.type === 'IDAT').map((c) => c.data)));
    expect(idat(file).equals(idat(iconPng(size, { maskable })))).toBe(true);
  });
});
