/**
 * Mask-aware inpainting for layer separation.
 *
 * The algorithm uses a push–pull / pyramid fill (Gortler et al. style) followed
 * by Jacobi diffusion, then optional dithered texture regeneration. It is
 * intentionally fast enough to run at interactive rates on a background layer
 * after a subject is cut out.
 */

import type { InpaintSettings, MaskData, PixelImage } from './types';
import { clamp, clamp01, lerp } from './color';
import {
  createImage,
  gaussianBlurRGBA,
  resizeBilinear,
  resizeMask,
} from './image';
import { blueNoiseMatrix, fbm2D } from './noise';

export interface InpaintOptions extends InpaintSettings {
  /** Used to scale the generated texture to art pixels. */
  artWidth: number;
  artHeight: number;
  seed?: number;
}

interface Level {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  m: Float32Array;
}

export function inpaintImage(
  img: PixelImage,
  mask: MaskData,
  options: InpaintOptions,
): PixelImage {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const sw = Math.max(8, Math.round(img.width * scale));
  const sh = Math.max(8, Math.round(img.height * scale));

  const small = resizeBilinear(img, sw, sh);
  const smallMask = resizeMask(mask, sw, sh);

  let levels: Level[] = [makeLevel(small, smallMask)];
  while (levels[levels.length - 1].w > 8 && levels[levels.length - 1].h > 8 && levels.length < 8) {
    levels.push(downsampleLevel(levels[levels.length - 1]));
  }

  // Coarsest: fill remaining holes with the mean known colour.
  const coarsest = levels[levels.length - 1];
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let i = 0; i < coarsest.w * coarsest.h; i++) {
    if (coarsest.m[i] < 0.5) {
      sr += coarsest.r[i];
      sg += coarsest.g[i];
      sb += coarsest.b[i];
      n++;
    }
  }
  if (n > 0) {
    sr /= n;
    sg /= n;
    sb /= n;
  } else {
    sr = 0.5;
    sg = 0.5;
    sb = 0.5;
  }
  for (let i = 0; i < coarsest.w * coarsest.h; i++) {
    if (coarsest.m[i] > 0.01) {
      coarsest.r[i] = sr;
      coarsest.g[i] = sg;
      coarsest.b[i] = sb;
    }
  }

  // Pull colours down the pyramid.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const i = y * fine.w + x;
        const m = fine.m[i];
        if (m <= 0.001) continue;
        const c = sampleLevel(coarse, (x + 0.5) / fine.w, (y + 0.5) / fine.h);
        const k = clamp01(m * 1.4);
        fine.r[i] = lerp(fine.r[i], c.r, k);
        fine.g[i] = lerp(fine.g[i], c.g, k);
        fine.b[i] = lerp(fine.b[i], c.b, k);
      }
    }
  }

  const fine = levels[0];

  // Directional/mirrored content fill. This preserves horizontal structure
  // (horizons, ground, mountain bands) much better than a global average.
  if (options.method === 'directional' || options.method === 'diffusion' || options.method === 'dither') {
    directionalFill(fine, options.seed ?? 0);
  }

  // Jacobi diffusion on the masked region (smooths the directional seams).
  if (options.method === 'directional' || options.method === 'diffusion' || options.method === 'dither') {
    const iterations = clamp(
      Math.round(options.iterations || 32),
      0,
      options.method === 'directional' ? 8 : 120,
    );
    const indices: number[] = [];
    for (let i = 0; i < fine.w * fine.h; i++) if (fine.m[i] > 0.01) indices.push(i);
    if (iterations > 0 && indices.length > 0) {
      let srcR: Float32Array = fine.r;
      let srcG: Float32Array = fine.g;
      let srcB: Float32Array = fine.b;
      let dstR: Float32Array = new Float32Array(srcR);
      let dstG: Float32Array = new Float32Array(srcG);
      let dstB: Float32Array = new Float32Array(srcB);
      for (let it = 0; it < iterations; it++) {
        for (const i of indices) {
          const x = i % fine.w;
          const y = (i / fine.w) | 0;
          let ar = 0;
          let ag = 0;
          let ab = 0;
          let aw = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const yy = y + oy;
            if (yy < 0 || yy >= fine.h) continue;
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const xx = x + ox;
              if (xx < 0 || xx >= fine.w) continue;
              const ni = yy * fine.w + xx;
              const wgt = (ox === 0 || oy === 0 ? 1 : 0.707) * (1 - fine.m[ni] * 0.85);
              ar += srcR[ni] * wgt;
              ag += srcG[ni] * wgt;
              ab += srcB[ni] * wgt;
              aw += wgt;
            }
          }
          if (aw > 0) {
            const k = options.method === 'directional' ? 0.35 : 0.75;
            dstR[i] = lerp(srcR[i], ar / aw, k);
            dstG[i] = lerp(srcG[i], ag / aw, k);
            dstB[i] = lerp(srcB[i], ab / aw, k);
          }
        }
        [srcR, dstR] = [dstR, srcR];
        [srcG, dstG] = [dstG, srcG];
        [srcB, dstB] = [dstB, srcB];
      }
      fine.r = srcR;
      fine.g = srcG;
      fine.b = srcB;
    }
  }

  // Convert the filled small image back to RGBA.
  const filled = createImage(fine.w, fine.h);
  for (let i = 0; i < fine.w * fine.h; i++) {
    const o = i * 4;
    filled.data[o] = fine.r[i] * 255;
    filled.data[o + 1] = fine.g[i] * 255;
    filled.data[o + 2] = fine.b[i] * 255;
    filled.data[o + 3] = 255;
  }

  // Texture / dithered regeneration inside the hole.
  const texture = clamp01(options.texture ?? 0.35);
  if (texture > 0.001) {
    const seed = options.seed ?? 0;
    const blue = blueNoiseMatrix();
    const bsize = Math.round(Math.sqrt(blue.length));
    const levelsCount = options.method === 'dither' ? 5 : 8;
    const strength = options.method === 'dither' ? 1 : 0.45;
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const i = y * fine.w + x;
        if (fine.m[i] < 0.02) continue;
        const o = i * 4;
        const n = fbm2D((x / fine.w) * 7, (y / fine.h) * 7, { octaves: 3, seed: seed + 5 });
        const grain = (n - 0.5) * 0.12 * texture;
        const t = blue[(y % bsize) * bsize + (x % bsize)] - 0.5;
        for (let c = 0; c < 3; c++) {
          let v = (filled.data[o + c] / 255 + grain) * 255;
          if (options.method === 'dither') {
            const q = Math.round(v / (255 / (levelsCount - 1)) + t * strength) * (255 / (levelsCount - 1));
            v = lerp(v, q, texture);
          } else {
            v += t * texture * 18;
          }
          filled.data[o + c] = clamp(v, 0, 255);
        }
      }
    }
  }

  if (options.radius > 0.5) {
    const r = Math.max(0.5, options.radius * (fine.w / Math.max(1, options.artWidth)));
    const blurred = gaussianBlurRGBA(filled, r);
    // Only use the blur inside the hole; keep original outside.
    for (let i = 0; i < fine.m.length; i++) {
      if (fine.m[i] < 0.05) continue;
      const o = i * 4;
      const k = clamp01(fine.m[i]);
      filled.data[o] = lerp(filled.data[o], blurred.data[o], k);
      filled.data[o + 1] = lerp(filled.data[o + 1], blurred.data[o + 1], k);
      filled.data[o + 2] = lerp(filled.data[o + 2], blurred.data[o + 2], k);
    }
  }

  // Upscale and composite only the masked region back into the full image.
  const up = resizeBilinear(filled, img.width, img.height);
  const fullMask = resizeMask(mask, img.width, img.height);
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      const m = fullMask.data[i] / 255;
      if (m <= 0.001) continue;
      const o = i * 4;
      out.data[o] = lerp(out.data[o], up.data[o], m);
      out.data[o + 1] = lerp(out.data[o + 1], up.data[o + 1], m);
      out.data[o + 2] = lerp(out.data[o + 2], up.data[o + 2], m);
      out.data[o + 3] = Math.max(out.data[o + 3], Math.round(255 * m));
    }
  }
  return out;
}

