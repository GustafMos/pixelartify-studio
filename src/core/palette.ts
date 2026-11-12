/**
 * Palette extraction, matching, harmony and interchange formats.
 *
 * Supported imports: GPL (GIMP), JASC-PAL, Paint.NET / Lospec `.hex`,
 * plain hex lists and JSON. These are the formats used by Lospec and
 * Ditherista, among others.
 */

import type {
  PaletteColorSpace,
  PaletteDefinition,
  PixelImage,
  Quantizer,
} from './types';
import { clamp, clamp01, lerp, parseHex, rgbToHex, rgbToOklab, oklabToRgb, type Lab, type RGB } from './color';

export interface PaletteMatchOptions {
  space: PaletteColorSpace;
}

export interface PaletteMatcher {
  colors: RGB[];
  space: PaletteColorSpace;
  match(r: number, g: number, b: number): number;
  distance(r: number, g: number, b: number): number;
}

function buildMatcher(colors: RGB[], space: PaletteColorSpace): PaletteMatcher {
  const labs: Lab[] = colors.map((c) => rgbToOklab(c.r, c.g, c.b));
  const cache = new Map<number, number>();

  const nearest = (r: number, g: number, b: number): number => {
    if (colors.length === 0) return -1;
    if (space === 'oklab') {
      const target = rgbToOklab(r, g, b);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < labs.length; i++) {
        const p = labs[i];
        const dl = target.L - p.L;
        const da = target.a - p.a;
        const db = target.b - p.b;
        const d = dl * dl + da * da * 1.6 + db * db * 1.6;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  return {
    colors,
    space,
    match(r, g, b) {
      const key = ((Math.round(r) >> 3) << 10) | ((Math.round(g) >> 3) << 5) | (Math.round(b) >> 3);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const idx = nearest(r, g, b);
      if (cache.size < 65536) cache.set(key, idx);
      return idx;
    },
    distance(r, g, b) {
      const idx = nearest(r, g, b);
      if (idx < 0) return Infinity;
      return colorDistance({ r, g, b }, colors[idx], space);
    },
  };
}

export function createPaletteMatcher(hexColors: string[], space: PaletteColorSpace = 'oklab'): PaletteMatcher {
  return buildMatcher(hexColors.map(parseHex), space);
}

function colorDistance(a: RGB, b: RGB, space: PaletteColorSpace): number {
  if (space === 'oklab') {
    const la = rgbToOklab(a.r, a.g, a.b);
    const lb = rgbToOklab(b.r, b.g, b.b);
    const dl = la.L - lb.L;
    const da = la.a - lb.a;
    const db = la.b - lb.b;
    return Math.sqrt(dl * dl + da * da * 1.6 + db * db * 1.6);
  }
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

export interface SampleOptions {
  maxSamples?: number;
  alphaThreshold?: number;
}

export function samplePixels(img: PixelImage, options: SampleOptions = {}): RGB[] {
  const maxSamples = options.maxSamples ?? 24000;
  const alphaThreshold = options.alphaThreshold ?? 24;
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const samples: RGB[] = [];
  const data = img.data;
  let i = 0;
  for (let p = 0; p < total; p += stride, i += stride * 4) {
    const ai = i + 3;
    if (ai >= data.length) break;
    if (data[ai] < alphaThreshold) continue;
    samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return samples;
}

export function extractPalette(
  img: PixelImage,
  count: number,
  quantizer: Quantizer = 'kmeans',
  options: SampleOptions = {},
): string[] {
  const target = clamp(Math.round(count), 2, 256);
  const samples = samplePixels(img, options);
  if (samples.length === 0) return ['#000000', '#ffffff'];

  const initial = medianCut(samples, target);
  const refined = quantizer === 'kmeans' ? kMeans(samples, initial, 10) : initial;
  return dedupePalette(refined.map((c) => rgbToHex(c.r, c.g, c.b))).slice(0, target);
}

function medianCut(samples: RGB[], count: number): RGB[] {
  if (samples.length <= count) {
    return samples.map((c) => ({ ...c }));
  }

  interface Box {
    colors: RGB[];
    range: number;
    channel: 0 | 1 | 2;
  }

  const makeBox = (colors: RGB[]): Box => {
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;
    for (const c of colors) {
      if (c.r < rMin) rMin = c.r;
      if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g;
      if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b;
      if (c.b > bMax) bMax = c.b;
    }
    const ranges: Array<[number, 0 | 1 | 2]> = [
      [rMax - rMin, 0],
      [gMax - gMin, 1],
      [bMax - bMin, 2],
    ];
    ranges.sort((a, b) => b[0] - a[0]);
    return { colors, range: ranges[0][0], channel: ranges[0][1] };
  };

  const boxes: Box[] = [makeBox(samples)];
  while (boxes.length < count) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const score = b.range * Math.log2(b.colors.length + 1);
      if (b.colors.length > 1 && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const box = boxes[bestIdx];
    const ch = box.channel;
    const sorted = box.colors.slice().sort((a, b) => a[ch === 0 ? 'r' : ch === 1 ? 'g' : 'b'] - b[ch === 0 ? 'r' : ch === 1 ? 'g' : 'b']);
    const mid = Math.floor(sorted.length / 2);
    boxes.splice(bestIdx, 1, makeBox(sorted.slice(0, mid)), makeBox(sorted.slice(mid)));
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const c of box.colors) {
      r += c.r;
      g += c.g;
      b += c.b;
    }
    const n = Math.max(1, box.colors.length);
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  });
}

function kMeans(samples: RGB[], initial: RGB[], iterations: number): RGB[] {
  const k = Math.min(initial.length, samples.length);
  if (k === 0) return [];
  let centers = initial.slice(0, k).map((c) => rgbToOklab(c.r, c.g, c.b));

  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (const s of samples) {
      const lab = rgbToOklab(s.r, s.g, s.b);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const dl = lab.L - c.L;
        const da = lab.a - c.a;
        const db = lab.b - c.b;
        const d = dl * dl + da * da * 1.6 + db * db * 1.6;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      sums[best].L += lab.L;
      sums[best].a += lab.a;
      sums[best].b += lab.b;
      sums[best].n++;
    }
    let moved = 0;
    for (let i = 0; i < k; i++) {
      if (sums[i].n === 0) continue;
      const next = {
        L: sums[i].L / sums[i].n,
        a: sums[i].a / sums[i].n,
        b: sums[i].b / sums[i].n,
      };
      moved += Math.abs(next.L - centers[i].L) + Math.abs(next.a - centers[i].a) + Math.abs(next.b - centers[i].b);
      centers[i] = next;
    }
    if (moved < 0.001) break;
  }

  return centers.map((c) => {
    const rgb = oklabToRgb(c.L, c.a, c.b);
    return { r: clamp(rgb.r, 0, 255), g: clamp(rgb.g, 0, 255), b: clamp(rgb.b, 0, 255) };
  });
}

export function dedupePalette(colors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of colors) {
    try {
      const hex = rgbToHex(parseHex(c).r, parseHex(c).g, parseHex(c).b);
      if (!seen.has(hex)) {
        seen.add(hex);
        out.push(hex);
      }
    } catch {
      // Ignore malformed colours.
    }
  }
  return out;
}

