/**
 * Raster image helpers. Pure TypeScript, no DOM dependency, so the same code
 * runs in the browser, in workers and in the CLI.
 */

import type { MaskData, PixelImage } from './types';
import { clamp, clamp01, lerp } from './color';

export function createImage(width: number, height: number): PixelImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img: PixelImage): PixelImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function fillImage(img: PixelImage, r: number, g: number, b: number, a = 255): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
}

export function cropImage(img: PixelImage, x: number, y: number, w: number, h: number): PixelImage {
  const out = createImage(w, h);
  for (let yy = 0; yy < h; yy++) {
    const sy = clamp(y + yy, 0, img.height - 1);
    for (let xx = 0; xx < w; xx++) {
      const sx = clamp(x + xx, 0, img.width - 1);
      const si = (sy * img.width + sx) * 4;
      const di = (yy * w + xx) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/** Bilinear resize with premultiplied alpha to avoid dark/light fringes. */
export function resizeBilinear(src: PixelImage, width: number, height: number): PixelImage {
  const out = createImage(width, height);
  if (width === src.width && height === src.height) {
    out.data.set(src.data);
    return out;
  }
  const sx = src.width / width;
  const sy = src.height / height;
  const sd = src.data;
  const od = out.data;

  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;

      const i00 = (y0 * src.width + x0) * 4;
      const i10 = (y0 * src.width + x1) * 4;
      const i01 = (y1 * src.width + x0) * 4;
      const i11 = (y1 * src.width + x1) * 4;

      const a00 = sd[i00 + 3] / 255;
      const a10 = sd[i10 + 3] / 255;
      const a01 = sd[i01 + 3] / 255;
      const a11 = sd[i11 + 3] / 255;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      // Premultiplied colour interpolation.
      const r =
        sd[i00] * a00 * w00 + sd[i10] * a10 * w10 + sd[i01] * a01 * w01 + sd[i11] * a11 * w11;
      const g =
        sd[i00 + 1] * a00 * w00 +
        sd[i10 + 1] * a10 * w10 +
        sd[i01 + 1] * a01 * w01 +
        sd[i11 + 1] * a11 * w11;
      const b =
        sd[i00 + 2] * a00 * w00 +
        sd[i10 + 2] * a10 * w10 +
        sd[i01 + 2] * a01 * w01 +
        sd[i11 + 2] * a11 * w11;
      const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;

      const di = (y * width + x) * 4;
      if (a > 1e-5) {
        od[di] = r / a;
        od[di + 1] = g / a;
        od[di + 2] = b / a;
      }
      od[di + 3] = a * 255;
    }
  }
  return out;
}

/** Area-average (box) downscale, premultiplied by alpha.
 *
 * Separable: a horizontal area pass into a float buffer, then a vertical pass.
 * The result is mathematically identical to a single 2D area average, but each
 * pass is a tight 1D loop, which is several times faster on large photos.
 */
export function resizeBox(src: PixelImage, width: number, height: number): PixelImage {
  const out = createImage(width, height);
  if (width === src.width && height === src.height) {
    out.data.set(src.data);
    return out;
  }

  const xMap = boxWeights(src.width, width);
  const yMap = boxWeights(src.height, height);
  const sw = src.width;
  const sd = src.data;

  // Horizontal pass: premultiplied sums in 0..255 units, normalized weights.
  const tmp = new Float32Array(src.height * width * 4);
  for (let y = 0; y < src.height; y++) {
    const rowBase = y * sw * 4;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const start = xMap.start[x];
      const end = start + xMap.count[x];
      for (let s = start; s < end; s++) {
        const w = xMap.weights[x * xMap.stride + (s - start)];
        const si = rowBase + s * 4;
        const alpha = sd[si + 3] / 255;
        r += sd[si] * alpha * w;
        g += sd[si + 1] * alpha * w;
        b += sd[si + 2] * alpha * w;
        a += alpha * w;
      }
      const ti = (y * width + x) * 4;
      tmp[ti] = r;
      tmp[ti + 1] = g;
      tmp[ti + 2] = b;
      tmp[ti + 3] = a;
    }
  }

  // Vertical pass.
  const od = out.data;
  for (let y = 0; y < height; y++) {
    const start = yMap.start[y];
    const end = start + yMap.count[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let s = start; s < end; s++) {
        const w = yMap.weights[y * yMap.stride + (s - start)];
        const ti = (s * width + x) * 4;
        r += tmp[ti] * w;
        g += tmp[ti + 1] * w;
        b += tmp[ti + 2] * w;
        a += tmp[ti + 3] * w;
      }
      const di = (y * width + x) * 4;
      if (a > 1e-6) {
        od[di] = r / a;
        od[di + 1] = g / a;
        od[di + 2] = b / a;
      }
      od[di + 3] = a * 255;
    }
  }
  return out;
}

