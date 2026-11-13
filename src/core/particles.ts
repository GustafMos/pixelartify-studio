/**
 * Deterministic particle field for the "Particles" node.
 *
 * Particles are derived from a seeded hash so the field is stable between
 * frames while `time` drives their motion. Presets cover dust, rain and
 * shimmer; a custom preset lets you pick the shape, count, size and speed.
 */

import type { PixelImage } from './types';
import { createImage } from './image';
import { mixRgb, parseHex } from './color';

export type ParticlePreset = 'dust' | 'rain' | 'shimmer' | 'custom';
export type ParticleShape = 'circle' | 'star' | 'line' | 'square';

export interface ParticleParams {
  preset: ParticlePreset;
  count: number;
  shape: ParticleShape;
  size: number;
  speed: number;
  direction: number;
  spread: number;
  colorA: string;
  colorB: string;
  seed: number;
  opacity: number;
  /** Standalone output size; ignored when composited over an input. */
  width: number;
  height: number;
}

export const DEFAULT_PARTICLES: ParticleParams = {
  preset: 'dust',
  count: 60,
  shape: 'circle',
  size: 2.5,
  speed: 8,
  direction: 90,
  spread: 30,
  colorA: '#ffffff',
  colorB: '#4cc9f0',
  seed: 1,
  opacity: 0.7,
  width: 512,
  height: 512,
};

export const PARTICLE_PRESETS: Array<{ value: ParticlePreset; label: string }> = [
  { value: 'dust', label: 'Dust' },
  { value: 'rain', label: 'Rain' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'custom', label: 'Custom' },
];

export const PARTICLE_SHAPES: Array<{ value: ParticleShape; label: string }> = [
  { value: 'circle', label: 'Circle' },
  { value: 'star', label: 'Star' },
  { value: 'line', label: 'Line' },
  { value: 'square', label: 'Square' },
];

function hash(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h, 1103515245);
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

function rand2(seed: number, index: number): [number, number] {
  return [hash(seed * 7919 + index * 104729), hash(seed * 15485863 + index * 224737)];
}

function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

function drawDot(img: PixelImage, x: number, y: number, r: number, color: { r: number; g: number; b: number }, alpha: number): void {
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(img.width - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(img.height - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
      const cov = Math.max(0, Math.min(1, r - d));
      if (cov <= 0) continue;
      const a = cov * alpha;
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i] + (color.r - img.data[i]) * a;
      img.data[i + 1] = img.data[i + 1] + (color.g - img.data[i + 1]) * a;
      img.data[i + 2] = img.data[i + 2] + (color.b - img.data[i + 2]) * a;
      img.data[i + 3] = Math.min(255, img.data[i + 3] + a * 255);
    }
  }
}

function drawLine(img: PixelImage, x0: number, y0: number, x1: number, y1: number, w: number, color: { r: number; g: number; b: number }, alpha: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    drawDot(img, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, color, alpha);
  }
}

function drawSquare(img: PixelImage, x: number, y: number, r: number, color: { r: number; g: number; b: number }, alpha: number): void {
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(img.width - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(img.height - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i] + (color.r - img.data[i]) * alpha;
      img.data[i + 1] = img.data[i + 1] + (color.g - img.data[i + 1]) * alpha;
      img.data[i + 2] = img.data[i + 2] + (color.b - img.data[i + 2]) * alpha;
      img.data[i + 3] = Math.min(255, img.data[i + 3] + alpha * 255);
    }
  }
}

function drawStar(img: PixelImage, x: number, y: number, r: number, color: { r: number; g: number; b: number }, alpha: number): void {
  const points = 4;
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    drawDot(img, px, py, r * 0.28, color, alpha);
  }
}

