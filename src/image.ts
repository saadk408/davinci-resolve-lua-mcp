/*!
 * capture_frame encodes its JPEGs with the encoder of jpeg-js 0.4.4 (lib/encoder.js only; the
 * decoder is not bundled), used under these two licences.
 *
 * jpeg-js:
 *
 * Copyright (c) 2014, Eugene Ware
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of Eugene Ware nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY EUGENE WARE ''AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL EUGENE WARE BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * lib/encoder.js, a port of the as3corelib JPEG encoder by Andreas Ritter, www.bytestrom.eu, 11/2009:
 *
 * Copyright (c) 2008, Adobe Systems Incorporated
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * * Neither the name of Adobe Systems Incorporated nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
 * IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// BMP in, JPEG out, for capture_frame. Resolve exports the frame under the playhead at the
// timeline resolution with no size control, so this module reads that BMP, shrinks it by area
// averaging and encodes a JPEG small enough for a tool result. Pure functions over buffers, no
// I/O; malformed input throws an ImageError, which capture.ts turns into a failed frame.
//
// Measured on Resolve 21.1 free (2026-09-24): ExportCurrentFrameAsStill writes a 14-byte file
// header and a 40-byte BITMAPINFOHEADER, 24 bits per pixel, BI_RGB, bottom-up rows, BGR order.
// The parser also takes 32-bit pixels, top-down rows and the V4/V5 headers, uncompressed only.

import jpegEncode from 'jpeg-js/lib/encoder.js';

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export interface Bmp {
  width: number;
  height: number;
  bitsPerPixel: 24 | 32;
  /** The header's height is negative: the first stored row is the top one. */
  topDown: boolean;
  /** Bytes per stored row, padded to a multiple of 4. */
  stride: number;
  /** The pixel array, stride * height bytes: B, G, R per pixel, plus an unused byte at 32 bits. */
  pixels: Buffer;
}

/** RGBA pixels, alpha 255, top row first: what the JPEG encoder takes. */
export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

export interface FitResult {
  jpeg: Buffer;
  width: number;
  height: number;
  /** How many times the frame was encoded, 1 to 3. */
  encodes: number;
  /** Still larger than capBytes after the last encode. */
  overBudget: boolean;
}

const FILE_HEADER_BYTES = 14;
const DIB_HEADER_SIZES = [40, 108, 124]; // BITMAPINFOHEADER, BITMAPV4HEADER, BITMAPV5HEADER
const MAX_SIDE = 16384;
const JPEG_QUALITY = 75;
const MAX_ENCODES = 3;

/** The header fields and pixel array of an uncompressed 24- or 32-bit BMP. */
export function parseBmp(buf: Buffer): Bmp {
  if (buf.length < FILE_HEADER_BYTES + 40) throw new ImageError(`not a BMP file (${buf.length} bytes, shorter than its headers)`);
  const magic = buf.toString('latin1', 0, 2);
  if (magic !== 'BM') throw new ImageError(`not a BMP file (magic ${JSON.stringify(magic)})`);
  const offset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  if (!DIB_HEADER_SIZES.includes(dibSize)) throw new ImageError(`unsupported BMP header size ${dibSize}`);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const planes = buf.readUInt16LE(26);
  const bits = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (width < 1 || width > MAX_SIDE) throw new ImageError(`unsupported BMP width ${width} (1-${MAX_SIDE})`);
  if (height < 1 || height > MAX_SIDE) throw new ImageError(`unsupported BMP height ${rawHeight} (1-${MAX_SIDE}, negative for top-down)`);
  if (planes !== 1) throw new ImageError(`unsupported BMP plane count ${planes}`);
  if (bits !== 24 && bits !== 32) throw new ImageError(`unsupported BMP depth of ${bits} bits per pixel (24 or 32)`);
  if (compression !== 0) throw new ImageError(`unsupported BMP compression ${compression}`);
  if (offset < FILE_HEADER_BYTES + dibSize) throw new ImageError(`BMP pixel offset ${offset} points inside its headers`);
  const stride = Math.ceil((width * bits) / 32) * 4;
  const size = stride * height;
  if (offset + size > buf.length) {
    throw new ImageError(`BMP is truncated: ${width}x${height} at ${bits} bits needs ${offset + size} bytes, the file has ${buf.length}`);
  }
  return { width, height, bitsPerPixel: bits === 24 ? 24 : 32, topDown: rawHeight < 0, stride, pixels: buf.subarray(offset, offset + size) };
}

/** The size that fits inside maxEdge with the aspect ratio kept; never larger than the source. */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const s = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/**
 * Output cell i of n covers source cells [start[i], end[i]). When shrinking, the cells tile the
 * source, so every source pixel is read once.
 */
function boxes(src: number, n: number): { start: Uint32Array; end: Uint32Array } {
  const start = new Uint32Array(n);
  const end = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * src) / n);
    start[i] = a;
    end[i] = Math.max(Math.floor(((i + 1) * src) / n), a + 1);
  }
  return { start, end };
}

/** The BMP shrunk to fit maxEdge by averaging each output pixel's source box, as top-first RGBA. */
export function downscaleToRgba(bmp: Bmp, maxEdge: number): Rgba {
  const { width: W, height: H, stride, pixels, topDown } = bmp;
  const bpp = bmp.bitsPerPixel / 8;
  const { width: w, height: h } = fitSize(W, H, maxEdge);
  const cols = boxes(W, w);
  const rows = boxes(H, h);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = rows.start[y]!;
    const y1 = rows.end[y]!;
    for (let x = 0; x < w; x++) {
      const x0 = cols.start[x]!;
      const x1 = cols.end[x]!;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = y0; sy < y1; sy++) {
        let p = (topDown ? sy : H - 1 - sy) * stride + x0 * bpp;
        for (let sx = x0; sx < x1; sx++, p += bpp) {
          b += pixels[p]!;
          g += pixels[p + 1]!;
          r += pixels[p + 2]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      data[o] = Math.round(r / n);
      data[o + 1] = Math.round(g / n);
      data[o + 2] = Math.round(b / n);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function encodeJpeg(img: Rgba, quality = JPEG_QUALITY): Buffer {
  return jpegEncode({ data: img.data, width: img.width, height: img.height }, quality).data;
}

/**
 * The frame as a JPEG no longer than capBytes where possible: encoded at maxEdge, then, while too
 * big, shrunk from the source BMP (never from the previous JPEG) by sqrt(capBytes / bytes) * 0.95
 * and encoded again, at most MAX_ENCODES times in all and never below minEdge.
 */
export function fitJpeg(
  bmp: Bmp,
  opts: { maxEdge: number; capBytes: number; minEdge: number; quality?: number },
  encode: (img: Rgba, quality: number) => Buffer = encodeJpeg,
): FitResult {
  const quality = opts.quality ?? JPEG_QUALITY;
  let edge = Math.min(opts.maxEdge, Math.max(bmp.width, bmp.height));
  let img = downscaleToRgba(bmp, edge);
  let jpeg = encode(img, quality);
  let encodes = 1;
  while (jpeg.length > opts.capBytes && encodes < MAX_ENCODES && edge > opts.minEdge) {
    edge = Math.max(opts.minEdge, Math.floor(edge * Math.sqrt(opts.capBytes / jpeg.length) * 0.95));
    img = downscaleToRgba(bmp, edge);
    jpeg = encode(img, quality);
    encodes++;
  }
  return { jpeg, width: img.width, height: img.height, encodes, overBudget: jpeg.length > opts.capBytes };
}
