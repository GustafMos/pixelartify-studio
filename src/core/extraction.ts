/**
 * Feature extraction for layer separation.
 *
 * The saliency estimator combines a border colour model, a centre prior and
 * edge density. It is deliberately classical CV (no ML dependency) so the tool
 * stays fully offline and MIT-licensable. Chroma, luma and edge modes are also
 * available, and manual masks can be painted in the studio.
 */

import type { ExtractionSettings, MaskData, PixelImage } from './types';
import { clamp01, parseHex, rgbToOklab, type Lab } from './color';
import {
  createMask,
  dilateMask,
  erodeMask,
  featherMask,
  resizeBilinear,
  resizeMask,
} from './image';
import { buildEdgeMap } from './edges';

const MAX_MASK_SIDE = 768;

export function extractMask(img: PixelImage, settings: ExtractionSettings, artWidth: number): MaskData {
  if (settings.method === 'manual') {
    return createMask(
      Math.min(MAX_MASK_SIDE, img.width),
      Math.min(MAX_MASK_SIDE, img.height),
    );
  }

  const scale = Math.min(1, MAX_MASK_SIDE / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const small = scale < 1 ? resizeBilinear(img, w, h) : img;

  let mask: MaskData;
  switch (settings.method) {
    case 'chroma':
      mask = chromaMask(small, settings);
      break;
    case 'luma':
      mask = lumaMask(small, settings);
      break;
    case 'edge':
      mask = edgeMask(small, settings);
      break;
    case 'box':
      mask = boxMask(small, settings);
      break;
    case 'saliency':
    default:
      mask = saliencyMask(small, settings);
      break;
  }

  if (settings.invert) {
    for (let i = 0; i < mask.data.length; i++) mask.data[i] = 255 - mask.data[i];
  }

  // Preserve source transparency.
  for (let y = 0; y < mask.height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y / mask.height) * img.height));
    for (let x = 0; x < mask.width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x / mask.width) * img.width));
      const a = img.data[(sy * img.width + sx) * 4 + 3];
      mask.data[y * mask.width + x] = (mask.data[y * mask.width + x] * a) / 255;
    }
  }

  const featherPx = Math.max(0, settings.feather * (mask.width / Math.max(1, artWidth)));
  if (featherPx >= 0.5) mask = featherMask(mask, featherPx);

  return mask;
}

/* -------------------------------------------------------------------------- */
/* Saliency                                                                   */
/* -------------------------------------------------------------------------- */

