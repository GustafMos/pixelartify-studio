/**
 * Pre-processing effect stack.
 *
 * All radii, amplitudes and feature sizes are expressed in **art pixels** and
 * scaled to the working resolution by the pipeline, keeping stylization
 * consistent across 480p, 1080p and 4K sources.
 */

import type {
  ColorCorrectionSettings,
  PixelImage,
  PostprocessOp,
  PostprocessType,
  PreprocessOp,
  PreprocessType,
} from './types';
import {
  applyTone,
  boxBlurRGBA,
  cloneImage,
  createImage,
  gaussianBlurRGBA,
  sampleBilinear,
  unsharpMask,
} from './image';
import { clamp, clamp01, lerp, linearToSrgb, parseHex, srgbToLinear } from './color';
import { fbm2D, hash2, mulberry32 } from './noise';

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  hint?: string;
}

export interface EffectDefinition<T extends string> {
  type: T;
  title: string;
  category: 'stylize' | 'distort' | 'detail' | 'colour' | 'output';
  description: string;
  params: EffectParamDef[];
  colorParam?: boolean;
  credits?: string[];
}

export const DEFAULT_COLOR_CORRECTION: ColorCorrectionSettings = {
  exposure: 0,
  contrast: 1,
  brightness: 0,
  saturation: 1,
  gamma: 1,
  hueShift: 0,
  temperature: 0,
  tint: 0,
};

export const COLOR_CORRECTION_PARAMS: EffectParamDef[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, default: 0, unit: 'EV' },
  { key: 'contrast', label: 'Contrast', min: 0.4, max: 2, step: 0.01, default: 1 },
  { key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.5, step: 0.01, default: 1 },
  { key: 'hueShift', label: 'Hue shift', min: -180, max: 180, step: 1, default: 0, unit: '°' },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, default: 0 },
];

