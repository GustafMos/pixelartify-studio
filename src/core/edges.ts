/**
 * Edge detection used by the edge-aware sampler and the detail extractor.
 * Sobel gradients + non-maximum suppression + percentile thresholding,
 * following the approach popularised by pixel-mosaic (MIT).
 */

import type { PixelImage, MaskData } from './types';
import { clamp01 } from './color';

export interface EdgeMap {
  width: number;
  height: number;
  /** Normalized gradient magnitude after non-maximum suppression, 0..1. */
  data: Float32Array;
  /** Integral image of `data`, stride width+1. */
  integral: Float64Array;
}

export interface EdgeOptions {
  /** 0 = only the strongest edges, 1 = a dense edge map. */
  sensitivity: number;
  /** Also detect chroma edges rather than luminance only. */
  chroma?: boolean;
}

export function buildEdgeMap(img: PixelImage, options: EdgeOptions): EdgeMap {
  const { width: w, height: h, data } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  let maxMag = 0;

  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const tl = gray[ym * w + xm];
      const tc = gray[ym * w + x];
      const tr = gray[ym * w + xp];
      const ml = gray[y * w + xm];
      const mr = gray[y * w + xp];
      const bl = gray[yp * w + xm];
      const bc = gray[yp * w + x];
      const br = gray[yp * w + xp];

      let dx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      let dy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      if (options.chroma) {
        // Add a chroma gradient term so saturated edges survive.
        const i = (y * w + x) * 4;
        const ar = data[i];
        const ag = data[i + 1];
        const ab = data[i + 2];
        const iL = (y * w + (x > 0 ? x - 1 : x)) * 4;
        const iR = (y * w + (x < w - 1 ? x + 1 : x)) * 4;
        const iU = ((y > 0 ? y - 1 : y) * w + x) * 4;
        const iD = ((y < h - 1 ? y + 1 : y) * w + x) * 4;
        const dr = data[iR] - data[iL];
        const dg = data[iR + 1] - data[iL + 1];
        const db = data[iR + 2] - data[iL + 2];
        const ur = data[iD] - data[iU];
        const ug = data[iD + 1] - data[iU + 1];
        const ub = data[iD + 2] - data[iU + 2];
        dx += (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) * 0.15;
        dy += (Math.abs(ur) + Math.abs(ug) + Math.abs(ub)) * 0.15;
        void ar;
        void ag;
        void ab;
      }

      gx[y * w + x] = dx;
      gy[y * w + x] = dy;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > maxMag) maxMag = mag;
    }
  }

  // Non-maximum suppression along the gradient direction.
  const nms = new Float32Array(w * h);
  if (maxMag > 0) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const dx = gx[p];
        const dy = gy[p];
        const mag = Math.sqrt(dx * dx + dy * dy) / maxMag;
        if (mag < 0.02) continue;

        const nx = Math.abs(dx) >= Math.abs(dy) ? 1 : 0;
        const ny = 1 - nx;
        const sx = dx >= 0 ? nx : -nx;
        const sy = dy >= 0 ? ny : -ny;

        const n1 = Math.sqrt(gx[(y - sy) * w + (x - sx)] ** 2 + gy[(y - sy) * w + (x - sx)] ** 2) / maxMag;
        const n2 = Math.sqrt(gx[(y + sy) * w + (x + sx)] ** 2 + gy[(y + sy) * w + (x + sx)] ** 2) / maxMag;
        if (mag >= n1 && mag >= n2) nms[p] = mag;
      }
    }
  }

  // Percentile threshold: sensitivity 0 keeps the top ~2%, 1 keeps ~20%.
  const keepFraction = 0.02 + clamp01(options.sensitivity) * 0.18;
  const hist = new Uint32Array(1025);
  for (let i = 0; i < nms.length; i++) hist[Math.min(1024, Math.round(nms[i] * 1024))]++;
  const total = w * h;
  const target = total * (1 - keepFraction);
  let acc = 0;
  let cut = 1024;
  for (let i = 0; i <= 1024; i++) {
    acc += hist[i];
    if (acc >= target) {
      cut = i;
      break;
    }
  }
  const threshold = cut / 1024;

  const out = new Float32Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    out[i] = nms[i] >= threshold ? nms[i] : 0;
  }

  // Integral image for fast region queries.
  const stride = w + 1;
  const integral = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const base = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < w; x++) {
      row += out[y * w + x];
      integral[base + x + 1] = integral[prev + x + 1] + row;
    }
  }

  return { width: w, height: h, data: out, integral };
}

export function edgeRectSum(edges: EdgeMap, x0: number, y0: number, x1: number, y1: number): number {
  const stride = edges.width + 1;
  const ax = Math.max(0, Math.min(edges.width, Math.floor(x0)));
  const ay = Math.max(0, Math.min(edges.height, Math.floor(y0)));
  const bx = Math.max(0, Math.min(edges.width, Math.ceil(x1)));
  const by = Math.max(0, Math.min(edges.height, Math.ceil(y1)));
  if (bx <= ax || by <= ay) return 0;
  const i00 = ay * stride + ax;
  const i10 = ay * stride + bx;
  const i01 = by * stride + ax;
  const i11 = by * stride + bx;
  return edges.integral[i11] - edges.integral[i10] - edges.integral[i01] + edges.integral[i00];
}

/** Convert an edge map to a soft coverage mask. */
export function edgeMapToMask(edges: EdgeMap, threshold: number, dilate = 1): MaskData {
  const { width: w, height: h } = edges;
  const t = Math.max(0.01, threshold);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = edges.data[i] >= t ? Math.round(Math.min(1, edges.data[i] / t) * 255) : 0;
  }
  if (dilate > 0) {
    const r = Math.max(1, Math.round(dilate));
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) v = Math.max(v, mask[y * w + Math.max(0, Math.min(w - 1, x + k))]);
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) v = Math.max(v, tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x]);
        mask[y * w + x] = v;
      }
    }
  }
  return { width: w, height: h, data: mask };
}