function saliencyMask(img: PixelImage, settings: ExtractionSettings): MaskData {
  const w = img.width;
  const h = img.height;
  const n = w * h;

  const bg = borderClusters(img, 4);
  const edges = buildEdgeMap(img, { sensitivity: 0.45, chroma: true });
  const scores = new Float32Array(n);
  const colorDistances = new Float32Array(n);

  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const centerBias = clamp01(settings.centerBias) * 0.22;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r = img.data[p];
      const g = img.data[p + 1];
      const b = img.data[p + 2];
      const lab = rgbToOklab(r, g, b);

      let minDist = Infinity;
      for (const c of bg) {
        const dl = lab.L - c.L;
        const da = lab.a - c.a;
        const db = lab.b - c.b;
        const d = dl * dl + da * da * 1.5 + db * db * 1.5;
        if (d < minDist) minDist = d;
      }
      const bgScore = Math.sqrt(minDist);
      colorDistances[i] = bgScore;

      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const center = clamp01(1 - Math.sqrt(dx * dx + dy * dy) * 1.5);

      const edge = Math.min(1, edges.data[i] * 2.4);
      scores[i] = bgScore * 0.62 + center * centerBias + edge * 0.2;
    }
  }

  // Normalize by the 3rd..97th percentile range.
  const hist = new Uint32Array(1024);
  let maxScore = 0;
  for (let i = 0; i < n; i++) {
    if (scores[i] > maxScore) maxScore = scores[i];
  }
  maxScore = Math.max(1e-6, maxScore);
  for (let i = 0; i < n; i++) hist[Math.min(1023, Math.round((scores[i] / maxScore) * 1023))]++;
  const lowCut = Math.max(1, Math.floor(n * 0.03));
  const highCut = Math.max(lowCut + 1, Math.floor(n * 0.97));
  let acc = 0;
  let lo = 0;
  let hi = 1023;
  for (let i = 0; i < 1024; i++) {
    acc += hist[i];
    if (acc >= lowCut) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 1024; i++) {
    acc += hist[i];
    if (acc >= highCut) {
      hi = i;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  const lowV = (lo / 1023) * maxScore;
  const highV = (hi / 1023) * maxScore;

  const threshold = clamp01(settings.threshold);
  const mask = createMask(w, h);

  // Build a binary seed mask, close it to join limbs/features, then keep the
  // most object-like central component. This rejects landscapes that touch the
  // frame edge and produces far better subject cutouts than raw saliency.
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = clamp01((scores[i] - lowV) / Math.max(1e-6, highV - lowV));
    binary[i] = v >= threshold ? 1 : 0;
  }

  const seed = dilateMask(
    erodeMask(
      dilateMask({ width: w, height: h, data: binary.map((v) => v * 255) as unknown as Uint8Array }, 2),
      1,
    ),
    2,
  );

  const labels = new Int32Array(n);
  labels.fill(-1);
  const stats: Array<{
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    cx: number;
    cy: number;
    border: boolean;
    label: number;
  }> = [];
  const stack = new Int32Array(n);
  let label = 0;

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || seed.data[start] < 128) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let area = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let sx = 0;
    let sy = 0;
    let border = false;

    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) border = true;

      const neighbors = [p - 1, p + 1, p - w, p + w];
      for (const q of neighbors) {
        if (q < 0 || q >= n) continue;
        const qx = q % w;
        if (Math.abs(qx - x) > 1) continue;
        if (labels[q] === -1 && seed.data[q] >= 128) {
          labels[q] = label;
          stack[top++] = q;
        }
      }
    }

    if (area > 4) {
      stats.push({
        area,
        minX,
        minY,
        maxX,
        maxY,
        cx: sx / area,
        cy: sy / area,
        border,
        label,
      });
    }
    label++;
  }

  const maxDist = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);
  if (typeof process !== 'undefined' && process.env?.PIXELARTIFY_DEBUG) {
    console.log(
      'components',
      stats.map((s) => ({
        area: s.area,
        bbox: [s.minX, s.minY, s.maxX, s.maxY],
        center: [Math.round(s.cx), Math.round(s.cy)],
        border: s.border,
      })),
    );
  }
  let best: (typeof stats)[number] | null = null;
  let bestScore = -1;
  for (const s of stats) {
    const centerDist = Math.hypot(s.cx - w / 2, s.cy - h / 2) / maxDist;
    const areaRatio = s.area / n;
    if (areaRatio > 0.72) continue;
    const compactness = s.area / Math.max(1, (s.maxX - s.minX + 1) * (s.maxY - s.minY + 1));
    const score =
      Math.pow(areaRatio, 0.35) *
      Math.pow(Math.max(0, 1 - centerDist), 2.2) *
      (0.45 + compactness * 0.55) *
      (s.border ? 0.025 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  const selected = new Uint8Array(n);
  if (best && bestScore > 0) {
    const bw = best.maxX - best.minX;
    const bh = best.maxY - best.minY;
    const xPad = bw * 0.28 + 2;
    const yTop = best.minY - bh * 0.04;
    const yBottom = best.maxY + bh * 0.7 + 4;
    for (const s of stats) {
      // Keep detached limbs/feet below the main body, and overlapping parts
      // such as eyes, without pulling in distant clouds or sky.
      const aligned =
        s.cx >= best.minX - xPad &&
        s.cx <= best.maxX + xPad &&
        s.cy >= yTop &&
        s.cy <= yBottom;
      if (s.label === best.label || (aligned && s.area >= best.area * 0.015)) {
        for (let i = 0; i < n; i++) if (labels[i] === s.label) selected[i] = 255;
      }
    }
    // Grow the selection through the surrounding mid-saliency region so that
    // low-contrast parts (legs, dark hair, shadows) are included too.
    const rx0 = Math.max(0, Math.floor(best.minX - bw * 0.05));
    const rx1 = Math.min(w - 1, Math.ceil(best.maxX + bw * 0.05));
    const ry0 = Math.max(0, Math.floor(best.maxY - bh * 0.08));
    const ry1 = Math.min(h - 1, Math.ceil(best.maxY + bh * 0.55));
    const lowThreshold = Math.max(0.25, threshold - 0.18);
    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        const i = y * w + x;
        if (selected[i]) continue;
        const v = clamp01((scores[i] - lowV) / Math.max(1e-6, highV - lowV));
        if (v >= lowThreshold) selected[i] = 255;
      }
    }

    // Characters often have low-contrast legs/shadows below the main body.
    // Extend the mask a little below the subject so the background inpaint
    // removes them instead of leaving a ghost silhouette.
    const extBottom = Math.min(h - 1, Math.ceil(best.maxY + bh * 0.38));
    const extX0 = Math.max(0, Math.floor(best.minX - bw * 0.06));
    const extX1 = Math.min(w - 1, Math.ceil(best.maxX + bw * 0.06));
    for (let y = best.maxY; y <= extBottom; y++) {
      for (let x = extX0; x <= extX1; x++) {
        const i = y * w + x;
        // Select pixels that differ from the border background model. This
        // catches low-contrast legs without painting the surrounding ground.
        if (colorDistances[i] >= 0.1) selected[i] = 255;
      }
    }
  } else {
    selected.set(seed.data);
  }

  // Fill interior holes so outlines become a solid subject silhouette.
  const filled = fillHoles(selected, w, h);

  // Grow slightly to include anti-aliased edges, then feather.
  const grown = dilateMask(
    { width: w, height: h, data: filled },
    Math.max(1, Math.round(w * 0.012)),
  );
  // Selected components are solid; the caller applies the requested feather.
  for (let i = 0; i < n; i++) {
    mask.data[i] = grown.data[i] >= 128 ? 255 : 0;
  }

  return erodeMask(dilateMask(mask, 1), 1);
}

