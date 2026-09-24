// BMP writers for the image and capture tests. Resolve's ExportCurrentFrameAsStill writes a 14-byte
// file header, a 40-byte BITMAPINFOHEADER, 24 bits per pixel, BI_RGB, bottom-up rows (measured
// 2026-09-24); writeBmp can also write the variants parseBmp accepts.

export type Rgb = [number, number, number];

/**
 * A BMP of `rows` (top row first). Padding bytes are 0xEE and the fourth byte of a 32-bit pixel is
 * 0xAA, so a parser that reads either shows it in the pixels.
 */
export function writeBmp(rows: Rgb[][], opts: { bits?: 24 | 32; topDown?: boolean; dibSize?: number } = {}): Buffer {
  const bits = opts.bits ?? 24;
  const dibSize = opts.dibSize ?? 40;
  const height = rows.length;
  const width = rows[0]!.length;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const offset = 14 + dibSize;
  const buf = header(width, opts.topDown ? -height : height, bits, dibSize, stride * height);
  buf.fill(0xee, offset);
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

export function solid(width: number, height: number, rgb: Rgb): Rgb[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => rgb));
}

/**
 * A frame in Resolve's layout filled with deterministic noise (the worst case for JPEG size),
 * written straight into the buffer so a 1080p frame costs no per-pixel arrays.
 */
export function noiseBmp(width: number, height: number, seed: number): Buffer {
  const stride = Math.ceil((width * 24) / 32) * 4;
  const buf = header(width, height, 24, 40, stride * height);
  let s = seed >>> 0 || 1;
  for (let row = 0; row < height; row++) {
    let p = 54 + row * stride;
    for (let x = 0; x < width * 3; x++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      buf[p++] = s >>> 24;
    }
  }
  return buf;
}

function header(width: number, height: number, bits: number, dibSize: number, pixelBytes: number): Buffer {
  const offset = 14 + dibSize;
  const buf = Buffer.alloc(offset + pixelBytes);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(dibSize, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bits, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelBytes, 34);
  return buf;
}
