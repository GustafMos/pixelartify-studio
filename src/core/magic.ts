/**
 * Interactive "magic mask" segmentation.
 *
 * The user paints seed strokes on the subject. The mask grows from those seeds
 * through connected pixels with similar OKLab colour, stopping at strong edges.
 * Negative strokes block colours and clear regions. This is intentionally
 * local and dependency-free: no ML model, no network, deterministic.
 */

import type { MaskData, PixelImage } from './types';
import { clamp, rgbToOklab } from './color';
import { createMask, featherMask, resizeImage, resizeMask } from './image';

export interface MagicSeed {
  x: number;
  y: number;
  radius: number;
  positive: boolean;
}

export interface MagicMaskOptions {
  /** OKLab colour distance (0..1). Larger selects more. */
  tolerance?: number;
  /** Feather radius in working pixels. */
  feather?: number;
  /** Downscale the segmentation to this maximum side. */
  maxSide?: number;
  /** Stop expanding across gradients stronger than this (0..1). */
  edgeBarrier?: number;
}

interface WorkImage {
  image: PixelImage;
  scale: number;
}

function workImage(source: PixelImage, maxSide: number): WorkImage {
  const long = Math.max(source.width, source.height);
  if (long <= maxSide) return { image: source, scale: 1 };
  const scale = maxSide / long;
  return {
    image: resizeImage(source, Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)), 'box'),
    scale,
  };
}

function colorKey(lab: Float32Array, i: number): number {
  const l = Math.round(lab[i * 3] * 32);
  const a = Math.round(lab[i * 3 + 1] * 32);
  const b = Math.round(lab[i * 3 + 2] * 32);
  return (l + 128) * 65536 + (a + 128) * 256 + (b + 128);
}

function collectColors(
  image: PixelImage,
  lab: Float32Array,
  seeds: MagicSeed[],
  positive: boolean,
  limit: number,
): Float32Array {
  const bins = new Map<number, { count: number; L: number; A: number; B: number }>();
  const w = image.width;
  const h = image.height;
  let total = 0;
  for (const seed of seeds) {
    if (seed.positive !== positive) continue;
    const x = Math.round(seed.x);
    const y = Math.round(seed.y);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    const L = lab[p * 3];
    const A = lab[p * 3 + 1];
    const B = lab[p * 3 + 2];
    const key = colorKey(lab, p);
    const bin = bins.get(key);
    if (bin) {
      bin.count++;
      bin.L += L;
      bin.A += A;
      bin.B += B;
    } else {
      bins.set(key, { count: 1, L, A, B });
    }
    total++;
  }
  if (bins.size === 0) return new Float32Array(0);
  // Discard rare colours picked up where a brush crossed an edge.
  const minCount = total >= 10 ? Math.max(2, Math.round(total * 0.04)) : 1;
  const entries = [...bins.values()]
    .filter((bin) => bin.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, limit));
  const out = new Float32Array(entries.length * 3);
  entries.forEach((bin, i) => {
    out[i * 3] = bin.L / bin.count;
    out[i * 3 + 1] = bin.A / bin.count;
    out[i * 3 + 2] = bin.B / bin.count;
  });
  return out;
}