export const PREPROCESS_DEFS: EffectDefinition<PreprocessType>[] = [
  {
    type: 'colorCorrect',
    title: 'Color correct',
    category: 'colour',
    description:
      'Exposure, contrast, saturation, gamma, hue, temperature and tint. Alpha is retained.',
    params: COLOR_CORRECTION_PARAMS,
  },
  {
    type: 'painterly',
    title: 'Painterly (Kuwahara)',
    category: 'stylize',
    description:
      'Edge-preserving Kuwahara filter. Smooths flat areas while keeping line work and silhouettes intact — ideal before pixelation.',
    params: [
      { key: 'radius', label: 'Brush radius', min: 1, max: 10, step: 0.5, default: 3, unit: 'art px' },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'passes', label: 'Passes', min: 1, max: 3, step: 1, default: 1 },
    ],
    credits: ['Kuwahara et al. (1976), “Processing of RI-angiocardiographic images”'],
  },
  {
    type: 'oil',
    title: 'Oil paint',
    category: 'stylize',
    description: 'Histogram-based oil-paint filter. Produces broad, poster-like brush strokes.',
    params: [
      { key: 'radius', label: 'Brush radius', min: 1, max: 6, step: 0.5, default: 2, unit: 'art px' },
      { key: 'levels', label: 'Intensity levels', min: 3, max: 24, step: 1, default: 8 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    credits: ['Classic oil-paint histogram filter (Haeberli, 1990)'],
  },
  {
    type: 'watercolor',
    title: 'Watercolour',
    category: 'stylize',
    description: 'Kuwahara smoothing, paper granulation and soft pigment pooling.',
    params: [
      { key: 'radius', label: 'Pigment radius', min: 1, max: 8, step: 0.5, default: 2, unit: 'art px' },
      { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.25 },
      { key: 'texture', label: 'Paper texture', min: 0, max: 1, step: 0.01, default: 0.18 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.9 },
    ],
  },
  {
    type: 'posterize',
    title: 'Posterize',
    category: 'colour',
    description: 'Quantize tonal levels before palette matching. Creates bolder value groups.',
    params: [
      { key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, default: 8 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  {
    type: 'displace',
    title: 'Noise displacement',
    category: 'distort',
    description:
      'Warps the image with fractal value noise for a hand-drawn, wobbly or glassy stylization.',
    params: [
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 24, step: 0.5, default: 3, unit: 'art px' },
      { key: 'scale', label: 'Feature size', min: 2, max: 96, step: 1, default: 18, unit: 'art px' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 6, step: 1, default: 3 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, step: 1, default: 0 },
      { key: 'chromatic', label: 'Chromatic split', min: 0, max: 1, step: 0.01, default: 0 },
    ],
    credits: ['Fractal value noise after Perlin (1985) and Musgrave'],
  },
  {
    type: 'grain',
    title: 'Film grain',
    category: 'distort',
    description: 'Adds resolution-independent monochrome or colour grain.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.12 },
      { key: 'scale', label: 'Grain size', min: 0.5, max: 8, step: 0.5, default: 1, unit: 'art px' },
      { key: 'monochrome', label: 'Monochrome', min: 0, max: 1, step: 1, default: 1 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, step: 1, default: 7 },
    ],
  },
  {
    type: 'soften',
    title: 'Soften',
    category: 'detail',
    description: 'Gaussian softening to remove texture before edge-aware sampling.',
    params: [
      { key: 'radius', label: 'Radius', min: 0, max: 12, step: 0.5, default: 2, unit: 'art px' },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  {
    type: 'sharpen',
    title: 'Sharpen',
    category: 'detail',
    description: 'Unsharp mask to recover crisp edges before sampling.',
    params: [
      { key: 'radius', label: 'Radius', min: 0.2, max: 6, step: 0.1, default: 1, unit: 'art px' },
      { key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.7 },
    ],
  },
  {
    type: 'bloom',
    title: 'Bloom',
    category: 'detail',
    description: 'Glow around bright areas. Adds a cinematic, luminous feel.',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0.3, max: 0.98, step: 0.01, default: 0.72 },
      { key: 'radius', label: 'Radius', min: 1, max: 24, step: 0.5, default: 6, unit: 'art px' },
      { key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.5 },
    ],
  },
  {
    type: 'pixelBlur',
    title: 'Chunky blur',
    category: 'stylize',
    description: 'Block-average the source into larger tiles before the final pixelation pass.',
    params: [
      { key: 'block', label: 'Block size', min: 1, max: 16, step: 0.5, default: 2, unit: 'art px' },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
];

export const PREPROCESS_BY_TYPE: Record<PreprocessType, EffectDefinition<PreprocessType>> =
  Object.fromEntries(PREPROCESS_DEFS.map((d) => [d.type, d])) as Record<
    PreprocessType,
    EffectDefinition<PreprocessType>
  >;

export const POSTPROCESS_DEFS: EffectDefinition<PostprocessType>[] = [
  {
    type: 'outline',
    title: 'Sprite outline',
    category: 'output',
    description:
      'Adds a clean outer (or inner) outline around opaque pixels. Essential for readable game sprites.',
    params: [
      { key: 'thickness', label: 'Thickness', min: 1, max: 4, step: 1, default: 1, unit: 'art px' },
      { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'inner', label: 'Inner outline', min: 0, max: 1, step: 1, default: 0 },
    ],
    colorParam: true,
  },
  {
    type: 'bloom',
    title: 'Bloom / glow',
    category: 'colour',
    description: 'Screen-adds a blurred bright pass over the finished pixel art.',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0.3, max: 0.98, step: 0.01, default: 0.7 },
      { key: 'radius', label: 'Radius', min: 1, max: 20, step: 0.5, default: 3, unit: 'art px' },
      { key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.45 },
    ],
  },
  {
    type: 'grain',
    title: 'Grain',
    category: 'colour',
    description: 'Adds a final layer of film or paper grain.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.08 },
      { key: 'scale', label: 'Grain size', min: 0.5, max: 6, step: 0.5, default: 1, unit: 'art px' },
      { key: 'monochrome', label: 'Monochrome', min: 0, max: 1, step: 1, default: 1 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, step: 1, default: 21 },
    ],
  },
  {
    type: 'scanlines',
    title: 'Scanlines',
    category: 'output',
    description: 'Classic CRT scanlines at a configurable art-pixel spacing.',
    params: [
      { key: 'spacing', label: 'Spacing', min: 2, max: 12, step: 0.5, default: 3, unit: 'art px' },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.22 },
    ],
  },
  {
    type: 'vignette',
    title: 'Vignette',
    category: 'colour',
    description: 'Darkens the corners for a focused, cinematic frame.',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'radius', label: 'Inner radius', min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
  },
  {
    type: 'chromatic',
    title: 'Chromatic aberration',
    category: 'distort',
    description: 'Splits red and blue channels horizontally for a lens/glitch look.',
    params: [
      { key: 'amount', label: 'Offset', min: 0, max: 3, step: 0.1, default: 0.5, unit: 'art px' },
    ],
  },
  {
    type: 'crt',
    title: 'CRT monitor',
    category: 'output',
    description: 'Combines bloom, scanlines, chromatic aberration and vignette.',
    params: [
      { key: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'spacing', label: 'Scanline spacing', min: 2, max: 8, step: 0.5, default: 2.5, unit: 'art px' },
      { key: 'strength', label: 'Scanline strength', min: 0, max: 1, step: 0.01, default: 0.2 },
      { key: 'chromatic', label: 'Aberration', min: 0, max: 2, step: 0.1, default: 0.6 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  {
    type: 'sharpen',
    title: 'Final sharpen',
    category: 'detail',
    description: 'Unsharp mask applied after dithering to crisp up the result.',
    params: [
      { key: 'radius', label: 'Radius', min: 0.3, max: 3, step: 0.1, default: 0.8, unit: 'art px' },
      { key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.5 },
    ],
  },
];

export const POSTPROCESS_BY_TYPE: Record<PostprocessType, EffectDefinition<PostprocessType>> =
  Object.fromEntries(POSTPROCESS_DEFS.map((d) => [d.type, d])) as Record<
    PostprocessType,
    EffectDefinition<PostprocessType>
  >;

export function defaultParams(def: EffectDefinition<string>): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export function createPostprocessOp(type: PostprocessType): PostprocessOp {
  const def = POSTPROCESS_BY_TYPE[type];
  return {
    id: `post-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    enabled: true,
    params: defaultParams(def),
    color: type === 'outline' ? '#101018' : undefined,
  };
}

export function createPreprocessOp(type: PreprocessType): PreprocessOp {
  const def = PREPROCESS_BY_TYPE[type];
  return {
    id: `pre-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    enabled: true,
    params: defaultParams(def),
  };
}

/** Structural subset shared by pre- and post-process operations. */
interface EffectOpFields {
  params: Record<string, number>;
  color?: string;
}

export interface EffectContext {
  /** Width/height of the final art before export scaling. */
  artWidth: number;
  artHeight: number;
  /** Deterministic seed for this render. */
  seed?: number;
}

const scaleOf = (img: PixelImage, ctx: EffectContext): number =>
  Math.max(0.05, img.width / Math.max(1, ctx.artWidth));

export function applyPreprocess(
  input: PixelImage,
  ops: PreprocessOp[],
  ctx: EffectContext,
): PixelImage {
  let img = input;
  for (const op of ops) {
    if (!op.enabled) continue;
    switch (op.type) {
      case 'colorCorrect':
        img = colorCorrect(img, op);
        break;
      case 'painterly':
        img = painterly(img, op, ctx);
        break;
      case 'oil':
        img = oilPaint(img, op, ctx);
        break;
      case 'watercolor':
        img = watercolor(img, op, ctx);
        break;
      case 'posterize':
        img = posterize(img, op);
        break;
      case 'displace':
        img = displace(img, op, ctx);
        break;
      case 'grain':
        img = grain(img, op, ctx);
        break;
      case 'soften':
        img = soften(img, op, ctx);
        break;
      case 'sharpen':
        img = unsharpMask(
          img,
          Math.max(0.5, (op.params.radius ?? 1) * scaleOf(img, ctx)),
          op.params.amount ?? 0.7,
        );
        break;
      case 'bloom':
        img = bloom(img, op, ctx);
        break;
      case 'pixelBlur':
        img = pixelBlur(img, op, ctx);
        break;
      default:
        break;
    }
  }
  return img;
}

/* -------------------------------------------------------------------------- */
/* Implementations                                                            */
/* -------------------------------------------------------------------------- */

export function applyColorCorrection(
  img: PixelImage,
  settings: Partial<ColorCorrectionSettings>,
): PixelImage {
  const p = { ...DEFAULT_COLOR_CORRECTION, ...settings };
  const out = cloneImage(img);
  const exposureFactor = Math.pow(2, p.exposure);
  const temperature = clamp(p.temperature, -1, 1);
  const tint = clamp(p.tint, -1, 1);
  const rGain = exposureFactor * Math.max(0.05, 1 + temperature * 0.28 + tint * 0.06);
  const gGain = exposureFactor * Math.max(0.05, 1 - tint * 0.22);
  const bGain = exposureFactor * Math.max(0.05, 1 - temperature * 0.28 + tint * 0.06);
  const data = out.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = Math.pow(srgbToLinear(data[i] / 255) * rGain, 1);
    const g = Math.pow(srgbToLinear(data[i + 1] / 255) * gGain, 1);
    const b = Math.pow(srgbToLinear(data[i + 2] / 255) * bGain, 1);
    data[i] = linearToSrgb(r) * 255;
    data[i + 1] = linearToSrgb(g) * 255;
    data[i + 2] = linearToSrgb(b) * 255;
  }

  applyTone(out, {
    brightness: p.brightness,
    contrast: p.contrast,
    saturation: p.saturation,
    gamma: p.gamma,
    hueShift: p.hueShift,
  });
  return out;
}

function colorCorrect(img: PixelImage, op: PreprocessOp): PixelImage {
  return applyColorCorrection(img, op.params);
}

function painterly(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const radius = Math.max(1, Math.round((op.params.radius ?? 3) * scaleOf(img, ctx)));
  const strength = clamp01(op.params.strength ?? 1);
  const passes = clamp(Math.round(op.params.passes ?? 1), 1, 3);
  let out = img;
  for (let i = 0; i < passes; i++) {
    const k = kuwahara(out, radius);
    out = blendImages(img, k, strength);
  }
  return out;
}

function kuwahara(img: PixelImage, radius: number): PixelImage {
  const w = img.width;
  const h = img.height;
  const stride = w + 1;
  const count = stride * (h + 1);
  const ir = new Float64Array(count);
  const ig = new Float64Array(count);
  const ib = new Float64Array(count);
  const ir2 = new Float64Array(count);
  const ig2 = new Float64Array(count);
  const ib2 = new Float64Array(count);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    let rr = 0;
    let gg = 0;
    let bb = 0;
    let rr2 = 0;
    let gg2 = 0;
    let bb2 = 0;
    const base = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      rr += r;
      gg += g;
      bb += b;
      rr2 += r * r;
      gg2 += g * g;
      bb2 += b * b;
      ir[base + x + 1] = ir[prev + x + 1] + rr;
      ig[base + x + 1] = ig[prev + x + 1] + gg;
      ib[base + x + 1] = ib[prev + x + 1] + bb;
      ir2[base + x + 1] = ir2[prev + x + 1] + rr2;
      ig2[base + x + 1] = ig2[prev + x + 1] + gg2;
      ib2[base + x + 1] = ib2[prev + x + 1] + bb2;
    }
  }

  const rect = (arr: Float64Array, x0: number, y0: number, x1: number, y1: number): number => {
    const i00 = y0 * stride + x0;
    const i10 = y0 * stride + x1;
    const i01 = y1 * stride + x0;
    const i11 = y1 * stride + x1;
    return arr[i11] - arr[i10] - arr[i01] + arr[i00];
  };

  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + 1);
      const x2 = Math.min(w, x + radius + 1);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + 1);
      const y2 = Math.min(h, y + radius + 1);

      let bestScore = Infinity;
      let br = 0;
      let bg = 0;
      let bb = 0;
      const quads: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y0, x2, y1],
        [x0, y1, x1, y2],
        [x1, y1, x2, y2],
      ];
      for (const [ax, ay, bx, by] of quads) {
        if (bx <= ax || by <= ay) continue;
        const area = (bx - ax) * (by - ay);
        const sr = rect(ir, ax, ay, bx, by);
        const sg = rect(ig, ax, ay, bx, by);
        const sb = rect(ib, ax, ay, bx, by);
        const mr = sr / area;
        const mg = sg / area;
        const mb = sb / area;
        const vr = Math.max(0, rect(ir2, ax, ay, bx, by) / area - mr * mr);
        const vg = Math.max(0, rect(ig2, ax, ay, bx, by) / area - mg * mg);
        const vb = Math.max(0, rect(ib2, ax, ay, bx, by) / area - mb * mb);
        const score = vr * 0.3 + vg * 0.6 + vb * 0.1;
        if (score < bestScore) {
          bestScore = score;
          br = mr;
          bg = mg;
          bb = mb;
        }
      }

      const i = (y * w + x) * 4;
      out.data[i] = br;
      out.data[i + 1] = bg;
      out.data[i + 2] = bb;
      out.data[i + 3] = d[i + 3];
    }
  }
  return out;
}