/** Snap an image to a palette without dithering (used for palette lock). */
export function snapToPalette(
  img: PixelImage,
  colors: string[],
  space: PaletteColorSpace,
  strength = 1,
): void {
  if (colors.length === 0) return;
  const matcher = createPaletteMatcher(colors, space);
  const k = clamp01(strength);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const idx = matcher.match(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (idx < 0) continue;
    const c = matcher.colors[idx];
    img.data[i] = lerp(img.data[i], c.r, k);
    img.data[i + 1] = lerp(img.data[i + 1], c.g, k);
    img.data[i + 2] = lerp(img.data[i + 2], c.b, k);
  }
}

/* -------------------------------------------------------------------------- */
/* Palette formats                                                            */
/* -------------------------------------------------------------------------- */

export type PaletteFormat = 'hex' | 'gpl' | 'jasc' | 'paintnet' | 'json';

export function serializePalette(
  colors: string[],
  format: PaletteFormat,
  name = 'PixelArtify Palette',
): string {
  const clean = dedupePalette(colors);
  switch (format) {
    case 'gpl': {
      const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
      clean.forEach((hex, i) => {
        const c = parseHex(hex);
        lines.push(`${String(c.r).padStart(3, ' ')} ${String(c.g).padStart(3, ' ')} ${String(c.b).padStart(3, ' ')}\tColor ${i + 1}`);
      });
      return `${lines.join('\n')}\n`;
    }
    case 'jasc': {
      const lines = ['JASC-PAL', '0100', String(clean.length)];
      for (const hex of clean) {
        const c = parseHex(hex);
        lines.push(`${c.r} ${c.g} ${c.b}`);
      }
      return `${lines.join('\n')}\n`;
    }
    case 'paintnet':
      return `${clean.map((c) => c.replace('#', '').toUpperCase()).join('\n')}\n`;
    case 'json':
      return `${JSON.stringify({ name, colors: clean }, null, 2)}\n`;
    case 'hex':
    default:
      return `${clean.join('\n')}\n`;
  }
}

