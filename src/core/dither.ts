/**
 * Dithering engine.
 *
 * The catalog is inspired by Ditherista / libdither (Robert Kist, MIT/BSD) and
 * by the classic literature: Bayer (1973), Floyd & Steinberg (1976),
 * Ulichney (1993), Riemersma (1998) and Yliluoma (2009).
 *
 * No C/C++ code is copied. Algorithms are independently implemented in
 * TypeScript and all parameters are expressed in art pixels.
 */

import type { DitherColorSpace, DitherSettings, PixelImage } from './types';
import { clamp, clamp01, linearToSrgb, parseHex, rgbToOklab, oklabToRgb, srgbToLinear } from './color';
import { createPaletteMatcher, type PaletteMatcher } from './palette';
import {
  bayerMatrix,
  blueNoiseMatrix,
  checkerMatrix,
  clusterDotMatrix,
  dotMatrix,
  hilbertIndex,
  lineMatrix,
  mulberry32,
} from './noise';

export type DitherCategory = 'none' | 'ordered' | 'diffusion' | 'pattern' | 'palette';

export interface DitherAlgorithmDef {
  id: string;
  name: string;
  category: DitherCategory;
  description: string;
  /** Matrix cell size for ordered/pattern algorithms. */
  matrixSize?: number;
  credits?: string[];
}