/**
 * Fill masked pixels from the nearest unmasked neighbours in four directions,
 * plus mirrored samples across the hole's bounding box. Only unmasked pixels
 * are read, so this can run in place.
 */
function directionalFill(level: Level, seed: number): void {
  const w = level.w;
  const h = level.h;
  const n = w * h;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (level.m[i] > 0.05) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      count++;
    }
  }
  if (count === 0) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const maxDist = Math.min(220, Math.max(24, Math.max(w, h)));
  const rng = seed || 1;
  const holeW = maxX - minX + 1;
  const holeH = maxY - minY + 1;
  // Pick ONE coherent background patch to clone. Averaging several offsets
  // produces a blurry double-exposure; a single patch preserves structure.
  const candidates: Array<[number, number]> = [
    [-Math.round(holeW * 1.05), 0],
    [0, -Math.round(holeH * 1.15)],
    [0, Math.round(holeH * 1.15)],
    [Math.round(holeW * 1.05), 0],
  ];
  let cloneOffset: [number, number] | null = null;
  let bestCoverage = 0.32;
  for (const [ox, oy] of candidates) {
    let covered = 0;
    let sampled = 0;
    for (let y = minY; y <= maxY; y += 3) {
      for (let x = minX; x <= maxX; x += 3) {
        if (level.m[y * w + x] <= 0.05) continue;
        sampled++;
        const sx = x + ox;
        const sy = y + oy;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && level.m[sy * w + sx] <= 0.05) covered++;
      }
    }
    const coverage = sampled > 0 ? covered / sampled : 0;
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      cloneOffset = [ox, oy];
    }
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if (level.m[i] <= 0.05) continue;

      let lx = -1;
      let ld = 0;
      let rx = -1;
      let rd = 0;
      let uy = -1;
      let ud = 0;
      let dy = -1;
      let dd = 0;

      for (let d = 1; d <= maxDist; d++) {
        if (lx < 0 && x - d >= 0 && level.m[y * w + x - d] <= 0.05) {
          lx = x - d;
          ld = d;
        }
        if (rx < 0 && x + d < w && level.m[y * w + x + d] <= 0.05) {
          rx = x + d;
          rd = d;
        }
        if (uy < 0 && y - d >= 0 && level.m[(y - d) * w + x] <= 0.05) {
          uy = y - d;
          ud = d;
        }
        if (dy < 0 && y + d < h && level.m[(y + d) * w + x] <= 0.05) {
          dy = y + d;
          dd = d;
        }
        if (lx >= 0 && rx >= 0 && uy >= 0 && dy >= 0) break;
      }

      let wr = 0;
      let wg = 0;
      let wb = 0;
      let ww = 0;

      const add = (r: number, g: number, b: number, weight: number): void => {
        if (weight <= 0) return;
        wr += r * weight;
        wg += g * weight;
        wb += b * weight;
        ww += weight;
      };

      const hPair = lx >= 0 && rx >= 0;
      const vPair = uy >= 0 && dy >= 0;
      if (hPair) {
        const t = ld / Math.max(1, ld + rd);
        const li = y * w + lx;
        const ri = y * w + rx;
        const diff =
          Math.abs(level.r[li] - level.r[ri]) +
          Math.abs(level.g[li] - level.g[ri]) +
          Math.abs(level.b[li] - level.b[ri]);
        add(
          lerp(level.r[li], level.r[ri], t),
          lerp(level.g[li], level.g[ri], t),
          lerp(level.b[li], level.b[ri], t),
          1 / (1 + (ld + rd) * 0.12 + diff * 2.4),
        );
      } else {
        if (lx >= 0) add(level.r[y * w + lx], level.g[y * w + lx], level.b[y * w + lx], 1 / (1 + ld * 0.2));
        if (rx >= 0) add(level.r[y * w + rx], level.g[y * w + rx], level.b[y * w + rx], 1 / (1 + rd * 0.2));
      }

      if (vPair) {
        const t = ud / Math.max(1, ud + dd);
        const ui = uy * w + x;
        const di = dy * w + x;
        const diff =
          Math.abs(level.r[ui] - level.r[di]) +
          Math.abs(level.g[ui] - level.g[di]) +
          Math.abs(level.b[ui] - level.b[di]);
        add(
          lerp(level.r[ui], level.r[di], t),
          lerp(level.g[ui], level.g[di], t),
          lerp(level.b[ui], level.b[di], t),
          1 / (1 + (ud + dd) * 0.12 + diff * 2.4),
        );
      } else {
        if (uy >= 0) add(level.r[uy * w + x], level.g[uy * w + x], level.b[uy * w + x], 1 / (1 + ud * 0.2));
        if (dy >= 0) add(level.r[dy * w + x], level.g[dy * w + x], level.b[dy * w + x], 1 / (1 + dd * 0.2));
      }

      // Clone one coherent background patch. This preserves mountain bands
      // and ground texture far better than a smooth interpolation.
      if (cloneOffset) {
        const [ox, oy] = cloneOffset;
        const sx = x + ox;
        const sy = y + oy;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const si = sy * w + sx;
          if (level.m[si] <= 0.05) {
            add(level.r[si], level.g[si], level.b[si], 3.2);
          }
        }
      }

      // Mirrored content across the hole centre brings texture/structure in.
      const mirrorH = 2 * cx - x;
      const mirrorV = 2 * cy - y;
      if (mirrorH >= 0 && mirrorH < w) {
        const mx = Math.round(mirrorH);
        const mi = y * w + mx;
        if (level.m[mi] <= 0.05) {
          add(level.r[mi], level.g[mi], level.b[mi], 0.55 / (1 + Math.abs(mx - x) * 0.15));
        }
      }
      if (mirrorV >= 0 && mirrorV < h) {
        const my = Math.round(mirrorV);
        const mi = my * w + x;
        if (level.m[mi] <= 0.05) {
          add(level.r[mi], level.g[mi], level.b[mi], 0.55 / (1 + Math.abs(my - y) * 0.15));
        }
      }

      if (ww > 0) {
        const jitter = (((x * 374761 + y * 668265 + rng * 1013) >>> 0) % 1000) / 1000 - 0.5;
        const j = jitter * 0.012;
        level.r[i] = wr / ww + j;
        level.g[i] = wg / ww + j;
        level.b[i] = wb / ww + j;
      }
    }
  }
}