interface BoxWeights {
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

/** Normalized area weights for one axis. */
function boxWeights(srcSize: number, dstSize: number): BoxWeights {
  const scale = srcSize / dstSize;
  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  let stride = 1;
  for (let i = 0; i < dstSize; i++) {
    const a0 = i * scale;
    const a1 = Math.min(srcSize, (i + 1) * scale);
    const i0 = Math.floor(a0);
    const i1 = Math.max(i0 + 1, Math.ceil(a1));
    start[i] = i0;
    count[i] = i1 - i0;
    if (i1 - i0 > stride) stride = i1 - i0;
  }
  const weights = new Float32Array(dstSize * stride);
  for (let i = 0; i < dstSize; i++) {
    const a0 = i * scale;
    const a1 = Math.min(srcSize, (i + 1) * scale);
    let sum = 0;
    for (let k = 0; k < count[i]; k++) {
      const s = start[i] + k;
      const w = Math.min(s + 1, a1) - Math.max(s, a0);
      weights[i * stride + k] = w > 0 ? w : 0;
      sum += weights[i * stride + k];
    }
    if (sum <= 0) {
      weights[i * stride] = 1;
      count[i] = 1;
      sum = 1;
    }
    for (let k = 0; k < count[i]; k++) weights[i * stride + k] /= sum;
  }
  return { start, count, weights, stride };
}

export interface SampledPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Bilinear sample in pixel coordinates (0..width-1), clamped at the edges. */
export function sampleBilinear(src: PixelImage, x: number, y: number): SampledPixel {
  const fx = clamp(x, 0, src.width - 1);
  const fy = clamp(y, 0, src.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = src.data;
  const i00 = (y0 * src.width + x0) * 4;
  const i10 = (y0 * src.width + x1) * 4;
  const i01 = (y1 * src.width + x0) * 4;
  const i11 = (y1 * src.width + x1) * 4;
  const a00 = d[i00 + 3] / 255;
  const a10 = d[i10 + 3] / 255;
  const a01 = d[i01 + 3] / 255;
  const a11 = d[i11 + 3] / 255;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const r = d[i00] * a00 * w00 + d[i10] * a10 * w10 + d[i01] * a01 * w01 + d[i11] * a11 * w11;
  const g =
    d[i00 + 1] * a00 * w00 + d[i10 + 1] * a10 * w10 + d[i01 + 1] * a01 * w01 + d[i11 + 1] * a11 * w11;
  const b =
    d[i00 + 2] * a00 * w00 + d[i10 + 2] * a10 * w10 + d[i01 + 2] * a01 * w01 + d[i11 + 2] * a11 * w11;
  const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
  return a > 1e-6 ? { r: r / a, g: g / a, b: b / a, a: a * 255 } : { r: 0, g: 0, b: 0, a: 0 };
}

export function resizeNearest(src: PixelImage, width: number, height: number): PixelImage {
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export type ResizeFilter = 'nearest' | 'bilinear' | 'box' | 'bicubic' | 'lanczos3';

/** Optional accelerated resizer (WebGL2). Returns null to fall back to the CPU. */
export type ImageResizer = (
  src: PixelImage,
  width: number,
  height: number,
  method: ResizeFilter,
) => PixelImage | null;

let globalResizer: ImageResizer | null = null;

export function setGlobalResizer(resizer: ImageResizer | null): void {
  globalResizer = resizer;
}

export function resizeImage(
  src: PixelImage,
  width: number,
  height: number,
  method: ResizeFilter = 'box',
): PixelImage {
  if (width === src.width && height === src.height) {
    const out = createImage(width, height);
    out.data.set(src.data);
    return out;
  }
  const accelerated = globalResizer?.(src, width, height, method);
  if (accelerated) return accelerated;
  if (method === 'nearest') return resizeNearest(src, width, height);
  if (method === 'box') {
    const down = width < src.width || height < src.height;
    return down ? resizeBox(src, width, height) : resizeBilinear(src, width, height);
  }
  if (method === 'bilinear') return resizeBilinear(src, width, height);
  return resizeFiltered(src, width, height, method);
}

interface FilterKernel {
  radius: number;
  fn: (x: number) => number;
}

function getKernel(filter: 'bicubic' | 'lanczos3'): FilterKernel {
  if (filter === 'lanczos3') {
    return {
      radius: 3,
      fn: (x) => {
        if (x === 0) return 1;
        if (Math.abs(x) >= 3) return 0;
        const px = Math.PI * x;
        return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
      },
    };
  }
  // Catmull-Rom cubic.
  return {
    radius: 2,
    fn: (x) => {
      const ax = Math.abs(x);
      if (ax < 1) return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
      if (ax < 2) return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
      return 0;
    },
  };
}

interface AxisWeights {
  indices: Int32Array;
  weights: Float32Array;
  stride: number;
}

function buildWeights(srcSize: number, dstSize: number, kernel: FilterKernel): AxisWeights {
  const scale = srcSize / dstSize;
  const filterScale = Math.max(1, scale);
  const support = kernel.radius * filterScale;
  const maxTaps = Math.ceil(support * 2) + 2;
  const indices = new Int32Array(dstSize * maxTaps);
  const weights = new Float32Array(dstSize * maxTaps);
  let stride = 0;

  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) * scale - 0.5;
    const left = Math.floor(center - support);
    const right = Math.ceil(center + support);
    let sum = 0;
    let count = 0;
    for (let s = left; s <= right; s++) {
      const w = kernel.fn((s - center) / filterScale);
      if (w <= 0) continue;
      indices[i * maxTaps + count] = clamp(s, 0, srcSize - 1);
      weights[i * maxTaps + count] = w;
      sum += w;
      count++;
    }
    if (sum <= 0) {
      indices[i * maxTaps] = clamp(Math.round(center), 0, srcSize - 1);
      weights[i * maxTaps] = 1;
      count = 1;
      sum = 1;
    }
    for (let k = 0; k < count; k++) weights[i * maxTaps + k] /= sum;
    if (count > stride) stride = count;
  }
  return { indices, weights, stride };
}

/**
 * High-quality separable resampler with premultiplied alpha, supporting
 * bicubic and Lanczos3. Alpha is retained and never bleeds from transparent
 * pixels.
 */
export function resizeFiltered(
  src: PixelImage,
  width: number,
  height: number,
  filter: 'bicubic' | 'lanczos3',
): PixelImage {
  if (width === src.width && height === src.height) return cloneImage(src);
  if (width < 1 || height < 1) return createImage(Math.max(1, width), Math.max(1, height));

  const kernel = getKernel(filter);
  const wx = buildWeights(src.width, width, kernel);
  const wy = buildWeights(src.height, height, kernel);
  const w = width;
  const h = height;
  const sd = src.data;

  const hTmp = new Float32Array(w * src.height * 4);
  const maxTapsX = wx.indices.length / w;
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < maxTapsX; k++) {
        const wgt = wx.weights[x * maxTapsX + k];
        if (wgt === 0) continue;
        const si = (row + wx.indices[x * maxTapsX + k]) * 4;
        const alpha = sd[si + 3] / 255;
        r += sd[si] * alpha * wgt;
        g += sd[si + 1] * alpha * wgt;
        b += sd[si + 2] * alpha * wgt;
        a += alpha * wgt;
      }
      const o = (y * w + x) * 4;
      hTmp[o] = r;
      hTmp[o + 1] = g;
      hTmp[o + 2] = b;
      hTmp[o + 3] = a;
    }
  }

  const out = createImage(w, h);
  const maxTapsY = wy.indices.length / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < maxTapsY; k++) {
        const wgt = wy.weights[y * maxTapsY + k];
        if (wgt === 0) continue;
        const si = (wy.indices[y * maxTapsY + k] * w + x) * 4;
        r += hTmp[si] * wgt;
        g += hTmp[si + 1] * wgt;
        b += hTmp[si + 2] * wgt;
        a += hTmp[si + 3] * wgt;
      }
      const di = (y * w + x) * 4;
      if (a > 1e-6) {
        out.data[di] = r / a;
        out.data[di + 1] = g / a;
        out.data[di + 2] = b / a;
      }
      out.data[di + 3] = clamp01(a) * 255;
    }
  }
  return out;
}

