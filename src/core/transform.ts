/**
 * Affine image transform for the Transform node.
 *
 * The transform maps source pixels into an output frame of the same size using
 * an inverse-mapped nearest-neighbour sample (crisp, pixel-art friendly).
 * Pixels that land outside the source become transparent.
 */

import type { MaskData, PixelImage } from './types';
import { createImage } from './image';

export interface TransformParams {
  /** Translation in art pixels (or normalized frame units). */
  x: number;
  y: number;
  /** Rotation in degrees, clockwise. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Shear factors (0 = no shear). */
  shearX: number;
  shearY: number;
  /** Pivot, normalized 0..1 relative to the frame. */
  pivotX: number;
  pivotY: number;
  /** Units for x/y translation. */
  unit: 'art' | 'normalized';
}

export const DEFAULT_TRANSFORM: TransformParams = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  pivotX: 0.5,
  pivotY: 0.5,
  unit: 'art',
};

interface InverseMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Inverse of the forward `R * S` matrix. Returns null when singular. */
function inverseMatrix(p: TransformParams): InverseMatrix | null {
  const rad = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Forward matrix A = R * S, where
  //   R = [[cos, -sin], [sin, cos]]
  //   S = [[scaleX, shearX], [shearY, scaleY]]
  const a = cos * p.scaleX - sin * p.shearY;
  const b = cos * p.shearX - sin * p.scaleY;
  const c = sin * p.scaleX + cos * p.shearY;
  const d = sin * p.shearX + cos * p.scaleY;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return { a: d / det, b: -b / det, c: -c / det, d: a / det };
}

function resolveTranslation(p: TransformParams, width: number, height: number): { tx: number; ty: number } {
  if (p.unit === 'normalized') {
    return { tx: p.x * width, ty: p.y * height };
  }
  return { tx: p.x, ty: p.y };
}

export function transformImage(image: PixelImage, params: TransformParams): PixelImage {
  const out = createImage(image.width, image.height);
  const inv = inverseMatrix(params);
  if (!inv) return out;
  const { tx, ty } = resolveTranslation(params, image.width, image.height);
  const px = params.pivotX * image.width;
  const py = params.pivotY * image.height;
  const src = image.data;
  const dst = out.data;

  for (let oy = 0; oy < image.height; oy++) {
    for (let ox = 0; ox < image.width; ox++) {
      const rx = ox - px - tx;
      const ry = oy - py - ty;
      const sx = Math.round(inv.a * rx + inv.b * ry + px);
      const sy = Math.round(inv.c * rx + inv.d * ry + py);
      const di = (oy * image.width + ox) * 4;
      if (sx >= 0 && sx < image.width && sy >= 0 && sy < image.height) {
        const si = (sy * image.width + sx) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      } else {
        dst[di] = 0;
        dst[di + 1] = 0;
        dst[di + 2] = 0;
        dst[di + 3] = 0;
      }
    }
  }
  return out;
}

export function transformMask(mask: MaskData, params: TransformParams): MaskData {
  const out: MaskData = { width: mask.width, height: mask.height, data: new Uint8Array(mask.data.length) };
  const inv = inverseMatrix(params);
  if (!inv) return out;
  const { tx, ty } = resolveTranslation(params, mask.width, mask.height);
  const px = params.pivotX * mask.width;
  const py = params.pivotY * mask.height;
  for (let oy = 0; oy < mask.height; oy++) {
    const ry = oy - py - ty;
    for (let ox = 0; ox < mask.width; ox++) {
      const rx = ox - px - tx;
      const sx = Math.round(inv.a * rx + inv.b * ry + px);
      const sy = Math.round(inv.c * rx + inv.d * ry + py);
      const di = oy * mask.width + ox;
      if (sx >= 0 && sx < mask.width && sy >= 0 && sy < mask.height) {
        out.data[di] = mask.data[sy * mask.width + sx];
      }
    }
  }
  return out;
}
