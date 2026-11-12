import type {
  DitherSettings,
  ExtractionSettings,
  InpaintSettings,
  LayerRole,
  LayerSettings,
  OutputSettings,
  PaletteSettings,
  PixelArtifySettings,
  PixelateSettings,
  PostprocessSettings,
  PreprocessSettings,
  ResolutionSettings,
  VideoSettings,
} from './types';
import { createPreprocessOp } from './preprocess';
import { DEFAULT_RESOLUTION } from './resolution';

export const DEFAULT_PIXELATE: PixelateSettings = {
  edgeAware: true,
  alignment: 0.68,
  colorBlend: 0.7,
  edgeThreshold: 0.52,
  gridPasses: 2,
  preBlur: 0.35,
  postSharpen: 0.18,
  contrast: 1.04,
  brightness: 0,
  saturation: 1.06,
  gamma: 1,
  hueShift: 0,
  alphaThreshold: 0.02,
};

export const DEFAULT_PALETTE: PaletteSettings = {
  mode: 'none',
  colors: [],
  autoCount: 24,
  quantizer: 'kmeans',
  colorSpace: 'oklab',
  strength: 1,
};

export const DEFAULT_DITHER: DitherSettings = {
  algorithm: 'floyd-steinberg',
  strength: 1,
  scale: 1,
  serpentine: true,
  colorSpace: 'oklab',
  seed: 0,
  threshold: 0,
};

export const DEFAULT_EXTRACTION: ExtractionSettings = {
  enabled: false,
  method: 'saliency',
  threshold: 0.62,
  softness: 0.28,
  centerBias: 0.2,
  keyColor: '#00ff00',
  tolerance: 0.22,
  lumaMin: 0,
  lumaMax: 1,
  invert: false,
  feather: 0.8,
  boxX: 0.32,
  boxY: 0.18,
  boxWidth: 0.36,
  boxHeight: 0.74,
  boxShape: 'ellipse',
};

export const DEFAULT_INPAINT: InpaintSettings = {
  method: 'directional',
  texture: 0.3,
  iterations: 12,
  radius: 1.2,
};

export const DEFAULT_OUTPUT: OutputSettings = {
  format: 'png',
  quality: 0.92,
  filenamePattern: '{name}-{width}x{height}',
  transparent: true,
  exportLayers: false,
  writeManifest: true,
};

export const DEFAULT_VIDEO: VideoSettings = {
  fps: 24,
  start: 0,
  end: null,
  output: 'both',
  codec: 'avc',
  bitrateMbps: 10,
  spritesheet: {
    columns: 0,
    padding: 0,
    maxSize: 4096,
    powerOfTwo: false,
  },
};

export const DEFAULT_PREPROCESS: PreprocessSettings = { ops: [] };
export const DEFAULT_POSTPROCESS: PostprocessSettings = { ops: [], lockPalette: false };

export function defaultSettings(overrides: Partial<PixelArtifySettings> = {}): PixelArtifySettings {
  const base: PixelArtifySettings = {
    resolution: { ...DEFAULT_RESOLUTION },
    preprocess: { ops: [] },
    postprocess: { ops: [], lockPalette: false },
    pixelate: { ...DEFAULT_PIXELATE },
    extraction: { ...DEFAULT_EXTRACTION },
    layers: [],
    palette: { ...DEFAULT_PALETTE, colors: [] },
    dither: { ...DEFAULT_DITHER },
    output: { ...DEFAULT_OUTPUT },
    video: { ...DEFAULT_VIDEO, spritesheet: { ...DEFAULT_VIDEO.spritesheet } },
  };
  return mergeSettings(base, overrides);
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deep merge with arrays replaced (not concatenated). */
export function mergeSettings(
  base: PixelArtifySettings,
  patch: Partial<PixelArtifySettings>,
): PixelArtifySettings {
  return mergeObject(deepClone(base), patch) as PixelArtifySettings;
}

function mergeObject(base: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(patch)) return deepClone(patch);
  if (typeof patch !== 'object') return patch;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return deepClone(patch);
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    out[key] = mergeObject(out[key], value);
  }
  return out;
}

export function layerDefaults(role: LayerRole): LayerSettings {
  const id = `${role}-${Math.random().toString(36).slice(2, 7)}`;
  switch (role) {
    case 'background':
      return {
        id,
        name: 'Background',
        role,
        visible: true,
        opacity: 1,
        z: 0,
        blend: 'normal',
        maskId: null,
        occlusionMaskId: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        inpaintOcclusion: true,
        inpaint: { ...DEFAULT_INPAINT },
        detailStrength: 0.5,
      };
    case 'foreground':
      return {
        id,
        name: 'Subject',
        role,
        visible: true,
        opacity: 1,
        z: 10,
        blend: 'normal',
        maskId: 'subject',
        occlusionMaskId: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        inpaintOcclusion: false,
        inpaint: { ...DEFAULT_INPAINT },
        detailStrength: 0.5,
      };
    case 'detail':
      return {
        id,
        name: 'Edge detail',
        role,
        visible: true,
        opacity: 0.55,
        z: 20,
        blend: 'overlay',
        maskId: 'detail',
        occlusionMaskId: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        inpaintOcclusion: false,
        inpaint: { ...DEFAULT_INPAINT },
        detailStrength: 0.55,
      };
    case 'overlay':
    default:
      return {
        id,
        name: 'Overlay',
        role: 'overlay',
        visible: true,
        opacity: 0.5,
        z: 30,
        blend: 'normal',
        maskId: null,
        occlusionMaskId: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        inpaintOcclusion: false,
        inpaint: { ...DEFAULT_INPAINT },
        detailStrength: 0.5,
      };
  }
}

export function threeLayerStack(): LayerSettings[] {
  return [layerDefaults('background'), layerDefaults('foreground'), layerDefaults('detail')];
}

export function defaultPreprocessOps(types: Parameters<typeof createPreprocessOp>[0][]): PreprocessSettings {
  return { ops: types.map((t) => createPreprocessOp(t)) };
}

/** Validate and repair a settings object loaded from disk. */
export function normalizeSettings(input: unknown): PixelArtifySettings {
  const base = defaultSettings();
  if (!input || typeof input !== 'object') return base;
  return mergeSettings(base, input as Partial<PixelArtifySettings>);
}

/** Validate and repair a resolution object. */
export function normalizeResolution(input: unknown): ResolutionSettings {
  const base = { ...DEFAULT_RESOLUTION };
  if (!input || typeof input !== 'object') return base;
  return { ...base, ...(input as Partial<ResolutionSettings>) };
}

/** A palette-independent snapshot used by tests. */
export function settingsFingerprint(settings: PixelArtifySettings): string {
  const copy = deepClone(settings);
  copy.output.filenamePattern = '';
  return JSON.stringify(copy);
}