/** Crop a mask by a normalized rectangle while retaining soft edges. */
export function cropMaskNormalized(
  mask: MaskData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): MaskData {
  const ax = clamp01(x0);
  const ay = clamp01(y0);
  const bx = clamp01(x1);
  const by = clamp01(y1);
  const w = Math.max(1, Math.round(mask.width * Math.max(1e-4, bx - ax)));
  const h = Math.max(1, Math.round(mask.height * Math.max(1e-4, by - ay)));
  const out = createMask(w, h);
  for (let y = 0; y < h; y++) {
    const sy = ay + ((y + 0.5) / h) * (by - ay);
    for (let x = 0; x < w; x++) {
      const sx = ax + ((x + 0.5) / w) * (bx - ax);
      out.data[y * w + x] = Math.round(sampleMask(mask, sx, sy) * 255);
    }
  }
  return out;
}

/** Integer nearest-neighbour upscale, used for the final pixel-art export. */
export function upscaleNearest(src: PixelImage, factor: number): PixelImage {
  if (factor <= 1) return cloneImage(src);
  const out = createImage(src.width * factor, src.height * factor);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  const od = out.data;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4;
      const r = sd[si];
      const g = sd[si + 1];
      const b = sd[si + 2];
      const a = sd[si + 3];
      for (let yy = 0; yy < factor; yy++) {
        let di = ((y * factor + yy) * out.width + x * factor) * 4;
        for (let xx = 0; xx < factor; xx++) {
          od[di] = r;
          od[di + 1] = g;
          od[di + 2] = b;
          od[di + 3] = a;
          di += 4;
        }
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Integral images                                                            */
/* -------------------------------------------------------------------------- */

export interface Integral {
  width: number;
  height: number;
  /** (w+1)*(h+1) sums per channel. */
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  a: Float64Array;
}

export function buildIntegral(img: PixelImage): Integral {
  const w = img.width;
  const h = img.height;
  const stride = w + 1;
  const count = stride * (h + 1);
  const r = new Float64Array(count);
  const g = new Float64Array(count);
  const b = new Float64Array(count);
  const a = new Float64Array(count);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowA = 0;
    const rowBase = (y + 1) * stride;
    const prevBase = y * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = d[i + 3] / 255;
      rowR += d[i] * alpha;
      rowG += d[i + 1] * alpha;
      rowB += d[i + 2] * alpha;
      rowA += alpha;
      r[rowBase + x + 1] = r[prevBase + x + 1] + rowR;
      g[rowBase + x + 1] = g[prevBase + x + 1] + rowG;
      b[rowBase + x + 1] = b[prevBase + x + 1] + rowB;
      a[rowBase + x + 1] = a[prevBase + x + 1] + rowA;
    }
  }
  return { width: w, height: h, r, g, b, a };
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function integralRect(integ: Integral, rect: Rect): { r: number; g: number; b: number; a: number; area: number } {
  const stride = integ.width + 1;
  const x0 = clamp(Math.floor(rect.x0), 0, integ.width);
  const y0 = clamp(Math.floor(rect.y0), 0, integ.height);
  const x1 = clamp(Math.ceil(rect.x1), 0, integ.width);
  const y1 = clamp(Math.ceil(rect.y1), 0, integ.height);
  if (x1 <= x0 || y1 <= y0) return { r: 0, g: 0, b: 0, a: 0, area: 0 };

  const i00 = y0 * stride + x0;
  const i10 = y0 * stride + x1;
  const i01 = y1 * stride + x0;
  const i11 = y1 * stride + x1;
  const area = (x1 - x0) * (y1 - y0);

  return {
    r: integ.r[i11] - integ.r[i10] - integ.r[i01] + integ.r[i00],
    g: integ.g[i11] - integ.g[i10] - integ.g[i01] + integ.g[i00],
    b: integ.b[i11] - integ.b[i10] - integ.b[i01] + integ.b[i00],
    a: integ.a[i11] - integ.a[i10] - integ.a[i01] + integ.a[i00],
    area,
  };
}

export function meanRect(integ: Integral, rect: Rect): { r: number; g: number; b: number; a: number } {
  const s = integralRect(integ, rect);
  if (s.area === 0 || s.a < 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: s.r / s.a, g: s.g / s.a, b: s.b / s.a, a: s.a / s.area };
}

/* -------------------------------------------------------------------------- */
/* Tone adjustments                                                           */
/* -------------------------------------------------------------------------- */

export interface ToneSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  hueShift: number;
}