export function parsePalette(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (Array.isArray(obj)) return dedupePalette(obj.filter((v): v is string => typeof v === 'string'));
      if (obj && typeof obj === 'object' && 'colors' in obj) {
        const colors = (obj as { colors: unknown }).colors;
        if (Array.isArray(colors)) return dedupePalette(colors.filter((v): v is string => typeof v === 'string'));
      }
    } catch {
      // Fall through to text parsing.
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const colors: string[] = [];

  if (/^GIMP Palette/i.test(lines[0] ?? '')) {
    for (const line of lines.slice(1)) {
      const m = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (m) colors.push(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
    }
    return dedupePalette(colors);
  }

  if (/^JASC-PAL/i.test(lines[0] ?? '')) {
    for (const line of lines.slice(3)) {
      const m = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (m) colors.push(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
    }
    return dedupePalette(colors);
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith(';') || t.startsWith('#') && !/^#?[0-9a-f]{6,8}$/i.test(t)) continue;
    const hex = t.match(/#?([0-9a-f]{6})(?:[0-9a-f]{2})?/i);
    if (hex) {
      colors.push(`#${hex[1]}`);
      continue;
    }
    const rgb = t.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (rgb) colors.push(rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])));
  }
  return dedupePalette(colors);
}

/* -------------------------------------------------------------------------- */
/* Built-in palettes                                                          */
/* -------------------------------------------------------------------------- */

export const BUILTIN_PALETTES: PaletteDefinition[] = [
  {
    id: 'pico-8',
    name: 'PICO-8',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
    source: 'builtin',
    author: 'Lexaloffle',
    description: 'The 16-colour PICO-8 fantasy console palette.',
  },
  {
    id: 'gameboy-dmg',
    name: 'Game Boy DMG',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    source: 'builtin',
    description: 'Classic four-shade DMG green palette.',
  },
  {
    id: 'sweetie-16',
    name: 'Sweetie 16',
    colors: [
      '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
    ],
    source: 'builtin',
    author: 'GrafxKid',
    description: 'A beloved bright 16-colour palette for game art.',
  },
  {
    id: 'endesga-32',
    name: 'Endesga 32',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
    source: 'builtin',
    author: 'Endesga',
    description: 'A widely used 32-colour palette with rich ramps.',
  },
  {
    id: 'dawnbringer-16',
    name: 'DawnBringer 16',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
      '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
    source: 'builtin',
    author: 'DawnBringer',
    description: 'The classic DB16 palette.',
  },
  {
    id: 'cga-16',
    name: 'CGA 16',
    colors: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
    source: 'builtin',
    description: 'IBM CGA 16-colour hardware palette.',
  },
  {
    id: 'grayscale-16',
    name: 'Grayscale 16',
    colors: Array.from({ length: 16 }, (_, i) => {
      const v = Math.round((i / 15) * 255);
      return rgbToHex(v, v, v);
    }),
    source: 'builtin',
    description: 'A neutral 16-step grayscale ramp.',
  },
  {
    id: 'one-bit',
    name: '1-bit Ink',
    colors: ['#0b0c10', '#f5f0e6'],
    source: 'builtin',
    description: 'Two-colour ink-on-paper palette for 1-bit art.',
  },
];

export function builtinPalette(id: string): PaletteDefinition | undefined {
  return BUILTIN_PALETTES.find((p) => p.id === id);
}
