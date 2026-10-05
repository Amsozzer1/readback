import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { PNG } from "pngjs";

/** Encodes PNG screenshots (all the same size) into an animated GIF, in pure JS. */
export function encodeGif(frames: { png: Buffer; delayMs: number }[]): Buffer {
  const gif = GIFEncoder();
  for (const { png, delayMs } of frames) {
    const { width, height, data } = PNG.sync.read(png);
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: delayMs });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