export const DITHER_ALGORITHMS: DitherAlgorithmDef[] = [
  {
    id: 'none',
    name: 'None',
    category: 'none',
    description: 'Direct nearest-colour quantization. Cleanest, but can band gradients.',
  },
  {
    id: 'bayer-2',
    name: 'Bayer 2×2',
    category: 'ordered',
    description: 'The smallest ordered matrix. Coarse, high-contrast texture.',
    matrixSize: 2,
    credits: ['Bayer (1973)'],
  },
  {
    id: 'bayer-4',
    name: 'Bayer 4×4',
    category: 'ordered',
    description: 'Classic 4×4 ordered dither. Good for UI and retro art.',
    matrixSize: 4,
    credits: ['Bayer (1973)'],
  },
  {
    id: 'bayer-8',
    name: 'Bayer 8×8',
    category: 'ordered',
    description: 'Fine ordered dither with a characteristic cross-hatch.',
    matrixSize: 8,
    credits: ['Bayer (1973)'],
  },
  {
    id: 'bayer-16',
    name: 'Bayer 16×16',
    category: 'ordered',
    description: 'Very fine ordered dither. Subtle gradients, more colours.',
    matrixSize: 16,
    credits: ['Bayer (1973)'],
  },
  {
    id: 'blue-noise',
    name: 'Blue noise',
    category: 'ordered',
    description: 'Void-and-cluster blue noise. Organic grain with no low-frequency clumps.',
    matrixSize: 64,
    credits: ['Ulichney (1993), void-and-cluster'],
  },
  {
    id: 'clustered-dot-4',
    name: 'Clustered dot 4×4',
    category: 'ordered',
    description: 'Halftone-like clustered dots at a coarse scale.',
    matrixSize: 4,
    credits: ['Classic clustered-dot halftone'],
  },
  {
    id: 'clustered-dot-8',
    name: 'Clustered dot 8×8',
    category: 'ordered',
    description: 'Fine clustered-dot halftone. Reads like printed texture.',
    matrixSize: 8,
    credits: ['Classic clustered-dot halftone'],
  },
  {
    id: 'line-horizontal',
    name: 'Horizontal lines',
    category: 'pattern',
    description: 'Horizontal line pattern. Great for skies, water and CRT looks.',
    matrixSize: 4,
  },
  {
    id: 'line-vertical',
    name: 'Vertical lines',
    category: 'pattern',
    description: 'Vertical line pattern for rain, fabric and scan directions.',
    matrixSize: 4,
  },
  {
    id: 'line-diagonal',
    name: 'Diagonal lines',
    category: 'pattern',
    description: 'Diagonal hatch pattern.',
    matrixSize: 4,
  },
  {
    id: 'checker',
    name: 'Checkerboard',
    category: 'pattern',
    description: 'Two-phase checker dither. Strong, graphic texture.',
    matrixSize: 2,
  },
  {
    id: 'dots',
    name: 'Dot screen',
    category: 'pattern',
    description: 'Radial dot screen, similar to comic-book halftones.',
    matrixSize: 6,
  },
  {
    id: 'crosshatch',
    name: 'Crosshatch',
    category: 'pattern',
    description: 'Woven diagonal crosshatch.',
    matrixSize: 8,
  },
  {
    id: 'white-noise',
    name: 'White noise',
    category: 'pattern',
    description: 'Random per-pixel threshold. Grainy and deliberately noisy.',
    matrixSize: 64,
  },
  {
    id: 'threshold',
    name: 'Hard threshold',
    category: 'pattern',
    description: 'No pattern: nearest palette colour only. Useful for clean 1-bit art.',
  },
  {
    id: 'floyd-steinberg',
    name: 'Floyd–Steinberg',
    category: 'diffusion',
    description: 'The benchmark error-diffusion kernel. Balanced and detailed.',
    credits: ['Floyd & Steinberg (1976)'],
  },
  {
    id: 'atkinson',
    name: 'Atkinson',
    category: 'diffusion',
    description: 'Diffuses only 6/8 of the error. Crisper, lighter, classic Mac look.',
    credits: ['Bill Atkinson, Apple (1980s)'],
  },
  {
    id: 'jarvis',
    name: 'Jarvis–Judice–Ninke',
    category: 'diffusion',
    description: 'Wide three-row diffusion. Smooth gradients, slightly soft.',
    credits: ['Jarvis, Judice & Ninke (1976)'],
  },
  {
    id: 'stucki',
    name: 'Stucki',
    category: 'diffusion',
    description: 'Fast, sharp three-row diffusion with good tonal response.',
    credits: ['Stucki (1981)'],
  },
  {
    id: 'burkes',
    name: 'Burkes',
    category: 'diffusion',
    description: 'Two-row kernel with a clean, even texture.',
    credits: ['Burkes (1988)'],
  },
  {
    id: 'sierra',
    name: 'Sierra',
    category: 'diffusion',
    description: 'Three-row diffusion with a gentle, photographic feel.',
    credits: ['Sierra (1989)'],
  },
  {
    id: 'two-row-sierra',
    name: 'Two-row Sierra',
    category: 'diffusion',
    description: 'A lighter Sierra variant using only two rows.',
    credits: ['Sierra (1989)'],
  },
  {
    id: 'sierra-lite',
    name: 'Sierra Lite',
    category: 'diffusion',
    description: 'Minimal three-tap diffusion. Fast and surprisingly good.',
    credits: ['Sierra (1989)'],
  },
  {
    id: 'shiau-fan',
    name: 'Shiau–Fan',
    category: 'diffusion',
    description: 'Compact kernel tuned for clean edges.',
    credits: ['Shiau & Fan (1997)'],
  },
  {
    id: 'simple-2d',
    name: 'Simple 2D',
    category: 'diffusion',
    description: 'Two-neighbour diffusion. Very fast with a soft, diffuse look.',
  },
  {
    id: 'riemersma',
    name: 'Riemersma',
    category: 'diffusion',
    description:
      'Hilbert-curve error diffusion with a weighted error history. Organic, painterly texture.',
    credits: ['Riemersma (1998)'],
  },
  {
    id: 'yliluoma',
    name: 'Palette blend (Yliluoma)',
    category: 'palette',
    description:
      'Ordered two-colour projection between the nearest palette colours. Excellent with unusual palettes.',
    credits: ['Joel Yliluoma (2009), “Arbitrary-palette positional dithering”'],
  },
];

export const DITHER_BY_ID: Record<string, DitherAlgorithmDef> = Object.fromEntries(
  DITHER_ALGORITHMS.map((a) => [a.id, a]),
);

/* -------------------------------------------------------------------------- */
/* Matrices                                                                   */
/* -------------------------------------------------------------------------- */

const MATRIX_CACHE = new Map<string, Float32Array>();

