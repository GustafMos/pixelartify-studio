/**
 * Resolution policy.
 *
 * The art size is derived from the *target* art pixels, never from the source
 * resolution. A 480p and a 1080p source with the same preset therefore produce
 * the same art dimensions and visual scale.
 */

import type { ArtSize, ResolutionSettings } from './types';
import { clamp } from './color';

export const DEFAULT_RESOLUTION: ResolutionSettings = {
  mode: 'fixed-height',
  value: 270,
  exportScale: 4,
  snapEven: false,
  minSide: 16,
  maxSide: 2048,
};

export function computeArtSize(
  sourceWidth: number,
  sourceHeight: number,
  resolution: ResolutionSettings,
): ArtSize {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);

  if (resolution.mode === 'native') {
    const pixelScale = clamp(Math.round(resolution.exportScale || 1), 1, 16);
    return {
      width: sw,
      height: sh,
      exportWidth: sw * pixelScale,
      exportHeight: sh * pixelScale,
      pixelScale,
    };
  }

  let artW = sw;
  let artH = sh;

  const value = Math.max(1, resolution.value);
  switch (resolution.mode) {
    case 'fixed-height': {
      artH = value;
      artW = Math.round((sw / sh) * artH);
      break;
    }
    case 'fixed-width': {
      artW = value;
      artH = Math.round((sh / sw) * artW);
      break;
    }
    case 'short-side': {
      const scale = value / Math.min(sw, sh);
      artW = Math.round(sw * scale);
      artH = Math.round(sh * scale);
      break;
    }
    case 'block-size': {
      const block = Math.max(1, value);
      artW = Math.round(sw / block);
      artH = Math.round(sh / block);
      break;
    }
    default:
      break;
  }

  // Respect the configured bounds while preserving aspect ratio.
  const minSide = Math.max(2, resolution.minSide);
  const maxSide = Math.max(minSide, resolution.maxSide);
  const short = Math.min(artW, artH);
  if (short < minSide) {
    const k = minSide / Math.max(1, short);
    artW = Math.round(artW * k);
    artH = Math.round(artH * k);
  }
  const long = Math.max(artW, artH);
  if (long > maxSide) {
    const k = maxSide / long;
    artW = Math.round(artW * k);
    artH = Math.round(artH * k);
  }

  artW = clamp(artW, 2, 4096);
  artH = clamp(artH, 2, 4096);

  if (resolution.snapEven) {
    artW = Math.max(2, Math.round(artW / 2) * 2);
    artH = Math.max(2, Math.round(artH / 2) * 2);
  }

  const exportScale = clamp(Math.round(resolution.exportScale || 1), 1, 16);
  return {
    width: artW,
    height: artH,
    exportWidth: artW * exportScale,
    exportHeight: artH * exportScale,
    pixelScale: exportScale,
  };
}

/**
 * Canonical supersampled working resolution for a given art size. Deriving this
 * from the art size (not the source) is what keeps batch output consistent.
 */
export function computeWorkingSize(
  artWidth: number,
  artHeight: number,
  maxLong = 2048,
): { width: number; height: number; supersample: number } {
  const long = Math.max(artWidth, artHeight);
  let factor = 4;
  if (long <= 192) factor = 6;
  else if (long <= 384) factor = 5;
  else if (long <= 768) factor = 3;
  else factor = 2;

  let workW = artWidth * factor;
  let workH = artHeight * factor;
  const workLong = Math.max(workW, workH);
  if (workLong > maxLong) {
    const k = maxLong / workLong;
    workW = Math.round(workW * k);
    workH = Math.round(workH * k);
    factor = workW / Math.max(1, artWidth);
  }
  return {
    width: Math.max(2, workW),
    height: Math.max(2, workH),
    supersample: factor,
  };
}

export function describeResolution(size: ArtSize): string {
  return `${size.width}×${size.height} art px · export ${size.exportWidth}×${size.exportHeight} (${size.pixelScale}×)`;
}

export const RESOLUTION_MODES: Array<{ value: ResolutionSettings['mode']; label: string; hint: string }> = [
  {
    value: 'fixed-height',
    label: 'Fixed height',
    hint: 'Best for consistent scale across mixed-aspect sources. 480p and 1080p inputs match.',
  },
  {
    value: 'fixed-width',
    label: 'Fixed width',
    hint: 'Use when width is the layout constraint (side-scrollers, banners).',
  },
  {
    value: 'short-side',
    label: 'Short side',
    hint: 'Fits landscape and portrait art into the same short-edge budget.',
  },
  {
    value: 'block-size',
    label: 'Source block size',
    hint: 'Art size is derived from source dimensions: each block becomes one pixel.',
  },
];