export function applyTone(img: PixelImage, tone: ToneSettings): void {
  const { data } = img;
  const brightness = tone.brightness * 255;
  const contrast = tone.contrast;
  const sat = tone.saturation;
  const invGamma = 1 / Math.max(0.01, tone.gamma);
  const angle = (tone.hueShift * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const doHue = Math.abs(tone.hueShift) > 0.001;

  // Hue rotation matrix (YIQ-based), standard formulation.
  const m00 = 0.213 + cosA * 0.787 - sinA * 0.213;
  const m01 = 0.715 - cosA * 0.715 - sinA * 0.715;
  const m02 = 0.072 - cosA * 0.072 + sinA * 0.928;
  const m10 = 0.213 - cosA * 0.213 + sinA * 0.143;
  const m11 = 0.715 + cosA * 0.285 + sinA * 0.14;
  const m12 = 0.072 - cosA * 0.072 - sinA * 0.283;
  const m20 = 0.213 - cosA * 0.213 - sinA * 0.787;
  const m21 = 0.715 - cosA * 0.715 + sinA * 0.715;
  const m22 = 0.072 + cosA * 0.928 + sinA * 0.072;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (doHue) {
      const nr = m00 * r + m01 * g + m02 * b;
      const ng = m10 * r + m11 * g + m12 * b;
      const nb = m20 * r + m21 * g + m22 * b;
      r = nr;
      g = ng;
      b = nb;
    }

    // Brightness + contrast around mid grey.
    r = (r - 127.5) * contrast + 127.5 + brightness;
    g = (g - 127.5) * contrast + 127.5 + brightness;
    b = (b - 127.5) * contrast + 127.5 + brightness;

    // Saturation.
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * sat;
    g = luma + (g - luma) * sat;
    b = luma + (b - luma) * sat;

    if (invGamma !== 1) {
      r = 255 * Math.pow(clamp01(r / 255), invGamma);
      g = 255 * Math.pow(clamp01(g / 255), invGamma);
      b = 255 * Math.pow(clamp01(b / 255), invGamma);
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

export function applyAlphaThreshold(img: PixelImage, threshold: number): void {
  const t = clamp01(threshold) * 255;
  const { data } = img;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] < t ? 0 : 255;
  }
}

/* -------------------------------------------------------------------------- */
/* Blur / sharpen                                                             */
/* -------------------------------------------------------------------------- */

export function boxBlurRGBA(img: PixelImage, radius: number): PixelImage {
  if (radius < 0.5) return cloneImage(img);
  const r = Math.max(1, Math.round(radius));
  const w = img.width;
  const h = img.height;
  const window = 2 * r + 1;
  const hTmp = new Float32Array(w * h * 4);
  const vTmp = new Float32Array(w * h * 4);
  const out = createImage(w, h);
  const sd = img.data;

  // Horizontal pass on premultiplied colour and straight alpha.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let k = -r; k <= r; k++) {
      const i = (row + clamp(k, 0, w - 1)) * 4;
      const a = sd[i + 3] / 255;
      sr += sd[i] * a;
      sg += sd[i + 1] * a;
      sb += sd[i + 2] * a;
      sa += a;
    }
    for (let x = 0; x < w; x++) {
      const o = (row + x) * 4;
      hTmp[o] = sr / window;
      hTmp[o + 1] = sg / window;
      hTmp[o + 2] = sb / window;
      hTmp[o + 3] = sa / window;

      const iOut = (row + clamp(x - r, 0, w - 1)) * 4;
      const iIn = (row + clamp(x + r + 1, 0, w - 1)) * 4;
      const aOut = sd[iOut + 3] / 255;
      const aIn = sd[iIn + 3] / 255;
      sr += sd[iIn] * aIn - sd[iOut] * aOut;
      sg += sd[iIn + 1] * aIn - sd[iOut + 1] * aOut;
      sb += sd[iIn + 2] * aIn - sd[iOut + 2] * aOut;
      sa += aIn - aOut;
    }
  }

  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let k = -r; k <= r; k++) {
      const o = (clamp(k, 0, h - 1) * w + x) * 4;
      sr += hTmp[o];
      sg += hTmp[o + 1];
      sb += hTmp[o + 2];
      sa += hTmp[o + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      vTmp[o] = sr / window;
      vTmp[o + 1] = sg / window;
      vTmp[o + 2] = sb / window;
      vTmp[o + 3] = sa / window;

      const oOut = (clamp(y - r, 0, h - 1) * w + x) * 4;
      const oIn = (clamp(y + r + 1, 0, h - 1) * w + x) * 4;
      sr += hTmp[oIn] - hTmp[oOut];
      sg += hTmp[oIn + 1] - hTmp[oOut + 1];
      sb += hTmp[oIn + 2] - hTmp[oOut + 2];
      sa += hTmp[oIn + 3] - hTmp[oOut + 3];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = vTmp[i + 3];
      if (a > 1e-5) {
        // vTmp holds alpha-weighted colour in 0..255 units, so only divide by
        // the averaged alpha (do not multiply by 255 again).
        out.data[i] = vTmp[i] / a;
        out.data[i + 1] = vTmp[i + 1] / a;
        out.data[i + 2] = vTmp[i + 2] / a;
      }
      out.data[i + 3] = a * 255;
    }
  }
  return out;
}

