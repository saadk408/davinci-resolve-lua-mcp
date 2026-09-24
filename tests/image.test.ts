import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode } from 'jpeg-js';
import { downscaleToRgba, encodeJpeg, fitJpeg, fitSize, ImageError, parseBmp, type Rgba } from '../src/image.js';

type Rgb = [number, number, number];

/**
 * A BMP of `rows` (top row first) with a 14-byte file header and a `dibSize` info header, the
 * layout Resolve writes by default. Padding bytes are 0xEE and the fourth byte of a 32-bit pixel
 * is 0xAA, so a parser that reads either shows it in the pixels.
 */
function writeBmp(rows: Rgb[][], opts: { bits?: 24 | 32; topDown?: boolean; dibSize?: number } = {}): Buffer {
  const bits = opts.bits ?? 24;
  const dibSize = opts.dibSize ?? 40;
  const height = rows.length;
  const width = rows[0]!.length;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const offset = 14 + dibSize;
  const buf = Buffer.alloc(offset + stride * height);
  buf.fill(0xee, offset);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(dibSize, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(opts.topDown ? -height : height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bits, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(stride * height, 34);
  rows.forEach((row, r) => {
    const stored = opts.topDown ? r : height - 1 - r;
    row.forEach(([red, green, blue], x) => {
      const p = offset + stored * stride + x * (bits / 8);
      buf[p] = blue;
      buf[p + 1] = green;
      buf[p + 2] = red;
      if (bits === 32) buf[p + 3] = 0xaa;
    });
  });
  return buf;
}

function solid(width: number, height: number, rgb: Rgb): Rgb[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => rgb));
}

/** The picture as rows of [r, g, b], checking that every alpha is 255. */
function rowsOf(img: Rgba): Rgb[][] {
  const out: Rgb[][] = [];
  for (let y = 0; y < img.height; y++) {
    const row: Rgb[] = [];
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      assert.equal(img.data[o + 3], 255, `alpha at ${x},${y}`);
      row.push([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]);
    }
    out.push(row);
  }
  return out;
}

const PICTURE: Rgb[][] = [
  [[200, 100, 50], [1, 2, 3], [250, 0, 125]],
  [[0, 0, 0], [255, 255, 255], [9, 99, 199]],
];

test('parseBmp reads the layout Resolve writes: 24-bit, 40-byte header, bottom-up', () => {
  const bmp = parseBmp(writeBmp(solid(4, 2, [10, 20, 30])));
  assert.equal(bmp.width, 4);
  assert.equal(bmp.height, 2);
  assert.equal(bmp.bitsPerPixel, 24);
  assert.equal(bmp.topDown, false);
  assert.equal(bmp.stride, 12);
  assert.equal(bmp.pixels.length, 24);
  assert.deepEqual([...bmp.pixels.subarray(0, 3)], [30, 20, 10], 'stored as B, G, R');
});

test('rows are padded to four bytes, and the padding is never read as pixels', () => {
  const bmp = parseBmp(writeBmp(PICTURE));
  assert.equal(bmp.stride, 12, '3 pixels x 3 bytes = 9, padded to 12');
  assert.deepEqual(rowsOf(downscaleToRgba(bmp, 1920)), PICTURE);
});

test('32-bit pixels, top-down rows and the V4/V5 headers read as the same picture', () => {
  for (const opts of [{ bits: 32 as const }, { topDown: true }, { bits: 32 as const, topDown: true }, { dibSize: 108 }, { dibSize: 124 }]) {
    const bmp = parseBmp(writeBmp(PICTURE, opts));
    assert.equal(bmp.topDown, opts.topDown === true, JSON.stringify(opts));
    assert.deepEqual(rowsOf(downscaleToRgba(bmp, 1920)), PICTURE, JSON.stringify(opts));
  }
});

