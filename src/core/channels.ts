/**
 * Channel routing.
 *
 * "Colour → channels" mode for turning colour data into per-channel maps
 * (useful for displacement, masks, normal maps or stylised channel art),
 * plus channel extraction, swapping and packing while optionally retaining the
 * original alpha channel.
 */

import type { PixelImage } from './types';
import { clamp01, rgbToHsl, hslToRgb } from './color';
import { createImage } from './image';

export type ChannelSource = 'r' | 'g' | 'b' | 'a' | 'luma' | 'zero' | 'one';
export type ChannelOperation =
  | 'extract'
  | 'swap'
  | 'pack'
  | 'luma-to-alpha'
  | 'alpha-to-luma'
  | 'hsl-map';
export type ChannelSwap = 'rgb' | 'bgr' | 'gbr' | 'brg' | 'grb' | 'rbg';

export interface ChannelSettings {
  operation: ChannelOperation;
  channel: ChannelSource;
  swap: ChannelSwap;
  pack: { r: ChannelSource; g: ChannelSource; b: ChannelSource; a: ChannelSource };
  /** Preserve the source alpha channel (or multiply it for alpha-producing ops). */
  keepAlpha: boolean;
  invert: boolean;
}

export const DEFAULT_CHANNELS: ChannelSettings = {
  operation: 'extract',
  channel: 'luma',
  swap: 'bgr',
  pack: { r: 'r', g: 'g', b: 'b', a: 'a' },
  keepAlpha: true,
  invert: false,
};

const LUT = (() => {
  const l = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return l;
})();

function luma(r: number, g: number, b: number): number {
  return 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];
}

function readChannel(
  channel: ChannelSource,
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  switch (channel) {
    case 'r':
      return r;
    case 'g':
      return g;
    case 'b':
      return b;
    case 'a':
      return a;
    case 'luma':
      return Math.round(Math.sqrt(clamp01(luma(r, g, b))) * 255);
    case 'zero':
      return 0;
    case 'one':
      return 255;
    default:
      return 0;
  }
}

export function applyChannels(img: PixelImage, settings: ChannelSettings): PixelImage {
  const out = createImage(img.width, img.height);
  const src = img.data;
  const dst = out.data;
  const invert = settings.invert;
  const swap = settings.swap;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const a = src[i + 3];

    switch (settings.operation) {
      case 'extract': {
        let v = readChannel(settings.channel, r, g, b, a);
        if (invert) v = 255 - v;
        dst[i] = v;
        dst[i + 1] = v;
        dst[i + 2] = v;
        dst[i + 3] = settings.keepAlpha ? a : 255;
        break;
      }
      case 'swap': {
        const map: Record<ChannelSwap, [number, number, number]> = {
          rgb: [r, g, b],
          bgr: [b, g, r],
          gbr: [g, b, r],
          brg: [b, r, g],
          grb: [g, r, b],
          rbg: [r, b, g],
        };
        let [nr, ng, nb] = map[swap];
        if (invert) {
          nr = 255 - nr;
          ng = 255 - ng;
          nb = 255 - nb;
        }
        dst[i] = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
        dst[i + 3] = settings.keepAlpha ? a : 255;
        break;
      }
      case 'pack': {
        let nr = readChannel(settings.pack.r, r, g, b, a);
        let ng = readChannel(settings.pack.g, r, g, b, a);
        let nb = readChannel(settings.pack.b, r, g, b, a);
        let na = readChannel(settings.pack.a, r, g, b, a);
        if (invert) {
          nr = 255 - nr;
          ng = 255 - ng;
          nb = 255 - nb;
          na = 255 - na;
        }
        dst[i] = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
        dst[i + 3] = settings.keepAlpha ? a : na;
        break;
      }
      case 'luma-to-alpha': {
        let v = readChannel('luma', r, g, b, a);
        if (invert) v = 255 - v;
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = settings.keepAlpha ? Math.round((a * v) / 255) : v;
        break;
      }
      case 'alpha-to-luma': {
        let v = a;
        if (invert) v = 255 - v;
        dst[i] = v;
        dst[i + 1] = v;
        dst[i + 2] = v;
        dst[i + 3] = settings.keepAlpha ? a : 255;
        break;
      }
      case 'hsl-map': {
        const hsl = rgbToHsl(r, g, b);
        let hr = Math.round((hsl.h / 360) * 255);
        let hg = Math.round(hsl.s * 255);
        let hb = Math.round(hsl.l * 255);
        if (invert) {
          hr = 255 - hr;
          hg = 255 - hg;
          hb = 255 - hb;
        }
        dst[i] = hr;
        dst[i + 1] = hg;
        dst[i + 2] = hb;
        dst[i + 3] = settings.keepAlpha ? a : 255;
        break;
      }
      default: {
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = a;
      }
    }
  }
  return out;
}

/** Inverse of HSL channel encoding, useful as a utility in graphs/tests. */
export function channelsToHslImage(img: PixelImage): PixelImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const h = (img.data[i] / 255) * 360;
    const s = img.data[i + 1] / 255;
    const l = img.data[i + 2] / 255;
    const rgb = hslToRgb(h, s, l);
    out.data[i] = rgb.r;
    out.data[i + 1] = rgb.g;
    out.data[i + 2] = rgb.b;
    out.data[i + 3] = img.data[i + 3];
  }
  return out;
}
