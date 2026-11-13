/**
 * Region-of-interest masks (Davinci Fusion-style "bounds") and masking helpers.
 *
 * A region restricts a node's effect to a rectangle or ellipse; an optional
 * connected mask refines it further. Both produce an 8-bit coverage mask that
 * the pipeline uses to blend an effect's result over its input.
 */

import type { MaskData, PixelImage, RegionSettings } from './types';
import { createImage } from './image';

export const DEFAULT_REGION: RegionSettings = {
  enabled: false,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  shape: 'rect',
  feather: 0,
  invert: false,
};

/** Build a coverage mask from a normalized region at the given size. */
export function regionMask(width: number, height: number, region: RegionSettings): MaskData {
  const mask: MaskData = { width, height, data: new Uint8Array(width * height) };
  if (!region.enabled) {
    mask.data.fill(255);
    return mask;
  }
  const x0 = region.x * width;
  const y0 = region.y * height;
  const x1 = (region.x + region.width) * width;
  const y1 = (region.y + region.height) * height;
  const feather = Math.max(0, region.feather * Math.min(width, height));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(0.5, (x1 - x0) / 2);
  const ry = Math.max(0.5, (y1 - y0) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside: number;
      if (region.shape === 'ellipse') {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const dist = Math.sqrt(nx * nx + ny * ny) - 1;
        inside = dist <= 0 ? 1 : 0;
        if (dist > 0 && feather > 0) inside = Math.max(0, 1 - dist * (rx / feather));
      } else {
        const dx = Math.max(x0 - (x + 0.5), (x + 0.5) - x1, 0);
        const dy = Math.max(y0 - (y + 0.5), (y + 0.5) - y1, 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        inside = dist <= 0 ? 1 : 0;
        if (dist > 0 && feather > 0) inside = Math.max(0, 1 - dist / feather);
      }
      if (region.invert) inside = 1 - inside;
      mask.data[y * width + x] = Math.round(Math.max(0, Math.min(1, inside)) * 255);
    }
  }
  return mask;
}

/** Intersect two same-size masks (a connected mask × a region mask). */
export function intersectMasks(a: MaskData, b: MaskData): MaskData {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const out: MaskData = { width: w, height: h, data: new Uint8Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    out.data[i] = Math.min(a.data[i], b.data[i]);
  }
  return out;
}

/** Blend `modified` over `base` according to a same-size coverage mask. */
export function restrictToMask(base: PixelImage, modified: PixelImage, mask: MaskData): PixelImage {
  const out = createImage(base.width, base.height);
  const n = base.width * base.height;
  for (let i = 0; i < n; i++) {
    const t = mask.data[i] / 255;
    const bi = i * 4;
    out.data[bi] = base.data[bi] + (modified.data[bi] - base.data[bi]) * t;
    out.data[bi + 1] = base.data[bi + 1] + (modified.data[bi + 1] - base.data[bi + 1]) * t;
    out.data[bi + 2] = base.data[bi + 2] + (modified.data[bi + 2] - base.data[bi + 2]) * t;
    out.data[bi + 3] = base.data[bi + 3] + (modified.data[bi + 3] - base.data[bi + 3]) * t;
  }
  return out;
}