export function gaussianBlurRGBA(img: PixelImage, radius: number): PixelImage {
  if (radius < 0.5) return cloneImage(img);
  // Three box passes approximate a gaussian well.
  let out = boxBlurRGBA(img, radius);
  out = boxBlurRGBA(out, radius * 0.66);
  out = boxBlurRGBA(out, radius * 0.4);
  return out;
}

export function unsharpMask(img: PixelImage, radius: number, amount: number): PixelImage {
  const blurred = gaussianBlurRGBA(img, radius);
  const out = cloneImage(img);
  const a = amount;
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = img.data[i] + (img.data[i] - blurred.data[i]) * a;
    out.data[i + 1] = img.data[i + 1] + (img.data[i + 1] - blurred.data[i + 1]) * a;
    out.data[i + 2] = img.data[i + 2] + (img.data[i + 2] - blurred.data[i + 2]) * a;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Mask utilities                                                             */
/* -------------------------------------------------------------------------- */

export function createMask(width: number, height: number, fill = 0): MaskData {
  const data = new Uint8Array(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

export function cloneMask(mask: MaskData): MaskData {
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
}

export function resizeMask(mask: MaskData, width: number, height: number): MaskData {
  if (mask.width === width && mask.height === height) return cloneMask(mask);
  const out = createMask(width, height);
  const sx = mask.width / width;
  const sy = mask.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.floor(fy);
    const y1 = Math.min(mask.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.floor(fx);
      const x1 = Math.min(mask.width - 1, x0 + 1);
      const tx = fx - x0;
      const v00 = mask.data[y0 * mask.width + x0];
      const v10 = mask.data[y0 * mask.width + x1];
      const v01 = mask.data[y1 * mask.width + x0];
      const v11 = mask.data[y1 * mask.width + x1];
      out.data[y * width + x] = Math.round(
        lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty),
      );
    }
  }
  return out;
}

export function invertMask(mask: MaskData): MaskData {
  const out = cloneMask(mask);
  for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - out.data[i];
  return out;
}

export function thresholdMask(mask: MaskData, threshold: number): MaskData {
  const t = clamp01(threshold) * 255;
  const out = cloneMask(mask);
  for (let i = 0; i < out.data.length; i++) out.data[i] = out.data[i] >= t ? 255 : 0;
  return out;
}

export function featherMask(mask: MaskData, radius: number): MaskData {
  if (radius < 0.5) return cloneMask(mask);
  const r = Math.max(1, Math.round(radius));
  const w = mask.width;
  const h = mask.height;
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += mask.data[y * w + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1);
      sum += mask.data[y * w + clamp(x + r + 1, 0, w - 1)] - mask.data[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / (2 * r + 1));
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return { width: w, height: h, data: out };
}

export function dilateMask(mask: MaskData, radius: number): MaskData {
  return morphMask(mask, radius, true);
}

export function erodeMask(mask: MaskData, radius: number): MaskData {
  return morphMask(mask, radius, false);
}

function morphMask(mask: MaskData, radius: number, dilate: boolean): MaskData {
  if (radius < 0.5) return cloneMask(mask);
  const r = Math.max(1, Math.round(radius));
  const w = mask.width;
  const h = mask.height;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const fill = dilate ? 0 : 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = fill;
      for (let k = -r; k <= r; k++) {
        const s = mask.data[y * w + clamp(x + k, 0, w - 1)];
        v = dilate ? Math.max(v, s) : Math.min(v, s);
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = fill;
      for (let k = -r; k <= r; k++) {
        const s = tmp[clamp(y + k, 0, h - 1) * w + x];
        v = dilate ? Math.max(v, s) : Math.min(v, s);
      }
      out[y * w + x] = v;
    }
  }
  return { width: w, height: h, data: out };
}

