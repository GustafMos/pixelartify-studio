import type { GraphMediaItem } from '../core/graph';
import type { PixelArtifySettings } from '../core/types';
import { computeArtSize } from '../core/resolution';
import { gpuDitherAvailable, supportsGpuDither } from './gpuFinish';

/**
 * Settings used for fast video playback. Capture/export still use the full
 * settings; pausing restores full quality.
 */
export function playbackSettings(
  settings: PixelArtifySettings,
  item: GraphMediaItem,
): PixelArtifySettings {
  if (settings.pixelate.enabled === false) return settings;
  const art = computeArtSize(item.sourceWidth, item.sourceHeight, settings.resolution);
  const short = Math.min(art.width, art.height);
  const area = art.width * art.height;
  const cpuDither =
    settings.dither.algorithm !== 'none' &&
    !(gpuDitherAvailable() && supportsGpuDither(settings.dither.algorithm));
  const budget = cpuDither ? 14_000 : 32_000;
  if (area > budget) {
    const scale = Math.sqrt(budget / area);
    return {
      ...settings,
      resolution: {
        ...settings.resolution,
        mode: 'short-side',
        value: Math.max(2, Math.round(short * scale)),
      },
    };
  }
  if (short > 320) {
    return {
      ...settings,
      resolution: { ...settings.resolution, mode: 'short-side', value: 320 },
    };
  }
  return settings;
}

/** Stable cache key for the palette resolved during playback. */
export function playbackPaletteKey(settings: PixelArtifySettings, assetId: string): string {
  return [
    assetId,
    settings.palette.mode,
    settings.palette.autoCount,
    settings.palette.quantizer,
    settings.dither.algorithm,
    settings.palette.colors.join(','),
  ].join('|');
}