function oilPaint(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const radius = Math.max(1, Math.round((op.params.radius ?? 2) * scaleOf(img, ctx)));
  const levels = clamp(Math.round(op.params.levels ?? 8), 3, 24);
  const strength = clamp01(op.params.strength ?? 1);
  const w = img.width;
  const h = img.height;
  const out = createImage(w, h);
  const d = img.data;
  const counts = new Uint16Array(levels);
  const sumsR = new Float64Array(levels);
  const sumsG = new Float64Array(levels);
  const sumsB = new Float64Array(levels);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      counts.fill(0);
      sumsR.fill(0);
      sumsG.fill(0);
      sumsB.fill(0);
      let total = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const bin = Math.min(levels - 1, Math.floor(luma * levels));
          counts[bin]++;
          sumsR[bin] += r;
          sumsG[bin] += g;
          sumsB[bin] += b;
          total++;
        }
      }
      let best = 0;
      for (let i = 1; i < levels; i++) if (counts[i] > counts[best]) best = i;
      const n = Math.max(1, counts[best]);
      const i = (y * w + x) * 4;
      out.data[i] = lerp(d[i], sumsR[best] / n, strength);
      out.data[i + 1] = lerp(d[i + 1], sumsG[best] / n, strength);
      out.data[i + 2] = lerp(d[i + 2], sumsB[best] / n, strength);
      out.data[i + 3] = d[i + 3];
      void total;
    }
  }
  return out;
}

