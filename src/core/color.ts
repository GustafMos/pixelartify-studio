/**
 * Colour science utilities.
 *
 * Conversions follow Björn Ottosson's OKLab specification (MIT).
 * https://bottosson.github.io/posts/oklab/
 */

import type { HarmonyOptions, HarmonyRule } from './types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/* -------------------------------------------------------------------------- */
/* sRGB / linear                                                              */
/* -------------------------------------------------------------------------- */

const SRGB_TO_LINEAR = new Float32Array(256);
const LINEAR_TO_SRGB = new Uint8ClampedArray(4097);

for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(clamp01(v) * 255);
}

export const srgbToLinear = (c: number): number =>
  c <= 1 ? SRGB_TO_LINEAR[Math.round(clamp01(c) * 255)] : Math.pow(c, 2.4);

export const linearToSrgb = (c: number): number =>
  LINEAR_TO_SRGB[Math.round(clamp01(c) * 4096)] / 255;

/* -------------------------------------------------------------------------- */
/* HEX                                                                        */
/* -------------------------------------------------------------------------- */

const HEX_CACHE = new Map<string, RGBA>();

export function parseHex(input: string): RGBA {
  const cached = HEX_CACHE.get(input);
  if (cached) return { ...cached };

  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) {
    throw new Error(`Invalid colour: ${input}`);
  }
  const value = Number.parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
  const out: RGBA = {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: Number.isFinite(alpha) ? alpha : 255,
  };
  HEX_CACHE.set(input, out);
  return { ...out };
}

const to2 = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgbaToHex(c: RGB, includeAlpha = false, alpha = 255): string {
  const base = rgbToHex(c.r, c.g, c.b);
  return includeAlpha ? `${base}${to2(alpha)}` : base;
}

export function normalizeHex(input: string): string {
  const c = parseHex(input);
  return rgbToHex(c.r, c.g, c.b);
}

/* -------------------------------------------------------------------------- */
/* OKLab                                                                      */
/* -------------------------------------------------------------------------- */

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = SRGB_TO_LINEAR[clamp(Math.round(r), 0, 255)];
  const lg = SRGB_TO_LINEAR[clamp(Math.round(g), 0, 255)];
  const lb = SRGB_TO_LINEAR[clamp(Math.round(b), 0, 255)];

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: Math.round(linearToSrgb(lr) * 255),
    g: Math.round(linearToSrgb(lg) * 255),
    b: Math.round(linearToSrgb(lb) * 255),
  };
}

/** Squared perceptual distance, scaled to roughly 0..1 for typical colours. */
export function oklabDistanceSq(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL * 1.0 + da * da * 1.4 + db * db * 1.4;
}

export function deltaE(a: RGB, b: RGB): number {
  return Math.sqrt(oklabDistanceSq(rgbToOklab(a.r, a.g, a.b), rgbToOklab(b.r, b.g, b.b)));
}

/* -------------------------------------------------------------------------- */
/* HSL                                                                        */
/* -------------------------------------------------------------------------- */

export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp01(s);
  const light = clamp01(l);
  if (sat === 0) {
    const v = Math.round(light * 255);
    return { r: v, g: v, b: v };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hue + 1 / 3) * 255),
    g: Math.round(channel(hue) * 255),
    b: Math.round(channel(hue - 1 / 3) * 255),
  };
}

export function hexToHsl(hex: string): HSL {
  const c = parseHex(hex);
  return rgbToHsl(c.r, c.g, c.b);
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = hslToRgb(h, s, l);
  return rgbToHex(c.r, c.g, c.b);
}

/* -------------------------------------------------------------------------- */
/* Luminance & contrast                                                       */
/* -------------------------------------------------------------------------- */