function matrixFor(id: string): Float32Array | null {
  const cached = MATRIX_CACHE.get(id);
  if (cached) return cached;
  let m: Float32Array | null = null;
  switch (id) {
    case 'bayer-2':
      m = bayerMatrix(2);
      break;
    case 'bayer-4':
      m = bayerMatrix(4);
      break;
    case 'bayer-8':
      m = bayerMatrix(8);
      break;
    case 'bayer-16':
      m = bayerMatrix(16);
      break;
    case 'blue-noise':
      m = blueNoiseMatrix();
      break;
    case 'clustered-dot-4':
      m = clusterDotMatrix(4);
      break;
    case 'clustered-dot-8':
      m = clusterDotMatrix(8);
      break;
    case 'line-horizontal':
      m = lineMatrix(4, 'horizontal');
      break;
    case 'line-vertical':
      m = lineMatrix(4, 'vertical');
      break;
    case 'line-diagonal':
      m = lineMatrix(4, 'diagonal');
      break;
    case 'checker':
      m = checkerMatrix(2);
      break;
    case 'dots':
      m = dotMatrix(6);
      break;
    case 'crosshatch': {
      m = new Float32Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const a = Math.sin(((x + y) * Math.PI) / 4);
          const b = Math.sin(((x - y) * Math.PI) / 4);
          m[y * 8 + x] = clamp01(0.5 + (a + b) * 0.24);
        }
      }
      break;
    }
    case 'white-noise': {
      m = new Float32Array(64 * 64);
      const rng = mulberry32(0x51f15e);
      for (let i = 0; i < m.length; i++) m[i] = rng();
      break;
    }
    case 'threshold':
      m = new Float32Array([0.5]);
      break;
    default:
      m = null;
  }
  if (m) MATRIX_CACHE.set(id, m);
  return m;
}

/* -------------------------------------------------------------------------- */
/* Diffusion kernels                                                          */
/* -------------------------------------------------------------------------- */

interface DiffusionKernel {
  divisor: number;
  taps: Array<[number, number, number]>;
}