function watercolor(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const scale = scaleOf(img, ctx);
  const radius = Math.max(1, Math.round((op.params.radius ?? 2) * scale));
  const softness = clamp01(op.params.softness ?? 0.25);
  const texture = clamp01(op.params.texture ?? 0.18);
  const strength = clamp01(op.params.strength ?? 0.9);

  const k = kuwahara(img, radius);
  const soft = gaussianBlurRGBA(k, Math.max(0.5, radius * softness));
  let out = blendImages(k, soft, softness * 0.7);
  out = blendImages(img, out, strength);

  // Paper granulation and gentle pigment pooling.
  const rng = mulberry32(0x51ed270b + (op.params.seed ?? 0));
  const jitter = rng() * 1000;
  const d = out.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4;
      const n = fbm2D((x / scale) * 0.35 + jitter, (y / scale) * 0.35 + jitter, {
        octaves: 3,
        seed: 17,
      });
      const v = (n - 0.5) * texture * 34;
      d[i] += v;
      d[i + 1] += v;
      d[i + 2] += v;
    }
  }
  return out;
}

function posterize(img: PixelImage, op: PreprocessOp): PixelImage {
  const levels = clamp(Math.round(op.params.levels ?? 8), 2, 32);
  const strength = clamp01(op.params.strength ?? 1);
  const out = cloneImage(img);
  const step = 255 / (levels - 1);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = out.data[i + c];
      const q = Math.round(v / step) * step;
      out.data[i + c] = lerp(v, q, strength);
    }
  }
  return out;
}

