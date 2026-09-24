// jpeg-js ships types for its index only, and the index also loads the decoder. src/image.ts
// imports the encoder file on its own, so only the encoder is bundled; this gives that path the
// index's `encode` type (lib/encoder.js ends with `module.exports = encode`).
declare module 'jpeg-js/lib/encoder.js' {
  import type { encode } from 'jpeg-js';
  const jpegEncode: typeof encode;
  export = jpegEncode;
}