function borderClusters(img: PixelImage, k: number): Lab[] {
  const w = img.width;
  const h = img.height;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.045));
  const samples: Lab[] = [];
  const step = Math.max(1, Math.floor((w * h) / 3000));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const p = (y * w + x) * 4;
      if (img.data[p + 3] < 16) continue;
      samples.push(rgbToOklab(img.data[p], img.data[p + 1], img.data[p + 2]));
    }
  }
  if (samples.length === 0) return [{ L: 0.5, a: 0, b: 0 }];

  // Deterministic k-means over border colours.
  const centers: Lab[] = [];
  for (let i = 0; i < k; i++) {
    centers.push({ ...samples[Math.floor((i / k) * samples.length)] });
  }
  for (let it = 0; it < 8; it++) {
    const sums = Array.from({ length: k }, () => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (const s of samples) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const d = (s.L - c.L) ** 2 + (s.a - c.a) ** 2 * 1.5 + (s.b - c.b) ** 2 * 1.5;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      sums[best].L += s.L;
      sums[best].a += s.a;
      sums[best].b += s.b;
      sums[best].n++;
    }
    for (let i = 0; i < k; i++) {
      if (sums[i].n === 0) continue;
      centers[i] = {
        L: sums[i].L / sums[i].n,
        a: sums[i].a / sums[i].n,
        b: sums[i].b / sums[i].n,
      };
    }
  }
  return centers;
}

/* -------------------------------------------------------------------------- */
/* Other modes                                                                */
/* -------------------------------------------------------------------------- */

