/**
 * Deterministic noise and dither threshold matrices.
 *
 * Algorithms referenced:
 *  - Bayer (1973), ordered dithering.
 *  - Ulichney (1993), void-and-cluster blue noise.
 *  - Riemersma (1998), Hilbert-curve error diffusion.
 *  - Yliluoma (2009), arbitrary-palette ordered dithering.
 */

import { BLUE_NOISE_B64 } from './blueNoiseData';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** 2D value noise in 0..1, tileable with a power-of-two period. */
export function valueNoise2D(x: number, y: number, seed = 0, period = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const wrap = (v: number): number => {
    if (period <= 0) return v;
    return ((v % period) + period) % period;
  };
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const ya = wrap(y0);
  const yb = wrap(y0 + 1);
  const v00 = hash2(xa, ya, seed);
  const v10 = hash2(xb, ya, seed);
  const v01 = hash2(xa, yb, seed);
  const v11 = hash2(xb, yb, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  seed?: number;
  period?: number;
}

export function fbm2D(x: number, y: number, options: FbmOptions = {}): number {
  const octaves = options.octaves ?? 4;
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  const seed = options.seed ?? 0;
  const period = options.period ?? 0;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 1013, period > 0 ? period * freq : 0) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/* -------------------------------------------------------------------------- */
/* Threshold matrices                                                         */
/* -------------------------------------------------------------------------- */

/** Recursive Bayer matrix, values normalized to (0, 1). */
export function bayerMatrix(size: number): Float32Array {
  const n = Math.max(2, 1 << Math.round(Math.log2(size)));
  let m = new Float32Array([0]);
  let dim = 1;
  while (dim < n) {
    const next = new Float32Array(dim * 2 * dim * 2);
    const nd = dim * 2;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const v = m[y * dim + x] * 4;
        next[y * nd + x] = v;
        next[y * nd + x + dim] = v + 2;
        next[(y + dim) * nd + x] = v + 3;
        next[(y + dim) * nd + x + dim] = v + 1;
      }
    }
    m = next;
    dim = nd;
  }
  const count = n * n;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (m[i] + 0.5) / count;
  return out;
}

/** 8x8 clustered-dot matrix (0..63), normalized. */
const CLUSTER_DOT_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

export function clusterDotMatrix(size = 8): Float32Array {
  const n = Math.max(2, Math.round(size));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = x % 8;
      const sy = y % 8;
      out[y * n + x] = (CLUSTER_DOT_8[sy * 8 + sx] + 0.5) / 64;
    }
  }
  return out;
}

export function lineMatrix(size: number, direction: 'horizontal' | 'vertical' | 'diagonal'): Float32Array {
  const n = Math.max(2, Math.round(size));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v =
        direction === 'horizontal'
          ? (x + 0.5) / n
          : direction === 'vertical'
            ? (y + 0.5) / n
            : ((x + y) % n) / n;
      out[y * n + x] = v;
    }
  }
  return out;
}

export function checkerMatrix(size = 2): Float32Array {
  const n = Math.max(2, Math.round(size));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out[y * n + x] = ((x + y) & 1) === 0 ? 0.25 : 0.75;
  }
  return out;
}

export function dotMatrix(size = 4): Float32Array {
  const n = Math.max(2, Math.round(size));
  const out = new Float32Array(n * n);
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.max(Math.abs(x - c), Math.abs(y - c));
      out[y * n + x] = (d + 0.5) / (c + 0.5);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Blue noise                                                                 */
/* -------------------------------------------------------------------------- */

let cachedBlueNoise: Float32Array | null = null;

/**
 * A 64x64 void-and-cluster blue-noise threshold matrix generated offline by
 * `scripts/generate-blue-noise.mjs` and shipped as a compact base64 payload.
 * A deterministic fallback is used if the payload is unavailable.
 */
export function blueNoiseMatrix(seed = 0): Float32Array {
  if (cachedBlueNoise) return cachedBlueNoise;
  const size = 64;
  const out = new Float32Array(size * size);
  if (BLUE_NOISE_B64) {
    const bin = base64ToBytes(BLUE_NOISE_B64);
    for (let i = 0; i < out.length; i++) out[i] = (bin[i % bin.length] + 0.5) / 256;
    cachedBlueNoise = out;
    return out;
  }
  // Fallback: deterministic hash noise (only used if the embedded asset is lost).
  const rng = mulberry32(0x9e3779b9 ^ seed);
  for (let i = 0; i < out.length; i++) out[i] = rng();
  cachedBlueNoise = out;
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback.
  const buf = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer;
  if (buf) return new Uint8Array(buf.from(b64, 'base64'));
  return new Uint8Array(0);
}

/* -------------------------------------------------------------------------- */
/* Hilbert curve (Riemersma)                                                  */
/* -------------------------------------------------------------------------- */

/** Convert (x, y) on a 2^n grid to a Hilbert curve index. */
export function hilbertIndex(x: number, y: number, order: number): number {
  let rx: number;
  let ry: number;
  let d = 0;
  let xx = x;
  let yy = y;
  for (let s = 1 << (order - 1); s > 0; s >>= 1) {
    rx = (xx & s) > 0 ? 1 : 0;
    ry = (yy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate.
    if (ry === 0) {
      if (rx === 1) {
        xx = s - 1 - xx;
        yy = s - 1 - yy;
      }
      const t = xx;
      xx = yy;
      yy = t;
    }
  }
  return d;
}
