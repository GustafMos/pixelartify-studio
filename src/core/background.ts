/**
 * Generated backgrounds for the "Background" node.
 *
 * Pure TypeScript so the same result is produced in the browser, in workers and
 * in the CLI. Patterns are sampled in source pixels, which keeps them crisp
 * before the Pixelate node and stable across resolutions when a background is
 * generated behind an input image.
 */

import type { PixelImage } from './types';
import { createImage } from './image';
import { mixRgb, parseHex } from './color';

export type BackgroundMode =
  | 'solid'
  | 'linear'
  | 'radial'
  | 'checker'
  | 'stripes'
  | 'grid'
  | 'dots'
  | 'noise'
  | 'transparent';

export interface BackgroundParams {
  mode: BackgroundMode;
  colorA: string;
  colorB: string;
  /** Linear/stripe direction in degrees. */
  angle: number;
  /** Pattern cell size in source pixels. */
  scale: number;
  /** Grid line width in source pixels. */
  lineWidth: number;
  /** Dot radius as a fraction of the cell size. */
  dotRadius: number;
  /** Radial centre offset, normalized to -1..1. */
  offsetX: number;
  offsetY: number;
  /** Standalone output size; ignored when an input image is connected. */
  width: number;
  height: number;
  /** Grain/noise amount for the noise pattern. */
  noise: number;
}

export const DEFAULT_BACKGROUND: BackgroundParams = {
  mode: 'linear',
  colorA: '#17203a',
  colorB: '#5b4bb7',
  angle: 45,
  scale: 32,
  lineWidth: 2,
  dotRadius: 0.3,
  offsetX: 0,
  offsetY: 0,
  width: 512,
  height: 512,
  noise: 0.5,
};

export const BACKGROUND_MODES: Array<{ value: BackgroundMode; label: string }> = [
  { value: 'solid', label: 'Solid colour' },
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial gradient' },
  { value: 'checker', label: 'Checkerboard' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dots' },
  { value: 'noise', label: 'Noise' },
  { value: 'transparent', label: 'Transparent' },
];

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Render one background frame at the requested source resolution. */
export function renderBackground(
  width: number,
  height: number,
  params: Partial<BackgroundParams> = {},
): PixelImage {
  const p: BackgroundParams = { ...DEFAULT_BACKGROUND, ...params };
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createImage(w, h);
  if (p.mode === 'transparent') return out;

  const a = parseHex(p.colorA || '#000000');
  const b = parseHex(p.colorB || p.colorA || '#000000');
  const angle = ((Number.isFinite(p.angle) ? p.angle : 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = Math.max(1, Math.round(p.scale || 1));
  const lineWidth = Math.max(1, Math.round(p.lineWidth || 1));
  const dotRadius = Math.max(0.05, Math.min(1, p.dotRadius || 0.3)) * scale * 0.5;
  const spanX = Math.abs(w * cos) + Math.abs(h * sin);
  const cx = w * (0.5 + Math.max(-1, Math.min(1, p.offsetX || 0)) * 0.5);
  const cy = h * (0.5 + Math.max(-1, Math.min(1, p.offsetY || 0)) * 0.5);
  const shiftX = (p.offsetX || 0) * w;
  const shiftY = (p.offsetY || 0) * h;
  const maxRadius = Math.max(1, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)));
  const noiseAmount = Math.max(0, Math.min(1, p.noise ?? 0.5));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let rgb = { r: a.r, g: a.g, b: a.b };
      const alpha = 255;

      switch (p.mode) {
        case 'solid':
          break;
        case 'linear': {
          const u = (px - shiftX - w / 2) * cos + (py - shiftY - h / 2) * sin;
          const t = clamp01(0.5 + u / Math.max(1, spanX));
          rgb = mixRgb({ r: a.r, g: a.g, b: a.b }, { r: b.r, g: b.g, b: b.b }, t);
          break;
        }
        case 'radial': {
          const t = clamp01(Math.hypot(px - cx, py - cy) / maxRadius);
          rgb = mixRgb({ r: a.r, g: a.g, b: a.b }, { r: b.r, g: b.g, b: b.b }, t);
          break;
        }
        case 'checker': {
          const on =
            (Math.floor((x - shiftX) / scale) + Math.floor((y - shiftY) / scale)) % 2 === 0;
          if (!on) rgb = { r: b.r, g: b.g, b: b.b };
          break;
        }
        case 'stripes': {
          const u = ((x - shiftX) * cos + (y - shiftY) * sin) / scale;
          const on = ((Math.floor(u) % 2) + 2) % 2 === 0;
          if (!on) rgb = { r: b.r, g: b.g, b: b.b };
          break;
        }
        case 'grid': {
          const u = ((x - shiftX) * cos + (y - shiftY) * sin) / scale;
          const v = (-(x - shiftX) * sin + (y - shiftY) * cos) / scale;
          const du = Math.abs(u - Math.round(u)) * scale;
          const dv = Math.abs(v - Math.round(v)) * scale;
          if (du <= lineWidth / 2 || dv <= lineWidth / 2) {
            rgb = { r: b.r, g: b.g, b: b.b };
          }
          break;
        }
        case 'dots': {
          const localX = px - shiftX;
          const localY = py - shiftY;
          const cellX = Math.floor(localX / scale);
          const cellY = Math.floor(localY / scale);
          const ox = (cellX + 0.5) * scale;
          const oy = (cellY + 0.5) * scale;
          const dist = Math.hypot(localX - ox, localY - oy);
          const feather = Math.max(0.5, scale * 0.06);
          if (dist <= dotRadius - feather) {
            rgb = { r: b.r, g: b.g, b: b.b };
          } else if (dist < dotRadius + feather) {
            const t = clamp01((dist - (dotRadius - feather)) / (feather * 2));
            rgb = mixRgb({ r: b.r, g: b.g, b: b.b }, { r: a.r, g: a.g, b: a.b }, t);
          }
          break;
        }
        case 'noise': {
          const cell = Math.max(1, Math.round(scale / 4));
          const gx = Math.floor((x - shiftX) / cell);
          const gy = Math.floor((y - shiftY) / cell);
          const n = hash2(gx, gy, 0x9e3779b9);
          const t = clamp01(n * noiseAmount + (1 - noiseAmount) * 0.5);
          rgb = mixRgb({ r: a.r, g: a.g, b: a.b }, { r: b.r, g: b.g, b: b.b }, t);
          break;
        }
        default:
          break;
      }

      const i = (y * w + x) * 4;
      out.data[i] = rgb.r;
      out.data[i + 1] = rgb.g;
      out.data[i + 2] = rgb.b;
      out.data[i + 3] = alpha;
    }
  }

  return out;
}