function displace(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const scale = scaleOf(img, ctx);
  const amplitude = (op.params.amplitude ?? 3) * scale;
  const feature = Math.max(2, (op.params.scale ?? 18) * scale);
  const octaves = clamp(Math.round(op.params.octaves ?? 3), 1, 6);
  const seed = Math.round(op.params.seed ?? 0);
  const chromatic = clamp01(op.params.chromatic ?? 0);
  const out = createImage(img.width, img.height);
  const w = img.width;
  const h = img.height;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / feature;
      const ny = y / feature;
      const dx = (fbm2D(nx, ny, { octaves, seed: seed + 11 }) - 0.5) * 2 * amplitude;
      const dy = (fbm2D(nx, ny, { octaves, seed: seed + 37 }) - 0.5) * 2 * amplitude;
      const sample = sampleBilinear(img, x + dx, y + dy);
      const i = (y * w + x) * 4;
      out.data[i] = sample.r;
      out.data[i + 1] = sample.g;
      out.data[i + 2] = sample.b;
      out.data[i + 3] = sample.a;
      if (chromatic > 0 && amplitude > 0.01) {
        const rs = sampleBilinear(img, x + dx * (1 + chromatic * 0.8), y + dy);
        const bs = sampleBilinear(img, x + dx * (1 - chromatic * 0.8), y + dy);
        out.data[i] = lerp(sample.r, rs.r, 1);
        out.data[i + 2] = lerp(sample.b, bs.b, 1);
      }
    }
  }
  return out;
}