function minColorDistance(
  lab: Float32Array,
  p: number,
  colors: Float32Array,
): number {
  if (colors.length === 0) return Infinity;
  const L = lab[p * 3];
  const A = lab[p * 3 + 1];
  const B = lab[p * 3 + 2];
  let best = Infinity;
  for (let i = 0; i < colors.length; i += 3) {
    const dl = L - colors[i];
    const da = A - colors[i + 1];
    const db = B - colors[i + 2];
    const d = dl * dl + da * da + db * db;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function buildMagicMask(
  source: PixelImage,
  seeds: MagicSeed[],
  options: MagicMaskOptions = {},
): MaskData {
  const tolerance = clamp(Number(options.tolerance ?? 0.18), 0.01, 1);
  const feather = clamp(Number(options.feather ?? 1.5), 0, 12);
  const maxSide = clamp(Math.round(options.maxSide ?? 512), 64, 4096);
  const edgeBarrier = clamp(Number(options.edgeBarrier ?? 0.38), 0.02, 1);
  const work = workImage(source, maxSide);
  const img = work.image;
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const data = img.data;
  const scale = work.scale;

  const positiveSeeds = seeds
    .filter((s) => s.positive)
    .map((s) => ({ ...s, x: s.x * scale, y: s.y * scale, radius: Math.max(1, s.radius * scale) }));
  const negativeSeeds = seeds
    .filter((s) => !s.positive)
    .map((s) => ({ ...s, x: s.x * scale, y: s.y * scale, radius: Math.max(1, s.radius * scale) }));

  const mask = createMask(source.width, source.height);
  if (positiveSeeds.length === 0) return mask;

  // OKLab + luma edge map.
  const lab = new Float32Array(n * 3);
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const c = rgbToOklab(data[o], data[o + 1], data[o + 2]);
    lab[i * 3] = c.L;
    lab[i * 3 + 1] = c.a;
    lab[i * 3 + 2] = c.b;
    gray[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  const grad = new Float32Array(n);
  let maxGrad = 0;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const dx =
        -gray[ym * w + xm] + gray[ym * w + xp] -
        2 * gray[y * w + xm] + 2 * gray[y * w + xp] -
        gray[yp * w + xm] + gray[yp * w + xp];
      const dy =
        -gray[ym * w + xm] - 2 * gray[ym * w + x] - gray[ym * w + xp] +
        gray[yp * w + xm] + 2 * gray[yp * w + x] + gray[yp * w + xp];
      const g = Math.sqrt(dx * dx + dy * dy);
      grad[y * w + x] = g;
      if (g > maxGrad) maxGrad = g;
    }
  }
  if (maxGrad > 0) for (let i = 0; i < n; i++) grad[i] /= maxGrad;

  const positiveColors = collectColors(img, lab, positiveSeeds, true, 40);
  const negativeColors = collectColors(img, lab, negativeSeeds, false, 24);

  const selected = new Uint8Array(n);
  const blocked = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const negativeDistance = tolerance * 0.85;
  const isNegative = (p: number): boolean =>
    negativeColors.length > 0 && minColorDistance(lab, p, negativeColors) < negativeDistance;

  const queueSeed = (seed: MagicSeed): void => {
    const r = Math.max(1, Math.round(seed.radius));
    const cx = Math.max(0, Math.min(w - 1, Math.round(seed.x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(seed.y)));
    const cp = cy * w + cx;
    const centerColor = Float32Array.from([lab[cp * 3], lab[cp * 3 + 1], lab[cp * 3 + 2]]);
    const x0 = Math.max(0, Math.floor(seed.x - r));
    const x1 = Math.min(w - 1, Math.ceil(seed.x + r));
    const y0 = Math.max(0, Math.floor(seed.y - r));
    const y1 = Math.min(h - 1, Math.ceil(seed.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > r * r) continue;
        const p = y * w + x;
        if (isNegative(p)) {
          blocked[p] = 1;
          continue;
        }
        if (minColorDistance(lab, p, centerColor) > tolerance * 1.35) continue;
        if (selected[p]) continue;
        selected[p] = 1;
        queue[tail++] = p;
      }
    }
  };

  for (const seed of positiveSeeds) queueSeed(seed);

  const edgeLimit = edgeBarrier;  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    const neighbors = [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ];
    for (const q of neighbors) {
      if (q < 0 || selected[q] || blocked[q]) continue;
      if (grad[q] > edgeLimit) continue;
      if (minColorDistance(lab, q, positiveColors) > tolerance) continue;
      if (negativeColors.length > 0 && minColorDistance(lab, q, negativeColors) < negativeDistance) {
        blocked[q] = 1;
        continue;
      }
      selected[q] = 1;
      queue[tail++] = q;
    }
  }

  // Fill enclosed holes so internal details stay part of the subject.
  const outside = new Uint8Array(n);
  head = 0;
  tail = 0;
  const pushOutside = (p: number): void => {
    if (selected[p] || outside[p]) return;
    outside[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    pushOutside(x);
    pushOutside((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushOutside(y * w);
    pushOutside(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) pushOutside(p - 1);
    if (x < w - 1) pushOutside(p + 1);
    if (y > 0) pushOutside(p - w);
    if (y < h - 1) pushOutside(p + w);
  }
  for (let p = 0; p < n; p++) {
    if (!selected[p] && !outside[p]) selected[p] = 1;
  }

  // Negative strokes clear their area after filling.
  for (const seed of negativeSeeds) {
    const r = Math.max(1, Math.round(seed.radius));
    const x0 = Math.max(0, Math.floor(seed.x - r));
    const x1 = Math.min(w - 1, Math.ceil(seed.x + r));
    const y0 = Math.max(0, Math.floor(seed.y - r));
    const y1 = Math.min(h - 1, Math.ceil(seed.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > r * r) continue;
        selected[y * w + x] = 0;
      }
    }
  }

  const workingMask = createMask(w, h);
  for (let p = 0; p < n; p++) workingMask.data[p] = selected[p] ? 255 : 0;

  const feathered = feather > 0 ? featherMask(workingMask, feather) : workingMask;
  const scaled = w === source.width && h === source.height
    ? feathered
    : resizeMask(feathered, source.width, source.height);
  mask.data.set(scaled.data);
  return mask;
}

/**
 * Track a previously selected subject into the next frame. The colour model is
 * taken from the previous masked region; growth is restricted to a local search
 * window and stops at strong edges. This follows rigid motion and moderate
 * deformation without a model download.
 */
export function trackMagicMaskFrame(
  frame: PixelImage,
  priorFrame: PixelImage,
  priorMask: MaskData,
  options: MagicMaskOptions = {},
): MaskData {
  const tolerance = clamp(Number(options.tolerance ?? 0.18), 0.01, 1) * 1.1;
  const feather = clamp(Number(options.feather ?? 1.5), 0, 12);
  const edgeBarrier = clamp(Number(options.edgeBarrier ?? 0.4), 0.02, 1);
  const w = frame.width;
  const h = frame.height;
  const n = w * h;
  const mask = createMask(w, h);
  if (w === 0 || h === 0) return mask;

  const prior =
    priorMask.width === w && priorMask.height === h
      ? priorMask
      : resizeMask(priorMask, w, h);
  const priorImg =
    priorFrame.width === w && priorFrame.height === h
      ? priorFrame
      : resizeImage(priorFrame, w, h, 'box');

  const lab = new Float32Array(n * 3);
  const gray = new Float32Array(n);
  const current = frame.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const c = rgbToOklab(current[o], current[o + 1], current[o + 2]);
    lab[i * 3] = c.L;
    lab[i * 3 + 1] = c.a;
    lab[i * 3 + 2] = c.b;
    gray[i] = 0.2126 * current[o] + 0.7152 * current[o + 1] + 0.0722 * current[o + 2];
  }

  // Colour model from the previous frame's selected region.
  const priorData = priorImg.data;
  const seen = new Set<number>();
  const colors: number[] = [];
  for (let p = 0; p < n; p += 3) {
    if (prior.data[p] < 128) continue;
    const o = p * 4;
    const c = rgbToOklab(priorData[o], priorData[o + 1], priorData[o + 2]);
    const key =
      (Math.round(c.L * 32) + 128) * 65536 +
      (Math.round(c.a * 32) + 128) * 256 +
      (Math.round(c.b * 32) + 128);
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push(c.L, c.a, c.b);
    if (colors.length / 3 >= 48) break;
  }
  if (colors.length === 0) return mask;
  const model = Float32Array.from(colors);

  // Search window around the previous mask.
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (prior.data[y * w + x] < 128) continue;
      any = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!any) return mask;
  const margin = Math.max(8, Math.round(Math.max(maxX - minX, maxY - minY) * 0.18));
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(w - 1, maxX + margin);
  maxY = Math.min(h - 1, maxY + margin);

  const grad = new Float32Array(n);
  let maxGrad = 0;
  for (let y = minY; y <= maxY; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = minX; x <= maxX; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const dx =
        -gray[ym * w + xm] + gray[ym * w + xp] -
        2 * gray[y * w + xm] + 2 * gray[y * w + xp] -
        gray[yp * w + xm] + gray[yp * w + xp];
      const dy =
        -gray[ym * w + xm] - 2 * gray[ym * w + x] - gray[ym * w + xp] +
        gray[yp * w + xm] + 2 * gray[yp * w + x] + gray[yp * w + xp];
      const g = Math.sqrt(dx * dx + dy * dy);
      grad[y * w + x] = g;
      if (g > maxGrad) maxGrad = g;
    }
  }
  if (maxGrad > 0) for (let i = 0; i < n; i++) grad[i] /= maxGrad;

  const selected = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const tol2 = tolerance * tolerance;

  const candidate = (p: number): boolean => {
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    if (grad[p] > edgeBarrier) return false;
    const L = lab[p * 3];
    const A = lab[p * 3 + 1];
    const B = lab[p * 3 + 2];
    for (let i = 0; i < model.length; i += 3) {
      const dl = L - model[i];
      const da = A - model[i + 1];
      const db = B - model[i + 2];
      if (dl * dl + da * da + db * db <= tol2) return true;
    }
    return false;
  };

  const push = (p: number): void => {
    if (selected[p] || !candidate(p)) return;
    selected[p] = 1;
    queue[tail++] = p;
  };

  // Seed from the overlap with the previous mask, then grow through the window.
  for (let p = 0; p < n; p++) {
    if (prior.data[p] >= 128) push(p);
  }
  if (tail === 0) {
    // No overlap: grow from every candidate in the window and keep the
    // connected component with the largest area below.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) push(y * w + x);
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > minX) push(p - 1);
    if (x < maxX) push(p + 1);
    if (y > minY) push(p - w);
    if (y < maxY) push(p + w);
  }

  // Fill holes inside the selection.
  const outside = new Uint8Array(n);
  head = 0;
  tail = 0;
  const pushOutside = (p: number): void => {
    if (selected[p] || outside[p]) return;
    outside[p] = 1;
    queue[tail++] = p;
  };
  for (let x = minX; x <= maxX; x++) {
    pushOutside(minY * w + x);
    pushOutside(maxY * w + x);
  }
  for (let y = minY; y <= maxY; y++) {
    pushOutside(y * w + minX);
    pushOutside(y * w + maxX);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > minX) pushOutside(p - 1);
    if (x < maxX) pushOutside(p + 1);
    if (y > minY) pushOutside(p - w);
    if (y < maxY) pushOutside(p + w);
  }
  for (let p = 0; p < n; p++) {
    if (selected[p]) continue;
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (!outside[p]) selected[p] = 1;
  }

  const working = createMask(w, h);
  for (let p = 0; p < n; p++) working.data[p] = selected[p] ? 255 : 0;
  return feather > 0 ? featherMask(working, feather) : working;
}
