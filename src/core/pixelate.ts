/**
 * Edge-aware pixel-art sampler.
 *
 * Instead of forcing a rigid grid across the image, each output cell searches
 * for a sampling window that avoids cutting through strong edges, then blends a
 * soft area average with the dominant local colour. Inspired by pixel-mosaic
 * (Yogthos, MIT) and the classic Kuwahara/edge-preserving literature.
 *
 * All search radii are fractions of a cell, so the result is independent of the
 * source resolution.
 */

import type { PixelImage, PixelateSettings } from './types';
import { clamp, clamp01, lerp } from './color';
import {
  buildIntegral,
  createImage,
  meanRect,
  sampleBilinear,
  unsharpMask,
  type Integral,
} from './image';
import { buildEdgeMap, edgeRectSum, type EdgeMap } from './edges';

export interface PixelateSourceOptions {
  artWidth: number;
  artHeight: number;
  settings: PixelateSettings;
}

export interface PixelateResult {
  image: PixelImage;
  usedEdgeMap: boolean;
}

const SEARCH_STEPS = [-0.42, -0.21, 0, 0.21, 0.42];

export function pixelateImage(src: PixelImage, options: PixelateSourceOptions): PixelateResult {
  const { artWidth, artHeight, settings } = options;
  const w = Math.max(2, Math.round(artWidth));
  const h = Math.max(2, Math.round(artHeight));
  const out = createImage(w, h);
  const integral = buildIntegral(src);
  const cellW = src.width / w;
  const cellH = src.height / h;
  const useEdges = settings.edgeAware && settings.alignment > 0.001;

  let edges: EdgeMap | null = null;
  if (useEdges) {
    edges = buildEdgeMap(src, {
      sensitivity: clamp01(settings.edgeThreshold),
      chroma: true,
    });
  }

  // Offset field in source pixels. Computed once, then smoothed to keep the
  // warp coherent between neighbouring cells.
  let offsets: Float32Array | null = null;
  if (edges && useEdges) {
    offsets = new Float32Array(w * h * 2);
    const alignment = clamp01(settings.alignment);
    const searchX = cellW * alignment;
    const searchY = cellH * alignment;
    const halfW = cellW * 0.5;
    const halfH = cellH * 0.5;
    const winW = cellW * 0.98;
    const winH = cellH * 0.98;

    for (let y = 0; y < h; y++) {
      const cy = (y + 0.5) * cellH;
      for (let x = 0; x < w; x++) {
        const cx = (x + 0.5) * cellW;
        const p = y * w + x;

        // Fast path: no edges anywhere near this cell.
        const probe = edgeRectSum(
          edges,
          cx - cellW * 0.9,
          cy - cellH * 0.9,
          cx + cellW * 0.9,
          cy + cellH * 0.9,
        );
        if (probe <= 1e-6) continue;

        let bestScore = Infinity;
        let bestDx = 0;
        let bestDy = 0;
        for (const sy of SEARCH_STEPS) {
          const dy = sy * searchY;
          for (const sx of SEARCH_STEPS) {
            const dx = sx * searchX;
            const left = cx + dx - halfW;
            const top = cy + dy - halfH;
            const edgeSum = edgeRectSum(edges, left, top, left + winW, top + winH);
            const area = winW * winH;
            const fracX = dx / Math.max(1e-6, cellW);
            const fracY = dy / Math.max(1e-6, cellH);
            const regularize = 0.055 * (fracX * fracX + fracY * fracY);
            const score = edgeSum / area + regularize;
            if (score < bestScore) {
              bestScore = score;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }
        offsets[p * 2] = bestDx;
        offsets[p * 2 + 1] = bestDy;
      }
    }

    const passes = clamp(Math.round(settings.gridPasses), 0, 4);
    for (let i = 0; i < passes; i++) offsets = smoothOffsets(offsets, w, h);
  }

  const colorBlend = clamp01(settings.colorBlend);
  const alphaThreshold = clamp01(settings.alphaThreshold) * 255;
  const dominant = colorBlend > 0.01 && cellW > 1.2 && cellH > 1.2;
  const sampleGrid = cellW * cellH > 64 ? 5 : 3;
  const keys = new Int32Array(sampleGrid * sampleGrid);
  const counts = new Uint16Array(sampleGrid * sampleGrid);
  const sumR = new Float32Array(sampleGrid * sampleGrid);
  const sumG = new Float32Array(sampleGrid * sampleGrid);
  const sumB = new Float32Array(sampleGrid * sampleGrid);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const ox = offsets ? offsets[p * 2] : 0;
      const oy = offsets ? offsets[p * 2 + 1] : 0;
      const cx = (x + 0.5) * cellW + ox;
      const cy = (y + 0.5) * cellH + oy;

      // Sampling window (mostly cell-sized, so adjacent cells do not overlap).
      const halfW = cellW * 0.49;
      const halfH = cellH * 0.49;
      const rect = {
        x0: cx - halfW,
        y0: cy - halfH,
        x1: cx + halfW,
        y1: cy + halfH,
      };
      const mean = meanRect(integral, rect);

      let r = mean.r;
      let g = mean.g;
      let b = mean.b;

      if (dominant) {
        // Histogram of a 3x3 or 5x5 sample grid, used to recover the dominant
        // local colour on either side of an edge.
        keys.fill(-1);
        counts.fill(0);
        sumR.fill(0);
        sumG.fill(0);
        sumB.fill(0);
        let bins = 0;

        for (let gy = 0; gy < sampleGrid; gy++) {
          const sy = rect.y0 + ((gy + 0.5) / sampleGrid) * (rect.y1 - rect.y0);
          for (let gx = 0; gx < sampleGrid; gx++) {
            const sx = rect.x0 + ((gx + 0.5) / sampleGrid) * (rect.x1 - rect.x0);
            const s = sampleBilinear(src, sx, sy);
            if (s.a < 16) continue;
            const key = ((Math.round(s.r) >> 3) << 10) | ((Math.round(s.g) >> 3) << 5) | (Math.round(s.b) >> 3);
            let found = -1;
            for (let k = 0; k < bins; k++) {
              if (keys[k] === key) {
                found = k;
                break;
              }
            }
            if (found < 0) {
              found = bins++;
              keys[found] = key;
            }
            counts[found]++;
            sumR[found] += s.r;
            sumG[found] += s.g;
            sumB[found] += s.b;
          }
        }

        if (bins > 0) {
          let bestBin = 0;
          for (let k = 1; k < bins; k++) if (counts[k] > counts[bestBin]) bestBin = k;
          const n = Math.max(1, counts[bestBin]);
          const dr = sumR[bestBin] / n;
          const dg = sumG[bestBin] / n;
          const db = sumB[bestBin] / n;
          r = lerp(r, dr, colorBlend);
          g = lerp(g, dg, colorBlend);
          b = lerp(b, db, colorBlend);
        }
      }

      const o = p * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      const alpha = mean.a * 255;
      out.data[o + 3] = alpha < alphaThreshold ? 0 : alpha;
    }
  }

  let image = out;
  if (settings.postSharpen > 0.001) {
    image = unsharpMask(image, 0.75, settings.postSharpen);
  }
  if (alphaThreshold > 0) {
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] < alphaThreshold) image.data[i] = 0;
    }
  }

  return { image, usedEdgeMap: useEdges };
}