export function relativeLuminance(r: number, g: number, b: number): number {
  const rl = SRGB_TO_LINEAR[clamp(Math.round(r), 0, 255)];
  const gl = SRGB_TO_LINEAR[clamp(Math.round(g), 0, 255)];
  const bl = SRGB_TO_LINEAR[clamp(Math.round(b), 0, 255)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const ca = typeof a === 'string' ? parseHex(a) : a;
  const cb = typeof b === 'string' ? parseHex(b) : b;
  const la = relativeLuminance(ca.r, ca.g, ca.b);
  const lb = relativeLuminance(cb.r, cb.g, cb.b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastGrade(ratio: number): string {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

export function bestTextColor(background: string | RGB): string {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}

/* -------------------------------------------------------------------------- */
/* Mixing                                                                     */
/* -------------------------------------------------------------------------- */

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

export function mixHex(a: string, b: string, t: number): string {
  const c = mixRgb(parseHex(a), parseHex(b), t);
  return rgbToHex(c.r, c.g, c.b);
}

export function adjustHex(hex: string, lightnessDelta = 0, saturationDelta = 0): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, clamp01(s + saturationDelta), clamp01(l + lightnessDelta));
}

export function shadeRamp(base: string, steps = 9): string[] {
  const { h, s } = hexToHsl(base);
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const l = 0.06 + t * 0.88;
    const sat = s * (1 - Math.abs(t - 0.5) * 0.9);
    out.push(hslToHex(h, clamp01(sat), l));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Colour blindness simulation (Machado et al. 2009 approximations)           */
/* -------------------------------------------------------------------------- */

export type ColorBlindness = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

const CVD_MATRICES: Record<ColorBlindness, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  achromatopsia: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};

export function simulateColorBlindness(color: string | RGB, type: ColorBlindness): string {
  const c = typeof color === 'string' ? parseHex(color) : color;
  const lr = SRGB_TO_LINEAR[c.r];
  const lg = SRGB_TO_LINEAR[c.g];
  const lb = SRGB_TO_LINEAR[c.b];
  const m = CVD_MATRICES[type];
  const r = m[0] * lr + m[1] * lg + m[2] * lb;
  const g = m[3] * lr + m[4] * lg + m[5] * lb;
  const b = m[6] * lr + m[7] * lg + m[8] * lb;
  return rgbToHex(
    Math.round(linearToSrgb(r) * 255),
    Math.round(linearToSrgb(g) * 255),
    Math.round(linearToSrgb(b) * 255),
  );
}

/* -------------------------------------------------------------------------- */
/* Harmony generation (Adobe Color style)                                     */
/* -------------------------------------------------------------------------- */

interface HarmonyRuleDef {
  offsets: number[];
  lightnessOffsets: number[];
  saturationOffsets: number[];
}

const HARMONY_RULES: Record<HarmonyRule, HarmonyRuleDef> = {
  monochromatic: {
    offsets: [0, 0, 0, 0, 0],
    lightnessOffsets: [0, 0.14, -0.14, 0.26, -0.26],
    saturationOffsets: [0, -0.08, 0.08, -0.16, 0.04],
  },
  analogous: {
    offsets: [-36, -18, 0, 18, 36],
    lightnessOffsets: [-0.08, 0.06, 0, 0.1, -0.1],
    saturationOffsets: [0.04, -0.04, 0, 0.06, -0.06],
  },
  complementary: {
    offsets: [0, 0, 180, 180, 0],
    lightnessOffsets: [0, 0.18, 0, 0.18, -0.18],
    saturationOffsets: [0, -0.1, 0, -0.1, 0.08],
  },
  'split-complementary': {
    offsets: [0, 150, 210, 0, 180],
    lightnessOffsets: [0, 0.08, 0.08, 0.2, -0.05],
    saturationOffsets: [0, -0.04, -0.04, -0.12, 0.02],
  },
  triadic: {
    offsets: [0, 120, 240, 120, 240],
    lightnessOffsets: [0, 0.02, 0.02, 0.18, -0.16],
    saturationOffsets: [0, 0, 0, -0.1, 0.06],
  },
  tetradic: {
    offsets: [0, 90, 180, 270, 0],
    lightnessOffsets: [0, 0.04, 0.02, 0.04, 0.2],
    saturationOffsets: [0, 0, 0, 0, -0.14],
  },
  square: {
    offsets: [0, 90, 180, 270, 45],
    lightnessOffsets: [0, 0.03, 0.03, 0.03, 0.18],
    saturationOffsets: [0, 0, 0, 0, -0.12],
  },
  compound: {
    offsets: [0, 24, 180, 204, 330],
    lightnessOffsets: [0, 0.08, 0.02, 0.12, -0.06],
    saturationOffsets: [0, -0.05, 0, -0.08, 0.02],
  },
};

export function generateHarmony(options: HarmonyOptions): string[] {
  const rule = HARMONY_RULES[options.rule] ?? HARMONY_RULES.analogous;
  const base = parseHex(options.base);
  const hsl = rgbToHsl(base.r, base.g, base.b);
  const count = clamp(Math.round(options.count), 2, 10);
  const spread = options.spread;

  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i % rule.offsets.length;
    const cycle = Math.floor(i / rule.offsets.length);
    const hue = hsl.h + rule.offsets[idx] * spread + cycle * 4;
    const light = clamp01(
      hsl.l +
        rule.lightnessOffsets[idx] * options.lightness +
        cycle * 0.05 * (i % 2 === 0 ? 1 : -1),
    );
    const sat = clamp01(
      hsl.s * options.saturation + rule.saturationOffsets[idx] * options.saturation,
    );
    colors.push(hslToHex(hue, sat, light));
  }
  return colors;
}

export function contrastPairs(colors: string[]): Array<{ a: string; b: string; ratio: number; grade: string }> {
  const pairs: Array<{ a: string; b: string; ratio: number; grade: string }> = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const ratio = contrastRatio(colors[i], colors[j]);
      pairs.push({ a: colors[i], b: colors[j], ratio, grade: contrastGrade(ratio) });
    }
  }
  return pairs;
}
