/**
 * Raster ↔ vector conversion, treating each pixel as an axis-aligned rectangle.
 *
 * `rasterToVector` merges same-colour runs into larger rectangles (scanline
 * run-length encoding); `vectorToRaster` renders the rectangles back to RGBA.
 */

import type { PixelImage, VectorData, VectorRect } from './types';
import { createImage } from './image';

export interface RasterizeParams {
  /** Merge same-colour runs into larger rectangles (1) or one rect per pixel (0). */
  merge: number;
  /** Skip fully transparent pixels. */
  skipTransparent: number;
}

export const DEFAULT_RASTERIZE: RasterizeParams = {
  merge: 1,
  skipTransparent: 1,
};

export function rasterToVector(image: PixelImage, params: Partial<RasterizeParams> = {}): VectorData {
  const p: RasterizeParams = { ...DEFAULT_RASTERIZE, ...params };
  const { width, height, data } = image;
  const rects: VectorRect[] = [];
  const skipTransparent = p.skipTransparent > 0.5;

  const colorAt = (x: number, y: number): [number, number, number, number] => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const colorKey = (c: [number, number, number, number]): string => c.join(',');

  if (p.merge > 0.5) {
    // Scanline run-length: merge horizontal runs, then merge identical runs vertically.
    type Run = { x: number; y: number; w: number; c: [number, number, number, number] };
    const rows: Run[][] = [];
    for (let y = 0; y < height; y++) {
      const row: Run[] = [];
      let x = 0;
      while (x < width) {
        const c = colorAt(x, y);
        if (skipTransparent && c[3] === 0) {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < width && colorKey(colorAt(x + w, y)) === colorKey(c)) w++;
        row.push({ x, y, w, c });
        x += w;
      }
      rows.push(row);
    }
    // Merge vertically identical adjacent runs.
    const merged: Array<Run & { h: number }> = [];
    for (const run of rows.flat()) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.y + last.h === run.y &&
        last.x === run.x &&
        last.w === run.w &&
        colorKey(last.c) === colorKey(run.c)
      ) {
        last.h++;
      } else {
        merged.push({ ...run, h: 1 });
      }
    }
    for (const r of merged) {
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, r: r.c[0], g: r.c[1], b: r.c[2], a: r.c[3] });
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = colorAt(x, y);
        if (skipTransparent && c[3] === 0) continue;
        rects.push({ x, y, w: 1, h: 1, r: c[0], g: c[1], b: c[2], a: c[3] });
      }
    }
  }

  return { width, height, rects };
}

export function vectorToRaster(data: VectorData): PixelImage {
  const out = createImage(Math.max(1, data.width), Math.max(1, data.height));
  for (const rect of data.rects) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(out.width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(out.height, Math.ceil(rect.y + rect.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * out.width + x) * 4;
        out.data[i] = rect.r;
        out.data[i + 1] = rect.g;
        out.data[i + 2] = rect.b;
        out.data[i + 3] = rect.a;
      }
    }
  }
  return out;
}