/** Stamp a media instance (a sprite) at a particle position, nearest-sampled. */
function drawInstance(img: PixelImage, instance: PixelImage, x: number, y: number, size: number, alpha: number): void {
  const iw = instance.width;
  const ih = instance.height;
  const scale = Math.max(0.25, (size * 2) / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const x0 = Math.floor(x - w / 2);
  const y0 = Math.floor(y - h / 2);
  for (let yy = 0; yy < h; yy++) {
    const py = y0 + yy;
    if (py < 0 || py >= img.height) continue;
    for (let xx = 0; xx < w; xx++) {
      const px = x0 + xx;
      if (px < 0 || px >= img.width) continue;
      const sx = Math.min(iw - 1, Math.floor((xx / w) * iw));
      const sy = Math.min(ih - 1, Math.floor((yy / h) * ih));
      const si = (sy * iw + sx) * 4;
      const sa = (instance.data[si + 3] / 255) * alpha;
      if (sa <= 0) continue;
      const di = (py * img.width + px) * 4;
      img.data[di] = img.data[di] + (instance.data[si] - img.data[di]) * sa;
      img.data[di + 1] = img.data[di + 1] + (instance.data[si + 1] - img.data[di + 1]) * sa;
      img.data[di + 2] = img.data[di + 2] + (instance.data[si + 2] - img.data[di + 2]) * sa;
      img.data[di + 3] = Math.min(255, img.data[di + 3] + sa * 255);
    }
  }
}

export function renderParticles(
  width: number,
  height: number,
  params: Partial<ParticleParams> = {},
  time = 0,
  instance?: PixelImage,
): PixelImage {
  const p: ParticleParams = { ...DEFAULT_PARTICLES, ...params };
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createImage(w, h);
  const count = Math.max(1, Math.round(p.count || 1));
  const size = Math.max(0.5, p.size || 1);
  const speed = p.speed || 1;
  const dirRad = ((p.direction ?? 90) * Math.PI) / 180;
  const spreadRad = ((p.spread ?? 0) * Math.PI) / 180;
  const a = parseHex(p.colorA || '#ffffff');
  const b = parseHex(p.colorB || p.colorA || '#ffffff');
  const aRgb = { r: a.r, g: a.g, b: a.b };
  const bRgb = { r: b.r, g: b.g, b: b.b };
  const opacity = Math.max(0, Math.min(1, p.opacity ?? 1));
  const preset = p.preset || 'dust';
  const t = time ?? 0;

  for (let i = 0; i < count; i++) {
    const [r0, r1] = rand2(p.seed || 1, i);
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let color: { r: number; g: number; b: number } = aRgb;
    let alpha = opacity;
    let draw: 'dot' | 'line' | 'square' | 'star' = p.shape === 'line' ? 'line' : p.shape === 'square' ? 'square' : p.shape === 'star' ? 'star' : 'dot';

    switch (preset) {
      case 'rain': {
        const angle = dirRad + (r0 - 0.5) * 2 * spreadRad;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
        x = wrap(r0 * w + vx * t, w);
        y = wrap(r1 * h + vy * t, h);
        const fall = Math.min(1, speed / 40);
        draw = 'line';
        color = mixRgb(aRgb, bRgb, r1);
        alpha = opacity * (0.6 + 0.4 * r0) * (0.5 + fall);
        break;
      }
      case 'shimmer': {
        x = wrap(r0 * w + Math.sin(t * 0.4 + i) * 2, w);
        y = wrap(r1 * h + Math.cos(t * 0.3 + i) * 2, h);
        const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        draw = 'star';
        alpha = opacity * twinkle;
        color = mixRgb(aRgb, bRgb, twinkle);
        break;
      }
      case 'custom': {
        const angle = dirRad + (r0 - 0.5) * 2 * spreadRad;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
        x = wrap(r0 * w + vx * t, w);
        y = wrap(r1 * h + vy * t, h);
        color = mixRgb(aRgb, bRgb, r1);
        break;
      }
      case 'dust':
      default: {
        x = wrap(r0 * w + Math.sin(t * 0.5 + i * 2.4) * w * 0.02 * speed, w);
        y = wrap(r1 * h - t * speed * 0.6 + Math.cos(t * 0.4 + i) * 3, h);
        color = mixRgb(aRgb, bRgb, r1);
        alpha = opacity * (0.3 + 0.7 * r0);
        break;
      }
    }

    if (instance && instance.width > 0 && instance.height > 0) {
      drawInstance(out, instance, x, y, size, alpha);
    } else if (draw === 'line') {
      const len = size * (preset === 'rain' ? 6 : 3);
      const vlen = Math.hypot(vx, vy) || 1;
      const dx = (vx / vlen) * len;
      const dy = (vy / vlen) * len;
      drawLine(out, x - dx, y - dy, x + dx, y + dy, size, color, alpha);
    } else if (draw === 'square') {
      drawSquare(out, x, y, size, color, alpha);
    } else if (draw === 'star') {
      drawStar(out, x, y, size * 2, color, alpha);
    } else {
      drawDot(out, x, y, size, color, alpha);
    }
  }
  return out;
}