function chromaMask(img: PixelImage, settings: ExtractionSettings): MaskData {
  const key = parseHex(settings.keyColor || '#00ff00');
  const keyLab = rgbToOklab(key.r, key.g, key.b);
  const tolerance = Math.max(0.01, settings.tolerance);
  const softness = Math.max(0.01, settings.softness) * 0.6;
  const mask = createMask(img.width, img.height);

  for (let i = 0, p = 0; i < mask.data.length; i++, p += 4) {
    const lab = rgbToOklab(img.data[p], img.data[p + 1], img.data[p + 2]);
    const d = Math.sqrt((lab.L - keyLab.L) ** 2 + (lab.a - keyLab.a) ** 2 * 1.5 + (lab.b - keyLab.b) ** 2 * 1.5);
    // Distance from key: 0 = key colour (transparent), 1 = far (selected).
    const keep = smoothstep(tolerance * (1 - softness), tolerance * (1 + softness), d);
    mask.data[i] = Math.round(keep * 255);
  }
  return mask;
}

function lumaMask(img: PixelImage, settings: ExtractionSettings): MaskData {
  const mask = createMask(img.width, img.height);
  const lo = clamp01(settings.lumaMin);
  const hi = clamp01(settings.lumaMax);
  const soft = Math.max(0.005, settings.softness * 0.25);
  for (let i = 0, p = 0; i < mask.data.length; i++, p += 4) {
    const luma =
      (0.2126 * img.data[p] + 0.7152 * img.data[p + 1] + 0.0722 * img.data[p + 2]) / 255;
    const inside = smoothstep(lo - soft, lo + soft, luma) * (1 - smoothstep(hi - soft, hi + soft, luma));
    mask.data[i] = Math.round(clamp01(inside) * 255);
  }
  return mask;
}

function boxMask(img: PixelImage, settings: ExtractionSettings): MaskData {
  const w = img.width;
  const h = img.height;
  const mask = createMask(w, h);
  const x0 = clamp01(settings.boxX) * w;
  const y0 = clamp01(settings.boxY) * h;
  const bw = Math.max(1, clamp01(settings.boxWidth) * w);
  const bh = Math.max(1, clamp01(settings.boxHeight) * h);
  const cx = x0 + bw / 2;
  const cy = y0 + bh / 2;
  const soft = Math.max(0.005, settings.softness * 0.35);
  const ellipse = settings.boxShape !== 'rectangle';

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d: number;
      if (ellipse) {
        const nx = (x + 0.5 - cx) / (bw / 2);
        const ny = (y + 0.5 - cy) / (bh / 2);
        d = Math.sqrt(nx * nx + ny * ny);
      } else {
        const dx = Math.max(x0 - x, x - (x0 + bw), 0);
        const dy = Math.max(y0 - y, y - (y0 + bh), 0);
        d = Math.sqrt(dx * dx + dy * dy) / Math.max(1, Math.min(bw, bh) * 0.2);
      }
      const a = 1 - smoothstep(1 - soft, 1 + soft, d);
      mask.data[y * w + x] = Math.round(clamp01(a) * 255);
    }
  }
  return mask;
}

function edgeMask(img: PixelImage, settings: ExtractionSettings): MaskData {
  const edges = buildEdgeMap(img, { sensitivity: settings.threshold, chroma: true });
  const mask = createMask(img.width, img.height);
  const radius = Math.max(1, Math.round(1 + settings.softness * 4));
  for (let i = 0; i < mask.data.length; i++) {
    mask.data[i] = edges.data[i] > 0.03 ? Math.min(255, Math.round(edges.data[i] * 340)) : 0;
  }
  return dilateMask(mask, radius);
}

/** Fill enclosed holes in a binary mask. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const p = y * w + x;
    if (mask[p] >= 128 || outside[p]) return;
    outside[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = mask[i] >= 128 || !outside[i] ? 255 : 0;
  }
  return out;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Resize a mask to the working resolution used by the pipeline. */
export function maskForWorking(mask: MaskData, width: number, height: number): MaskData {
  return resizeMask(mask, width, height);
}