export function unionMasks(masks: MaskData[], width: number, height: number): MaskData {
  const out = createMask(width, height);
  for (const mask of masks) {
    const m = resizeMask(mask, width, height);
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] = Math.max(out.data[i], m.data[i]);
    }
  }
  return out;
}

/** Bilinear sample of a mask in normalized 0..1 coordinates. */
export function sampleMask(mask: MaskData, x: number, y: number): number {
  const fx = clamp(x * (mask.width - 1), 0, mask.width - 1);
  const fy = clamp(y * (mask.height - 1), 0, mask.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(mask.width - 1, x0 + 1);
  const y1 = Math.min(mask.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v = lerp(
    lerp(mask.data[y0 * mask.width + x0], mask.data[y0 * mask.width + x1], tx),
    lerp(mask.data[y1 * mask.width + x0], mask.data[y1 * mask.width + x1], tx),
    ty,
  );
  return v / 255;
}

export function multiplyAlpha(img: PixelImage, mask: MaskData): void {
  const { data } = img;
  for (let y = 0; y < img.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y / img.height) * mask.height));
    for (let x = 0; x < img.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x / img.width) * mask.width));
      const i = (y * img.width + x) * 4;
      data[i + 3] = (data[i + 3] * mask.data[my * mask.width + mx]) / 255;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Compositing                                                                */
