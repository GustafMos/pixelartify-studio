/**
 * Frame retiming helpers.
 *
 * Optical flow here is a fast block-matching approximation intended for
 * stylised pixel-art output, not a production motion-estimation solver. It
 * estimates a dense displacement field on a downscaled copy of the two source
 * frames, then warps and blends the originals at the requested interpolation
 * point. Scene cuts and low-confidence blocks fall back to a cross-fade.
 */

import type { PixelImage } from './types';
import { createImage, resizeBox, sampleBilinear } from './image';

export type RetimeQuality = 'fast' | 'balanced' | 'best';

export interface FlowField {
  width: number;
  height: number;
  block: number;
  dx: Float32Array;
  dy: Float32Array;
}

const QUALITY: Record<RetimeQuality, { maxSide: number; radius: number }> = {
  fast: { maxSide: 120, radius: 4 },
  balanced: { maxSide: 160, radius: 6 },
  best: { maxSide: 220, radius: 8 },
};

function luma(img: PixelImage): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    out[p] = (img.data[i] * 54 + img.data[i + 1] * 183 + img.data[i + 2] * 19) >> 8;
  }
  return out;
}

/** Estimate a forward displacement field from `prev` to `next`. */
export function estimateFlow(
  prev: PixelImage,
  next: PixelImage,
  quality: RetimeQuality = 'balanced',
): FlowField {
  const config = QUALITY[quality];
  const scale = Math.min(1, config.maxSide / Math.max(prev.width, prev.height));
  const w = Math.max(8, Math.round(prev.width * scale));
  const h = Math.max(8, Math.round(next.height * scale));
  const smallPrev = w === prev.width && h === prev.height ? prev : resizeBox(prev, w, h);
  const smallNext = w === next.width && h === next.height ? next : resizeBox(next, w, h);
  const a = luma(smallPrev);
  const b = luma(smallNext);
  const block = 8;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const dx = new Float32Array(bw * bh);
  const dy = new Float32Array(bw * bh);
  const radius = config.radius;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * block;
      const y0 = by * block;
      let best = Number.POSITIVE_INFINITY;
      let bestDx = 0;
      let bestDy = 0;
      for (let sy = -radius; sy <= radius; sy++) {
        for (let sx = -radius; sx <= radius; sx++) {
          let sad = 0;
          let count = 0;
          for (let yy = 0; yy < block; yy += 2) {
            const y = y0 + yy;
            if (y >= h) break;
            for (let xx = 0; xx < block; xx += 2) {
              const x = x0 + xx;
              if (x >= w) break;
              const nx = Math.max(0, Math.min(w - 1, x + sx));
              const ny = Math.max(0, Math.min(h - 1, y + sy));
              sad += Math.abs(a[y * w + x] - b[ny * w + nx]);
              count++;
            }
          }
          if (count === 0) continue;
          const score = sad / count;
          if (score < best) {
            best = score;
            bestDx = sx;
            bestDy = sy;
          }
        }
      }
      // Low confidence (scene cut, occlusion) uses zero motion.
      const confidence = best < 24;
      dx[by * bw + bx] = confidence ? bestDx : 0;
      dy[by * bw + bx] = confidence ? bestDy : 0;
    }
  }

  // Light 3×3 smoothing keeps the warped image from tearing at block edges.
  const sx = new Float32Array(dx.length);
  const sy = new Float32Array(dy.length);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          const nx = x + xx;
          const ny = y + yy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          sumX += dx[ny * bw + nx];
          sumY += dy[ny * bw + nx];
          count++;
        }
      }
      sx[y * bw + x] = sumX / count;
      sy[y * bw + x] = sumY / count;
    }
  }

  return { width: bw, height: bh, block, dx: sx, dy: sy };
}

function flowAt(
  flow: FlowField,
  x: number,
  y: number,
  source: PixelImage,
): [number, number] {
  const bx = Math.max(
    0,
    Math.min(flow.width - 1, Math.floor((x / Math.max(1, source.width)) * flow.width)),
  );
  const by = Math.max(
    0,
    Math.min(flow.height - 1, Math.floor((y / Math.max(1, source.height)) * flow.height)),
  );
  const index = by * flow.width + bx;
  return [flow.dx[index], flow.dy[index]];
}

/** Interpolate between two frames. `t` is 0 = previous, 1 = next. */
export function interpolateFrame(
  prev: PixelImage,
  next: PixelImage,
  t: number,
  quality: RetimeQuality = 'balanced',
): PixelImage {
  const amount = Math.max(0, Math.min(1, t));
  if (prev === next || amount <= 0.0001) return prev;
  if (amount >= 0.9999) return next;
  if (prev.width !== next.width || prev.height !== next.height) {
    return resizeBox(prev, next.width, next.height);
  }

  const flow = estimateFlow(prev, next, quality);
  const scaleX = next.width / Math.max(1, flow.width * flow.block);
  const scaleY = next.height / Math.max(1, flow.height * flow.block);
  const out = createImage(next.width, next.height);
  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      const [fx, fy] = flowAt(flow, x, y, next);
      const dx = fx * scaleX;
      const dy = fy * scaleY;
      const p = sampleBilinear(prev, x - dx * amount, y - dy * amount);
      const n = sampleBilinear(next, x + dx * (1 - amount), y + dy * (1 - amount));
      const pa = p.a / 255;
      const na = n.a / 255;
      const i = (y * next.width + x) * 4;
      if (pa <= 0 && na <= 0) continue;
      if (pa <= 0) {
        out.data[i] = n.r;
        out.data[i + 1] = n.g;
        out.data[i + 2] = n.b;
        out.data[i + 3] = n.a;
        continue;
      }
      if (na <= 0) {
        out.data[i] = p.r;
        out.data[i + 1] = p.g;
        out.data[i + 2] = p.b;
        out.data[i + 3] = p.a;
        continue;
      }
      out.data[i] = p.r * (1 - amount) + n.r * amount;
      out.data[i + 1] = p.g * (1 - amount) + n.g * amount;
      out.data[i + 2] = p.b * (1 - amount) + n.b * amount;
      out.data[i + 3] = p.a * (1 - amount) + n.a * amount;
    }
  }
  return out;
}