function grain(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const scale = scaleOf(img, ctx);
  const amount = clamp01(op.params.amount ?? 0.12) * 255;
  const size = Math.max(0.5, (op.params.scale ?? 1) * scale);
  const mono = (op.params.monochrome ?? 1) > 0.5;
  const seed = Math.round(op.params.seed ?? 7);
  const out = cloneImage(img);
  const d = out.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4;
      const sx = Math.floor(x / size);
      const sy = Math.floor(y / size);
      if (mono) {
        const n = (hash2(sx, sy, seed) - 0.5) * amount;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      } else {
        d[i] += (hash2(sx, sy, seed) - 0.5) * amount;
        d[i + 1] += (hash2(sx, sy, seed + 1) - 0.5) * amount;
        d[i + 2] += (hash2(sx, sy, seed + 2) - 0.5) * amount;
      }
    }
  }
  return out;
}

function soften(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const radius = (op.params.radius ?? 2) * scaleOf(img, ctx);
  const strength = clamp01(op.params.strength ?? 1);
  return blendImages(img, gaussianBlurRGBA(img, radius), strength);
}

function bloom(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const threshold = clamp01(op.params.threshold ?? 0.72);
  const radius = Math.max(1, (op.params.radius ?? 6) * scaleOf(img, ctx));
  const amount = Math.max(0, op.params.amount ?? 0.5);

  const bright = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const luma = (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
    const k = Math.max(0, luma - threshold) / Math.max(0.001, 1 - threshold);
    bright.data[i] = img.data[i] * k;
    bright.data[i + 1] = img.data[i + 1] * k;
    bright.data[i + 2] = img.data[i + 2] * k;
    bright.data[i + 3] = img.data[i + 3] * k;
  }
  const glow = gaussianBlurRGBA(bright, radius);
  const out = cloneImage(img);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = Math.min(255, img.data[i] + glow.data[i] * amount);
    out.data[i + 1] = Math.min(255, img.data[i + 1] + glow.data[i + 1] * amount);
    out.data[i + 2] = Math.min(255, img.data[i + 2] + glow.data[i + 2] * amount);
  }
  return out;
}

function pixelBlur(img: PixelImage, op: PreprocessOp, ctx: EffectContext): PixelImage {
  const block = Math.max(1, Math.round((op.params.block ?? 2) * scaleOf(img, ctx)));
  const strength = clamp01(op.params.strength ?? 1);
  if (block <= 1) return cloneImage(img);
  const out = cloneImage(img);
  for (let by = 0; by < img.height; by += block) {
    for (let bx = 0; bx < img.width; bx += block) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = by; y < Math.min(img.height, by + block); y++) {
        for (let x = bx; x < Math.min(img.width, bx + block); x++) {
          const i = (y * img.width + x) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      }
      if (n === 0) continue;
      for (let y = by; y < Math.min(img.height, by + block); y++) {
        for (let x = bx; x < Math.min(img.width, bx + block); x++) {
          const i = (y * img.width + x) * 4;
          out.data[i] = lerp(img.data[i], r / n, strength);
          out.data[i + 1] = lerp(img.data[i + 1], g / n, strength);
          out.data[i + 2] = lerp(img.data[i + 2], b / n, strength);
          out.data[i + 3] = lerp(img.data[i + 3], a / n, strength);
        }
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

export function blendImages(a: PixelImage, b: PixelImage, t: number): PixelImage {
  const out = cloneImage(a);
  const k = clamp01(t);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = lerp(a.data[i], b.data[i], k);
  }
  return out;
}

export function applyPostprocess(
  input: PixelImage,
  ops: PostprocessOp[],
  ctx: EffectContext,
): PixelImage {
  let img = input;
  for (const op of ops) {
    if (!op.enabled) continue;
    switch (op.type) {
      case 'outline':
        img = outline(img, op, ctx);
        break;
      case 'bloom':
        img = bloom(img, op, { ...ctx, artWidth: img.width, artHeight: img.height });
        break;
      case 'grain':
        img = grain(img, op, { ...ctx, artWidth: img.width, artHeight: img.height });
        break;
      case 'scanlines':
        img = scanlines(img, op, ctx);
        break;
      case 'vignette':
        img = vignette(img, op, ctx);
        break;
      case 'chromatic':
        img = chromatic(img, op, ctx);
        break;
      case 'crt':
        img = crt(img, op, ctx);
        break;
      case 'sharpen':
        img = unsharpMask(img, Math.max(0.5, op.params.radius ?? 1), op.params.amount ?? 0.7);
        break;
      default:
        break;
    }
  }
  return img;
}

function outline(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const thickness = Math.max(1, Math.round((op.params.thickness ?? 1) * scaleOf(img, ctx)));
  const opacity = clamp01(op.params.opacity ?? 1);
  const inner = (op.params.inner ?? 0) > 0.5;
  const color = parseHex(op.color ?? '#101018');
  const out = cloneImage(img);
  const w = img.width;
  const h = img.height;
  const d = out.data;

  const isOpaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return img.data[(y * w + x) * 4 + 3] > 8;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const opaque = img.data[i + 3] > 8;
      if (inner && opaque) {
        let edge = false;
        for (let r = 1; r <= thickness && !edge; r++) {
          if (!isOpaque(x - r, y) || !isOpaque(x + r, y) || !isOpaque(x, y - r) || !isOpaque(x, y + r)) {
            edge = true;
          }
        }
        if (edge) {
          d[i] = lerp(d[i], color.r, opacity);
          d[i + 1] = lerp(d[i + 1], color.g, opacity);
          d[i + 2] = lerp(d[i + 2], color.b, opacity);
        }
      } else if (!inner && !opaque) {
        let edge = false;
        for (let oy = -thickness; oy <= thickness && !edge; oy++) {
          for (let ox = -thickness; ox <= thickness; ox++) {
            if (ox * ox + oy * oy <= thickness * thickness && isOpaque(x + ox, y + oy)) {
              edge = true;
              break;
            }
          }
        }
        if (edge) {
          d[i] = color.r;
          d[i + 1] = color.g;
          d[i + 2] = color.b;
          d[i + 3] = Math.round(255 * opacity);
        }
      }
    }
  }
  return out;
}