/* -------------------------------------------------------------------------- */

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';

export function blendPixel(
  base: [number, number, number],
  top: [number, number, number],
  mode: BlendMode,
): [number, number, number] {
  const r = base[0] / 255;
  const g = base[1] / 255;
  const b = base[2] / 255;
  const tr = top[0] / 255;
  const tg = top[1] / 255;
  const tb = top[2] / 255;
  switch (mode) {
    case 'multiply':
      return [r * tr * 255, g * tg * 255, b * tb * 255];
    case 'screen':
      return [(1 - (1 - r) * (1 - tr)) * 255, (1 - (1 - g) * (1 - tg)) * 255, (1 - (1 - b) * (1 - tb)) * 255];
    case 'add':
      return [Math.min(255, base[0] + top[0]), Math.min(255, base[1] + top[1]), Math.min(255, base[2] + top[2])];
    case 'overlay':
      return [
        (r < 0.5 ? 2 * r * tr : 1 - 2 * (1 - r) * (1 - tr)) * 255,
        (g < 0.5 ? 2 * g * tg : 1 - 2 * (1 - g) * (1 - tg)) * 255,
        (b < 0.5 ? 2 * b * tb : 1 - 2 * (1 - b) * (1 - tb)) * 255,
      ];
    default:
      return [top[0], top[1], top[2]];
  }
}