const DIFFUSION_KERNELS: Record<string, DiffusionKernel> = {
  'floyd-steinberg': {
    divisor: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  atkinson: {
    divisor: 8,
    taps: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  },
  jarvis: {
    divisor: 48,
    taps: [
      [1, 0, 7],
      [2, 0, 5],
      [-2, 1, 3],
      [-1, 1, 5],
      [0, 1, 7],
      [1, 1, 5],
      [2, 1, 3],
      [-2, 2, 1],
      [-1, 2, 3],
      [0, 2, 5],
      [1, 2, 3],
      [2, 2, 1],
    ],
  },
  stucki: {
    divisor: 42,
    taps: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
  },
  burkes: {
    divisor: 32,
    taps: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
    ],
  },
  sierra: {
    divisor: 32,
    taps: [
      [1, 0, 5],
      [2, 0, 3],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 5],
      [1, 1, 4],
      [2, 1, 2],
      [-1, 2, 2],
      [0, 2, 3],
      [1, 2, 2],
    ],
  },
  'two-row-sierra': {
    divisor: 16,
    taps: [
      [1, 0, 4],
      [2, 0, 3],
      [-2, 1, 1],
      [-1, 1, 2],
      [0, 1, 3],
      [1, 1, 2],
      [2, 1, 1],
    ],
  },
  'sierra-lite': {
    divisor: 4,
    taps: [
      [1, 0, 2],
      [-1, 1, 1],
      [0, 1, 1],
    ],
  },
  'shiau-fan': {
    divisor: 16,
    taps: [
      [1, 0, 7],
      [-2, 1, 1],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 3],
      [2, 1, 1],
    ],
  },
  'simple-2d': {
    divisor: 2,
    taps: [
      [1, 0, 1],
      [0, 1, 1],
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface DitherContext {
  /** Used only to derive stable seeds. */
  seed?: number;
}

export function applyDither(
  input: PixelImage,
  palette: string[],
  settings: DitherSettings,
  ctx: DitherContext = {},
): PixelImage {
  const algorithm = settings.algorithm;
  if (algorithm === 'none' || palette.length === 0) return clone(input);

  const colors = palette.map(parseHex);
  if (colors.length === 0) return clone(input);
  const matcher = createPaletteMatcher(palette, 'oklab');
  const strength = clamp01(settings.strength);
  const scale = Math.max(0.25, settings.scale);
  const seed = (settings.seed ?? 0) + (ctx.seed ?? 0);

  if (algorithm === 'riemersma') {
    return riemersma(input, colors, matcher, settings);
  }
  if (algorithm === 'yliluoma') {
    return yliluoma(input, colors, settings, seed);
  }
  const kernel = DIFFUSION_KERNELS[algorithm];
  if (kernel) {
    return errorDiffuse(input, colors, matcher, kernel, settings);
  }

  // Ordered / pattern / threshold.
  const matrix = matrixFor(algorithm);
  if (!matrix) return quantizeDirect(input, colors, matcher);
  return orderedDither(input, colors, matcher, matrix, settings);
}

function clone(img: PixelImage): PixelImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function quantizeDirect(img: PixelImage, colors: ReturnType<typeof parseHex>[], matcher: PaletteMatcher): PixelImage {
  const out = clone(img);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    const idx = matcher.match(out.data[i], out.data[i + 1], out.data[i + 2]);
    const c = colors[idx];
    out.data[i] = c.r;
    out.data[i + 1] = c.g;
    out.data[i + 2] = c.b;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Ordered                                                                    */
/* -------------------------------------------------------------------------- */

function orderedDither(
  img: PixelImage,
  colors: ReturnType<typeof parseHex>[],
  matcher: PaletteMatcher,
  matrix: Float32Array,
  settings: DitherSettings,
): PixelImage {
  const size = Math.round(Math.sqrt(matrix.length));
  const out = clone(img);
  const strength = clamp01(settings.strength);
  const scale = Math.max(0.25, settings.scale);
  const spacing = paletteSpacing(colors, 'rgb');
  const amplitude = spacing * 0.62 * strength * 0.5;
  const bias = clamp(settings.threshold ?? 0, -1, 1);

  for (let y = 0; y < out.height; y++) {
    const my = Math.floor(y / scale) % size;
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4;
      if (out.data[i + 3] === 0) continue;
      const mx = Math.floor(x / scale) % size;
      const t = matrix[my * size + mx] - 0.5 + bias;
      const off = t * 2 * amplitude;
      const idx = matcher.match(
        clamp(out.data[i] + off, 0, 255),
        clamp(out.data[i + 1] + off, 0, 255),
        clamp(out.data[i + 2] + off, 0, 255),
      );
      const c = colors[idx];
      out.data[i] = c.r;
      out.data[i + 1] = c.g;
      out.data[i + 2] = c.b;
    }
  }
  return out;
}

function paletteSpacing(colors: ReturnType<typeof parseHex>[], space: 'oklab' | 'srgb' | 'rgb'): number {
  if (colors.length < 2) return 48;
  let total = 0;
  for (let i = 0; i < colors.length; i++) {
    let best = Infinity;
    for (let j = 0; j < colors.length; j++) {
      if (i === j) continue;
      const a = colors[i];
      const b = colors[j];
      if (space === 'oklab') {
        const la = rgbToOklab(a.r, a.g, a.b);
        const lb = rgbToOklab(b.r, b.g, b.b);
        const d = Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 * 1.6 + (la.b - lb.b) ** 2 * 1.6);
        best = Math.min(best, d);
      } else {
        const d = Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
        best = Math.min(best, d);
      }
    }
    total += best;
  }
  return total / colors.length;
}

/* -------------------------------------------------------------------------- */
/* Error diffusion                                                            */
/* -------------------------------------------------------------------------- */

function errorDiffuse(
  img: PixelImage,
  colors: ReturnType<typeof parseHex>[],
  matcher: PaletteMatcher,
  kernel: DiffusionKernel,
  settings: DitherSettings,
): PixelImage {
  const w = img.width;
  const h = img.height;
  const out = clone(img);
  const strength = clamp01(settings.strength);
  const space = settings.colorSpace;
  const err = new Float32Array(w * h * 3);
  const paletteLab = colors.map((c) => rgbToOklab(c.r, c.g, c.b));
  const serpentine = settings.serpentine;

  for (let y = 0; y < h; y++) {
    const reverse = serpentine && (y & 1) === 1;
    for (let k = 0; k < w; k++) {
      const x = reverse ? w - 1 - k : k;
      const p = y * w + x;
      const i = p * 4;
      if (out.data[i + 3] === 0) continue;

      const er = err[p * 3];
      const eg = err[p * 3 + 1];
      const eb = err[p * 3 + 2];

      const tr = out.data[i];
      const tg = out.data[i + 1];
      const tb = out.data[i + 2];

      let idx: number;
      let targetLab: { L: number; a: number; b: number } | null = null;

      if (space === 'oklab') {
        const base = rgbToOklab(tr, tg, tb);
        targetLab = { L: base.L + er, a: base.a + eg, b: base.b + eb };
        const rgb = oklabToRgb(targetLab.L, targetLab.a, targetLab.b);
        idx = matcher.match(rgb.r, rgb.g, rgb.b);
      } else if (space === 'linear') {
        const lr = clamp01(srgbToLinear(tr / 255) + er / 255);
        const lg = clamp01(srgbToLinear(tg / 255) + eg / 255);
        const lb = clamp01(srgbToLinear(tb / 255) + eb / 255);
        const rgb = {
          r: Math.round(linearToSrgb(lr) * 255),
          g: Math.round(linearToSrgb(lg) * 255),
          b: Math.round(linearToSrgb(lb) * 255),
        };
        idx = matcher.match(rgb.r, rgb.g, rgb.b);
      } else {
        idx = matcher.match(
          clamp(tr + er, 0, 255),
          clamp(tg + eg, 0, 255),
          clamp(tb + eb, 0, 255),
        );
      }

      const c = colors[idx];
      out.data[i] = c.r;
      out.data[i + 1] = c.g;
      out.data[i + 2] = c.b;

      // Compute error in the selected space.
      let errR: number;
      let errG: number;
      let errB: number;
      if (space === 'oklab' && targetLab) {
        const pc = paletteLab[idx];
        errR = (targetLab.L - pc.L) * strength;
        errG = (targetLab.a - pc.a) * strength;
        errB = (targetLab.b - pc.b) * strength;
      } else if (space === 'linear') {
        errR = (srgbToLinear(tr / 255) - srgbToLinear(c.r / 255)) * strength;
        errG = (srgbToLinear(tg / 255) - srgbToLinear(c.g / 255)) * strength;
        errB = (srgbToLinear(tb / 255) - srgbToLinear(c.b / 255)) * strength;
      } else {
        errR = (tr - c.r) * strength;
        errG = (tg - c.g) * strength;
        errB = (tb - c.b) * strength;
      }

      const dir = reverse ? -1 : 1;
      for (const [dx, dy, wgt] of kernel.taps) {
        const nx = x + dx * dir;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        const f = wgt / kernel.divisor;
        err[np * 3] += errR * f;
        err[np * 3 + 1] += errG * f;
        err[np * 3 + 2] += errB * f;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Riemersma (Hilbert curve)                                                  */
/* -------------------------------------------------------------------------- */

function riemersma(
  img: PixelImage,
  colors: ReturnType<typeof parseHex>[],
  matcher: PaletteMatcher,
  settings: DitherSettings,
): PixelImage {
  const w = img.width;
  const h = img.height;
  const out = clone(img);
  const maxSide = Math.max(w, h);
  let order = 1;
  while (1 << order < maxSide) order++;
  const n = 1 << order;

  const orderMap = new Uint32Array(w * h);
  const indices = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = hilbertIndex(x, y, order);
      const p = y * w + x;
      orderMap[p] = idx;
      indices[p] = p;
    }
  }
  indices.sort((a, b) => orderMap[a] - orderMap[b]);

  const strength = clamp01(settings.strength);
  const space = settings.colorSpace;
  const paletteLab = colors.map((c) => rgbToOklab(c.r, c.g, c.b));
  const historyLength = 16;
  const decay = 0.5;
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i < historyLength; i++) {
    const wgt = Math.pow(decay, i);
    weights.push(wgt);
    totalWeight += wgt;
  }
  const histogram: Array<{ r: number; g: number; b: number }> = [];

  for (let step = 0; step < indices.length; step++) {
    const p = indices[step];
    const i = p * 4;
    if (out.data[i + 3] === 0) {
      histogram.unshift({ r: 0, g: 0, b: 0 });
      if (histogram.length > historyLength) histogram.pop();
      continue;
    }

    let er = 0;
    let eg = 0;
    let eb = 0;
    for (let k = 0; k < histogram.length; k++) {
      const f = weights[k] / totalWeight;
      er += histogram[k].r * f;
      eg += histogram[k].g * f;
      eb += histogram[k].b * f;
    }

    const tr = out.data[i];
    const tg = out.data[i + 1];
    const tb = out.data[i + 2];
    let idx: number;
    if (space === 'oklab') {
      const base = rgbToOklab(tr, tg, tb);
      const rgb = oklabToRgb(base.L + er, base.a + eg, base.b + eb);
      idx = matcher.match(rgb.r, rgb.g, rgb.b);
    } else {
      idx = matcher.match(clamp(tr + er, 0, 255), clamp(tg + eg, 0, 255), clamp(tb + eb, 0, 255));
    }
    const c = colors[idx];
    out.data[i] = c.r;
    out.data[i + 1] = c.g;
    out.data[i + 2] = c.b;

    if (space === 'oklab') {
      const base = rgbToOklab(tr, tg, tb);
      const pc = paletteLab[idx];
      histogram.unshift({
        r: (base.L - pc.L) * strength,
        g: (base.a - pc.a) * strength,
        b: (base.b - pc.b) * strength,
      });
    } else {
      histogram.unshift({
        r: (tr - c.r) * strength,
        g: (tg - c.g) * strength,
        b: (tb - c.b) * strength,
      });
    }
    if (histogram.length > historyLength) histogram.pop();
  }
  void n;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Yliluoma-style palette blend                                               */
/* -------------------------------------------------------------------------- */

function yliluoma(
  img: PixelImage,
  colors: ReturnType<typeof parseHex>[],
  settings: DitherSettings,
  seed: number,
): PixelImage {
  const out = clone(img);
  const strength = clamp01(settings.strength);
  const matrix = bayerMatrix(8);
  const size = 8;
  const scale = Math.max(0.25, settings.scale);
  const bias = clamp(settings.threshold ?? 0, -1, 1);
  const labs = colors.map((c) => rgbToOklab(c.r, c.g, c.b));
  const rng = mulberry32(seed || 0x9e3779b9);

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4;
      if (out.data[i + 3] === 0) continue;
      const target = rgbToOklab(out.data[i], out.data[i + 1], out.data[i + 2]);

      let best = 0;
      let second = 0;
      let bestD = Infinity;
      let secondD = Infinity;
      for (let k = 0; k < labs.length; k++) {
        const c = labs[k];
        const d = (target.L - c.L) ** 2 + (target.a - c.a) ** 2 * 1.6 + (target.b - c.b) ** 2 * 1.6;
        if (d < bestD) {
          secondD = bestD;
          second = best;
          bestD = d;
          best = k;
        } else if (d < secondD) {
          secondD = d;
          second = k;
        }
      }
      if (colors.length < 2) {
        const c = colors[0];
        out.data[i] = c.r;
        out.data[i + 1] = c.g;
        out.data[i + 2] = c.b;
        continue;
      }

      const c1 = labs[best];
      const c2 = labs[second];
      const vx = c2.L - c1.L;
      const va = c2.a - c1.a;
      const vb = c2.b - c1.b;
      const denom = vx * vx + va * va + vb * vb;
      let ratio = denom > 1e-8 ? ((target.L - c1.L) * vx + (target.a - c1.a) * va + (target.b - c1.b) * vb) / denom : 0;
      ratio = clamp01(ratio);
      const mx = Math.floor(x / scale) % size;
      const my = Math.floor(y / scale) % size;
      const t = clamp01(matrix[my * size + mx] + bias * 0.25 + (rng() - 0.5) * (1 - strength) * 0.15);
      const idx = t < ratio ? second : best;
      const c = colors[idx];
      out.data[i] = c.r;
      out.data[i + 1] = c.g;
      out.data[i + 2] = c.b;
    }
  }
  return out;
}