test('parseBmp refuses what it cannot read, naming the field', () => {
  const good = writeBmp(solid(4, 2, [1, 2, 3]));
  const patched = (write: (b: Buffer) => void): Buffer => {
    const b = Buffer.from(good);
    write(b);
    return b;
  };
  const cases: Array<[string, Buffer, RegExp]> = [
    ['too short', good.subarray(0, 40), /^not a BMP file \(40 bytes, shorter than its headers\)$/],
    ['PNG magic', patched((b) => b.write('PN', 0, 'latin1')), /^not a BMP file \(magic "PN"\)$/],
    ['unknown header size', patched((b) => b.writeUInt32LE(56, 14)), /^unsupported BMP header size 56$/],
    ['zero width', patched((b) => b.writeInt32LE(0, 18)), /^unsupported BMP width 0 /],
    ['zero height', patched((b) => b.writeInt32LE(0, 22)), /^unsupported BMP height 0 /],
    ['huge height', patched((b) => b.writeInt32LE(-20000, 22)), /^unsupported BMP height -20000 /],
    ['two planes', patched((b) => b.writeUInt16LE(2, 26)), /^unsupported BMP plane count 2$/],
    ['16-bit', patched((b) => b.writeUInt16LE(16, 28)), /^unsupported BMP depth of 16 bits per pixel/],
    ['BI_BITFIELDS', patched((b) => b.writeUInt32LE(3, 30)), /^unsupported BMP compression 3$/],
    ['offset inside the headers', patched((b) => b.writeUInt32LE(20, 10)), /^BMP pixel offset 20 points inside its headers$/],
    ['truncated pixels', good.subarray(0, good.length - 1), /^BMP is truncated: 4x2 at 24 bits needs 78 bytes, the file has 77$/],
  ];
  for (const [name, buf, message] of cases) {
    assert.throws(() => parseBmp(buf), (e: unknown) => e instanceof ImageError && message.test(e.message), name);
  }
});

test('fitSize caps the longest side, keeps the aspect ratio and never upscales', () => {
  assert.deepEqual(fitSize(1920, 1080, 960), { width: 960, height: 540 });
  assert.deepEqual(fitSize(1080, 1920, 960), { width: 540, height: 960 });
  assert.deepEqual(fitSize(800, 600, 960), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1, 10000, 160), { width: 1, height: 160 });
  assert.deepEqual(fitSize(3840, 2160, 1920), { width: 1920, height: 1080 });
});

test('downscaleToRgba averages each source box', () => {
  // A 4x4 picture of four solid 2x2 quadrants shrinks to one pixel per quadrant, exactly.
  const expected: Rgb[][] = [
    [[255, 0, 0], [0, 255, 0]],
    [[0, 0, 255], [10, 20, 30]],
  ];
  const quadrants: Rgb[][] = [0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => expected[y >> 1]![x >> 1]!));
  const bottomUp = downscaleToRgba(parseBmp(writeBmp(quadrants)), 2);
  assert.deepEqual(rowsOf(bottomUp), expected);
  assert.deepEqual(downscaleToRgba(parseBmp(writeBmp(quadrants, { topDown: true })), 2), bottomUp, 'the same picture either way up');

  // 3 columns into 2: box 0 is column 0, box 1 is columns 1-2; 61 / 2 = 30.5 rounds to 31.
  const uneven = downscaleToRgba(parseBmp(writeBmp([[[10, 0, 0], [20, 0, 0], [41, 0, 0]]])), 2);
  assert.deepEqual(rowsOf(uneven), [[[10, 0, 0], [31, 0, 0]]]);
});

test('encodeJpeg writes a JPEG that decodes to the same size and colour', () => {
  for (const [w, h] of [[64, 48], [37, 19], [1, 1]] as const) {
    const img = downscaleToRgba(parseBmp(writeBmp(solid(w, h, [200, 100, 50]))), 1920);
    const jpeg = encodeJpeg(img);
    assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8], 'SOI');
    assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9], 'EOI');
    const back = decode(jpeg, { useTArray: true });
    assert.equal(back.width, w);
    assert.equal(back.height, h);
    const sums = new Float64Array(3);
    for (let i = 0; i < back.data.length; i += 4) for (let c = 0; c < 3; c++) sums[c] = sums[c]! + back.data[i + c]!;
    const mean = [...sums].map((s) => s / (w * h));
    [200, 100, 50].forEach((want, c) => assert.ok(Math.abs(mean[c]! - want) <= 3, `${w}x${h} channel ${c}: mean ${mean[c]} vs ${want}`));
  }
});