function makeLevel(img: PixelImage, mask: MaskData): Level {
  const n = img.width * img.height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    r[i] = img.data[o] / 255;
    g[i] = img.data[o + 1] / 255;
    b[i] = img.data[o + 2] / 255;
    m[i] = mask.data[i] / 255;
  }
  return { w: img.width, h: img.height, r, g, b, m };
}

function downsampleLevel(level: Level): Level {
  const w = Math.max(1, Math.floor(level.w / 2));
  const h = Math.max(1, Math.floor(level.h / 2));
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  const m = new Float32Array(w * h);
  const sx = level.w / w;
  const sy = level.h / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(level.h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(level.w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sw = 0;
      let maxM = 0;
      let allR = 0;
      let allG = 0;
      let allB = 0;
      let allN = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = yy * level.w + xx;
          const mm = level.m[i];
          maxM = Math.max(maxM, mm);
          allR += level.r[i];
          allG += level.g[i];
          allB += level.b[i];
          allN++;
          const wgt = 1 - mm;
          sr += level.r[i] * wgt;
          sg += level.g[i] * wgt;
          sb += level.b[i] * wgt;
          sw += wgt;
        }
      }
      const o = y * w + x;
      if (sw > 1e-5) {
        r[o] = sr / sw;
        g[o] = sg / sw;
        b[o] = sb / sw;
      } else if (allN > 0) {
        r[o] = allR / allN;
        g[o] = allG / allN;
        b[o] = allB / allN;
      }
      m[o] = maxM;
    }
  }
  return { w, h, r, g, b, m };
}

function sampleLevel(level: Level, u: number, v: number): { r: number; g: number; b: number } {
  const fx = clamp(u * level.w - 0.5, 0, level.w - 1);
  const fy = clamp(v * level.h - 0.5, 0, level.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(level.w - 1, x0 + 1);
  const y1 = Math.min(level.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = y0 * level.w + x0;
  const i10 = y0 * level.w + x1;
  const i01 = y1 * level.w + x0;
  const i11 = y1 * level.w + x1;
  const r = lerp(lerp(level.r[i00], level.r[i10], tx), lerp(level.r[i01], level.r[i11], tx), ty);
  const g = lerp(lerp(level.g[i00], level.g[i10], tx), lerp(level.g[i01], level.g[i11], tx), ty);
  const b = lerp(lerp(level.b[i00], level.b[i10], tx), lerp(level.b[i01], level.b[i11], tx), ty);
  return { r, g, b };
}