/**
 * Source-over compositing for two full-size RGBA images. The top image is
 * placed at (dx, dy); pixels outside either image are left untouched. This is
 * used by the generated background and 3D object nodes.
 */
export function compositeOver(
  base: PixelImage,
  top: PixelImage,
  dx = 0,
  dy = 0,
): PixelImage {
  const out = cloneImage(base);
  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(out.width, dx + top.width);
  const y1 = Math.min(out.height, dy + top.height);
  for (let y = y0; y < y1; y++) {
    const ty = y - dy;
    for (let x = x0; x < x1; x++) {
      const ti = (ty * top.width + (x - dx)) * 4;
      const ta = top.data[ti + 3] / 255;
      if (ta <= 0) continue;
      const di = (y * out.width + x) * 4;
      const da = out.data[di + 3] / 255;
      const oa = ta + da * (1 - ta);
      if (oa <= 0) {
        out.data[di] = 0;
        out.data[di + 1] = 0;
        out.data[di + 2] = 0;
        out.data[di + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        out.data[di + c] = (top.data[ti + c] * ta + out.data[di + c] * da * (1 - ta)) / oa;
      }
      out.data[di + 3] = oa * 255;
    }
  }
  return out;
}

export interface CompositeLayer {
  image: PixelImage;
  opacity: number;
  blend: BlendMode;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export function compositeLayers(
  width: number,
  height: number,
  layers: CompositeLayer[],
  background?: [number, number, number, number],
): PixelImage {
  const out = createImage(width, height);
  if (background) fillImage(out, background[0], background[1], background[2], background[3]);

  for (const layer of layers) {
    const src = layer.image;
    const scale = layer.scale || 1;
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Inverse transform into the source layer.
        const sx = Math.round((x - cx - layer.offsetX) / scale + src.width / 2);
        const sy = Math.round((y - cy - layer.offsetY) / scale + src.height / 2);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const si = (sy * src.width + sx) * 4;
        const alpha = (src.data[si + 3] / 255) * layer.opacity;
        if (alpha <= 0) continue;
        const di = (y * width + x) * 4;
        const base: [number, number, number] = [out.data[di], out.data[di + 1], out.data[di + 2]];
        const top: [number, number, number] = [src.data[si], src.data[si + 1], src.data[si + 2]];
        const blended = blendPixel(base, top, layer.blend);
        const outA = out.data[di + 3] / 255;
        const a = alpha + outA * (1 - alpha);
        if (a > 1e-6) {
          out.data[di] = (blended[0] * alpha + base[0] * outA * (1 - alpha)) / a;
          out.data[di + 1] = (blended[1] * alpha + base[1] * outA * (1 - alpha)) / a;
          out.data[di + 2] = (blended[2] * alpha + base[2] * outA * (1 - alpha)) / a;
        }
        out.data[di + 3] = a * 255;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function imageToMask(img: PixelImage, channel: 'alpha' | 'luma' = 'alpha'): MaskData {
  const out = createMask(img.width, img.height);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    if (channel === 'alpha') {
      out.data[p] = img.data[i + 3];
    } else {
      out.data[p] = Math.round(
        0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2],
      );
    }
  }
  return out;
}

export function hasTransparency(img: PixelImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] < 250) return true;
  }
  return false;
}

export function thumbnailImage(img: PixelImage, maxSide: number): PixelImage {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return resizeImage(img, w, h, 'box');
}