/** A stand-in encoder: one byte per pixel plus `overhead`, recording the sizes and quality it saw. */
function fakeEncoder(overhead = 0): { encode: (img: Rgba, quality: number) => Buffer; seen: Array<[number, number, number]> } {
  const seen: Array<[number, number, number]> = [];
  return {
    seen,
    encode: (img, quality) => {
      seen.push([img.width, img.height, quality]);
      return Buffer.alloc(overhead + img.width * img.height);
    },
  };
}

test('fitJpeg encodes once when the first JPEG fits the cap', () => {
  const bmp = parseBmp(writeBmp(solid(800, 450, [5, 5, 5])));
  const f = fakeEncoder();
  const r = fitJpeg(bmp, { maxEdge: 400, capBytes: 100_000, minEdge: 320 }, f.encode);
  assert.deepEqual(f.seen, [[400, 225, 75]], 'quality 75 by default');
  assert.deepEqual({ width: r.width, height: r.height, encodes: r.encodes, overBudget: r.overBudget, bytes: r.jpeg.length }, { width: 400, height: 225, encodes: 1, overBudget: false, bytes: 90_000 });
});

test('fitJpeg shrinks from the source by sqrt(cap / bytes) * 0.95 until the JPEG fits', () => {
  const bmp = parseBmp(writeBmp(solid(800, 450, [5, 5, 5])));
  const f = fakeEncoder();
  const r = fitJpeg(bmp, { maxEdge: 960, capBytes: 100_000, minEdge: 320, quality: 60 }, f.encode);
  // 800x450 = 360,000 bytes; 800 * sqrt(100,000 / 360,000) * 0.95 = 400.6, so 400x225 = 90,000.
  assert.deepEqual(f.seen, [[800, 450, 60], [400, 225, 60]]);
  assert.equal(r.encodes, 2);
  assert.equal(r.overBudget, false);
  assert.equal(r.width, 400);
});

test('fitJpeg stops after three encodes, and reports a JPEG still over the cap', () => {
  const bmp = parseBmp(writeBmp(solid(800, 450, [5, 5, 5])));
  const f = fakeEncoder(50_000);
  const r = fitJpeg(bmp, { maxEdge: 960, capBytes: 60_000, minEdge: 100 }, f.encode);
  // 410,000 bytes -> edge 290 (97,270 bytes) -> edge 216 (76,352 bytes), still over: stop.
  assert.deepEqual(f.seen.map(([w, h]) => [w, h]), [[800, 450], [290, 163], [216, 122]]);
  assert.equal(r.encodes, 3);
  assert.equal(r.overBudget, true);
  assert.equal(r.jpeg.length, 76_352);
});

test('fitJpeg never goes below minEdge and never upscales', () => {
  const f = fakeEncoder();
  const r = fitJpeg(parseBmp(writeBmp(solid(800, 450, [5, 5, 5]))), { maxEdge: 960, capBytes: 1_000, minEdge: 320 }, f.encode);
  assert.deepEqual(f.seen.map(([w]) => w), [800, 320], 'the first shrink lands on minEdge, which ends the loop');
  assert.equal(r.encodes, 2);
  assert.equal(r.overBudget, true);

  const small = fakeEncoder();
  const s = fitJpeg(parseBmp(writeBmp(solid(200, 100, [5, 5, 5]))), { maxEdge: 960, capBytes: 1, minEdge: 320 }, small.encode);
  assert.deepEqual(small.seen.map(([w, h]) => [w, h]), [[200, 100]], 'a source smaller than minEdge is encoded once at its own size');
  assert.equal(s.overBudget, true);
});

test('fitJpeg with the real encoder: the reported size is the JPEG size, and overBudget matches it', () => {
  // Deterministic noise, the worst case for JPEG size.
  let seed = 1;
  const noise: Rgb[][] = Array.from({ length: 360 }, () =>
    Array.from({ length: 640 }, (): Rgb => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return [seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff];
    }),
  );
  const cap = 40_000;
  const r = fitJpeg(parseBmp(writeBmp(noise)), { maxEdge: 640, capBytes: cap, minEdge: 160 });
  const back = decode(r.jpeg, { useTArray: true });
  assert.deepEqual([back.width, back.height], [r.width, r.height]);
  assert.ok(r.encodes > 1, 'noise at 640x360 is over 40 KB, so it was shrunk');
  assert.ok(r.width < 640);
  assert.equal(r.overBudget, r.jpeg.length > cap);
});