function scanlines(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const spacing = Math.max(2, Math.round((op.params.spacing ?? 3) * scaleOf(img, ctx)));
  const strength = clamp01(op.params.strength ?? 0.25);
  const out = cloneImage(img);
  for (let y = 0; y < out.height; y++) {
    const phase = (y % spacing) / spacing;
    const darken = 1 - strength * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4;
      out.data[i] *= darken;
      out.data[i + 1] *= darken;
      out.data[i + 2] *= darken;
    }
  }
  void ctx;
  return out;
}

function vignette(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const amount = clamp01(op.params.amount ?? 0.35);
  const radius = clamp01(op.params.radius ?? 0.65);
  const out = cloneImage(img);
  const cx = out.width / 2;
  const cy = out.height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.sqrt(dx * dx + dy * dy);
      const t = clamp01((r - radius) / Math.max(0.001, 1 - radius));
      const k = 1 - amount * t * t;
      const i = (y * out.width + x) * 4;
      out.data[i] *= k;
      out.data[i + 1] *= k;
      out.data[i + 2] *= k;
    }
  }
  void ctx;
  return out;
}

function chromatic(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  const amount = Math.max(0, (op.params.amount ?? 0.5) * scaleOf(img, ctx));
  if (amount < 0.01) return cloneImage(img);
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = sampleBilinear(img, x - amount, y);
      const g = sampleBilinear(img, x, y);
      const b = sampleBilinear(img, x + amount, y);
      out.data[i] = r.r;
      out.data[i + 1] = g.g;
      out.data[i + 2] = b.b;
      out.data[i + 3] = Math.max(r.a, g.a, b.a);
    }
  }
  void ctx;
  return out;
}

function crt(img: PixelImage, op: EffectOpFields, ctx: EffectContext): PixelImage {
  let out = img;
  out = bloom(
    out,
    {
      ...op,
      params: { threshold: 0.7, radius: 4, amount: op.params.bloom ?? 0.35 },
    },
    ctx,
  );
  out = scanlines(
    out,
    { ...op, params: { spacing: op.params.spacing ?? 2.5, strength: op.params.strength ?? 0.22 } },
    ctx,
  );
  out = chromatic(out, { ...op, params: { amount: op.params.chromatic ?? 0.6 } }, ctx);
  out = vignette(out, { ...op, params: { amount: op.params.vignette ?? 0.3, radius: 0.6 } }, ctx);
  return out;
}