function smoothOffsets(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  const at = (x: number, y: number, c: number): number => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return src[(yy * w + xx) * 2 + c];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 2;
      for (let c = 0; c < 2; c++) {
        const center = at(x, y, c) * 4;
        const axial = at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c);
        const diag =
          at(x - 1, y - 1, c) +
          at(x + 1, y - 1, c) +
          at(x - 1, y + 1, c) +
          at(x + 1, y + 1, c);
        out[p + c] = (center + axial * 2 + diag) / 16;
      }
    }
  }
  return out;
}

/** Fast nearest-colour fill used by simple/naive modes. */
export function pixelateNaive(
  src: PixelImage,
  artWidth: number,
  artHeight: number,
): PixelImage {
  const w = Math.max(2, Math.round(artWidth));
  const h = Math.max(2, Math.round(artHeight));
  const int = buildIntegral(src);
  const out = createImage(w, h);
  const cw = src.width / w;
  const ch = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mean = meanRect(int, {
        x0: x * cw,
        y0: y * ch,
        x1: (x + 1) * cw,
        y1: (y + 1) * ch,
      });
      const i = (y * w + x) * 4;
      out.data[i] = mean.r;
      out.data[i + 1] = mean.g;
      out.data[i + 2] = mean.b;
      out.data[i + 3] = mean.a * 255;
    }
  }
  return out;
}
