/**
 * The render pipeline.
 *
 *  source → canonical working res → preprocess → tone → layers/inpaint →
 *  edge-aware pixelate → palette → dither → postprocess → export upscale
 *
 * The canonical working resolution is derived from the target art size, not
 * from the source. That is the core of resolution-independent batch output.
 */

import type {
  DitherSettings,
  LayerSettings,
  MaskData,
  PaletteSettings,
  PixelArtifySettings,
  PixelImage,
  RenderLayer,
  RenderResult,
} from './types';
import {
  applyTone,
  blendPixel,
  cloneImage,
  compositeLayers,
  createImage,
  gaussianBlurRGBA,
  multiplyAlpha,
  resizeImage,
  resizeMask,
  unionMasks,
  thresholdMask,
  dilateMask,
  featherMask,
  upscaleNearest,
  type CompositeLayer,
} from './image';
import { clamp01, lerp } from './color';
import { computeArtSize, computeWorkingSize } from './resolution';
import { applyPreprocess, applyPostprocess, blendImages, type EffectContext } from './preprocess';
import { pixelateImage, type PixelateSourceOptions } from './pixelate';
import { unsharpMask } from './image';
import { inpaintImage } from './inpaint';
import { applyDither } from './dither';
import { createPaletteMatcher, extractPalette, snapToPalette } from './palette';

export type RenderStop = 'source' | 'preprocess' | 'pixelate' | 'dither' | 'post';

/** Optional accelerated pixelator (WebGL2/WebGPU). Returns null on fallback. */
export type Pixelator = (src: PixelImage, options: PixelateSourceOptions) => PixelImage | null;

let globalPixelator: Pixelator | null = null;

export function setGlobalPixelator(pixelator: Pixelator | null): void {
  globalPixelator = pixelator;
}

/** Optional accelerated layer compositor (WebGL2). Returns null on fallback. */
export type LayerCompositor = (
  width: number,
  height: number,
  layers: CompositeLayer[],
) => PixelImage | null;

let globalLayerCompositor: LayerCompositor | null = null;

export function setGlobalLayerCompositor(compositor: LayerCompositor | null): void {
  globalLayerCompositor = compositor;
}

function runPixelator(
  src: PixelImage,
  options: PixelateSourceOptions,
  override?: Pixelator,
): { image: PixelImage; usedEdgeMap: boolean } {
  const accelerated = (override ?? globalPixelator)?.(src, options);
  if (accelerated) {
    // The CPU sampler applies the unsharp finish inside pixelateImage(); the
    // GPU pass stops at the raw art pixels, so finish it here.
    const image =
      options.settings.postSharpen > 0.001
        ? unsharpMask(accelerated, 0.75, options.settings.postSharpen)
        : accelerated;
    return {
      image,
      usedEdgeMap: options.settings.edgeAware && options.settings.alignment > 0.001,
    };
  }
  return pixelateImage(src, options);
}

/** Optional accelerated dither (WebGL2). Returns null when unsupported. */
export type DitherFinisher = (
  image: PixelImage,
  palette: string[],
  settings: DitherSettings,
  seed: number,
) => PixelImage | null;

let globalDitherFinisher: DitherFinisher | null = null;

export function setGlobalDitherFinisher(finisher: DitherFinisher | null): void {
  globalDitherFinisher = finisher;
}

function runDither(
  image: PixelImage,
  palette: string[],
  settings: DitherSettings,
  seed: number,
): PixelImage {
  const accelerated = globalDitherFinisher?.(image, palette, settings, seed);
  if (accelerated) return accelerated;
  return applyDither(image, palette, settings, { seed });
}

export interface RenderOptions {
  /** Called between expensive stages for progress reporting. */
  onStage?: (stage: string, progress: number) => void;
  /** Deterministic seed override. */
  seed?: number;
  /** Stop before final effects (used for node previews). */
  stopAfter?: RenderStop;
  /** Apply exportScale. Defaults to true; previews usually pass false. */
  upscale?: boolean;
  /** Cap the canonical working resolution (fast previews). */
  maxWorkingSide?: number;
  /** Override the pixelation backend for this render. */
  pixelator?: Pixelator;
  /** Reuse a previously resolved palette (used for smooth video playback). */
  paletteOverride?: string[];
}

export function renderPixelArt(
  input: { image: PixelImage; masks?: Record<string, MaskData>; settings: PixelArtifySettings },
  options: RenderOptions = {},
): RenderResult {
  const start = now();
  const { image, masks = {}, settings } = input;
  const stage = (name: string, p: number): void => options.onStage?.(name, p);

  const pixelationEnabled = settings.pixelate.enabled !== false;
  const size = computeArtSize(image.width, image.height, settings.resolution);
  const working = pixelationEnabled
    ? computeWorkingSize(size.width, size.height, options.maxWorkingSide ?? 2048)
    : { width: image.width, height: image.height, supersample: 1 };
  const ctx: EffectContext = { artWidth: size.width, artHeight: size.height, seed: options.seed ?? 0 };

  const finalize = (
    img: PixelImage,
    palette: string[],
    layers: RenderLayer[],
    edgeAware: boolean,
  ): RenderResult => {
    const applyUpscale = options.upscale !== false && size.pixelScale > 1;
    const artAtPixelScale = img;
    const finalArt = applyUpscale ? upscaleNearest(img, size.pixelScale) : img;
    const durationMs = now() - start;
    stage('Done', 1);
    return {
      art: finalArt,
      artAtPixelScale,
      layers,
      palette,
      size,
      stats: {
        durationMs,
        edgeAware,
        sourceWidth: image.width,
        sourceHeight: image.height,
        workingWidth: working.width,
        workingHeight: working.height,
        paletteSource:
          settings.palette.mode === 'custom'
            ? 'custom'
            : settings.palette.mode === 'auto' || palette.length > 0
              ? 'auto'
              : 'none',
        layerCount: layers.length,
      },
    };
  };

  stage('Resampling', 0.05);
  // With no Pixelate node, keep the source at its native resolution. Crop,
  // resize and channel nodes have already changed the item source explicitly.
  let src = pixelationEnabled ? resizeImage(image, working.width, working.height, 'box') : image;

  if (options.stopAfter === 'source') {
    return finalize(src, [], [], false);
  }

  stage('Preprocessing', 0.15);
  if (settings.preprocess.ops.length > 0) {
    src = applyPreprocess(src, settings.preprocess.ops, ctx);
  }

  if (pixelationEnabled) {
    // Tone adjustments are part of the Pixelate node; never apply them to a
    // bare pass-through graph.
    applyTone(src, {
      brightness: settings.pixelate.brightness,
      contrast: settings.pixelate.contrast,
      saturation: settings.pixelate.saturation,
      gamma: settings.pixelate.gamma,
      hueShift: settings.pixelate.hueShift,
    });

    if (settings.pixelate.preBlur > 0.01) {
      const scale = working.width / size.width;
      src = gaussianBlurRGBA(src, settings.pixelate.preBlur * scale);
    }
  }

  if (options.stopAfter === 'preprocess') {
    return finalize(src, [], [], false);
  }

  stage('Pixelating', 0.35);
  const visibleLayers = pixelationEnabled
    ? settings.layers.filter((l) => l.visible).sort((a, b) => a.z - b.z)
    : [];
  let art: PixelImage;
  const renderLayers: RenderLayer[] = [];
  let usedEdgeMap = false;

  if (!pixelationEnabled) {
    art = src;
  } else if (visibleLayers.length === 0) {
    const result = runPixelator(
      src,
      {
        artWidth: size.width,
        artHeight: size.height,
        settings: settings.pixelate,
      },
      options.pixelator,
    );
    art = result.image;
    usedEdgeMap = result.usedEdgeMap;
  } else {
    const layerArt: Array<{ layer: LayerSettings; image: PixelImage }> = [];
    const active = visibleLayers.filter((l) => !l.maskId || masks[l.maskId]);

    for (const layer of active) {
      stage(`Layer: ${layer.name}`, 0.35);
      let source = src;
      const mask = layer.maskId ? masks[layer.maskId] : null;

      if (layer.role === 'detail') {
        source = detailSource(src, layer.detailStrength, size.width);
      }

      if (layer.inpaintOcclusion) {
        // Detail layers are texture overlays, not occluders. Including their
        // edge masks would inpaint the whole image.
        const occluders = active
          .filter(
            (other) =>
              other.z > layer.z &&
              other.role !== 'detail' &&
              (other.occlusionMaskId || other.maskId) &&
              masks[(other.occlusionMaskId || other.maskId) as string],
          )
          .map((other) => masks[(other.occlusionMaskId || other.maskId) as string]);
        if (occluders.length > 0) {
          // The cutout mask is feathered for compositing. Inpainting needs solid
          // coverage plus a margin, otherwise the occluded subject ghosts through.
          let union = unionMasks(occluders, working.width, working.height);
          union = thresholdMask(union, 0.12);
          union = dilateMask(union, Math.max(1, Math.round(working.height * 0.012)));
          union = featherMask(union, Math.max(1, Math.round(working.height * 0.003)));
          source = inpaintImage(source, union, {
            ...layer.inpaint,
            artWidth: size.width,
            artHeight: size.height,
            seed: (options.seed ?? 0) + layer.z * 31,
          });
        }
      }

      if (mask) {
        source = cloneImage(source);
        multiplyAlpha(source, resizeMask(mask, working.width, working.height));
      }

      const result = runPixelator(
        source,
        {
          artWidth: size.width,
          artHeight: size.height,
          settings: settings.pixelate,
        },
        options.pixelator,
      );
      usedEdgeMap = usedEdgeMap || result.usedEdgeMap;
      layerArt.push({ layer, image: result.image });
      renderLayers.push({
        id: layer.id,
        name: layer.name,
        role: layer.role,
        image: result.image,
        z: layer.z,
        opacity: layer.opacity,
        blend: layer.blend,
        visible: layer.visible,
      });
    }

    if (layerArt.length === 0) {
      const result = runPixelator(
        src,
        {
          artWidth: size.width,
          artHeight: size.height,
          settings: settings.pixelate,
        },
        options.pixelator,
      );
      art = result.image;
      usedEdgeMap = result.usedEdgeMap;
    } else {
      const composite: CompositeLayer[] = layerArt.map(({ layer, image: layerImage }) => ({
        image: layerImage,
        opacity: layer.opacity,
        blend: layer.blend,
        offsetX: layer.offsetX,
        offsetY: layer.offsetY,
        scale: layer.scale,
      }));
      art = compositeWithRenderer(size.width, size.height, composite);
    }
  }

  if (options.stopAfter === 'pixelate') {
    return finalize(art, [], renderLayers, usedEdgeMap);
  }

  stage('Palette & dither', 0.65);
  const paletteSettings = settings.palette;
  let palette =
    options.paletteOverride && options.paletteOverride.length > 0
      ? options.paletteOverride
      : resolvePalette(art, paletteSettings, settings.dither.algorithm);

  if (palette.length > 0) {
    const before = cloneImage(art);
    if (settings.dither.algorithm !== 'none') {
      const dithered = runDither(art, palette, settings.dither, options.seed ?? 0);
      art = paletteSettings.strength >= 0.999 ? dithered : blendImages(before, dithered, paletteSettings.strength);
    } else {
      art = before;
      snapToPalette(art, palette, paletteSettings.colorSpace, paletteSettings.strength);
    }
  }

  if (options.stopAfter === 'dither') {
    return finalize(art, palette, renderLayers, usedEdgeMap);
  }

  if (settings.postprocess.ops.length > 0) {
    stage('Postprocessing', 0.8);
    art = applyPostprocess(art, settings.postprocess.ops, {
      artWidth: size.width,
      artHeight: size.height,
      seed: options.seed ?? 0,
    });
    if (settings.postprocess.lockPalette && palette.length > 0) {
      snapToPalette(art, palette, paletteSettings.colorSpace, 1);
    }
  }

  stage('Upscaling', 0.9);
  return finalize(art, palette, renderLayers, usedEdgeMap);
}

export function resolvePaletteColors(
  art: PixelImage,
  settings: PaletteSettings,
  ditherAlgorithm: string,
): string[] {
  return resolvePalette(art, settings, ditherAlgorithm);
}

function resolvePalette(
  art: PixelImage,
  settings: PaletteSettings,
  ditherAlgorithm: string,
): string[] {
  if (settings.mode === 'custom' && settings.colors.length > 0) {
    return settings.colors;
  }
  if (settings.mode === 'auto' || (settings.mode === 'none' && ditherAlgorithm !== 'none')) {
    return extractPalette(art, settings.autoCount, settings.quantizer, {
      maxSamples: 22000,
      alphaThreshold: 24,
    });
  }
  if (settings.mode === 'custom' && settings.colors.length === 0) {
    return extractPalette(art, settings.autoCount, settings.quantizer, { maxSamples: 18000 });
  }
  return [];
}

function detailSource(src: PixelImage, strength: number, artWidth: number): PixelImage {
  const scale = src.width / Math.max(1, artWidth);
  const blurred = gaussianBlurRGBA(src, Math.max(0.5, 1.1 * scale));
  const out = createImage(src.width, src.height);
  const k = clamp01(strength) * 2.2;
  for (let i = 0; i < src.data.length; i += 4) {
    const v = 128 + (src.data[i] - blurred.data[i]) * k;
    out.data[i] = v;
    out.data[i + 1] = 128 + (src.data[i + 1] - blurred.data[i + 1]) * k;
    out.data[i + 2] = 128 + (src.data[i + 2] - blurred.data[i + 2]) * k;
    out.data[i + 3] = src.data[i + 3];
  }
  return out;
}

/**
 * Composite layers with alpha-aware blending. Kept here so the pipeline owns
 * the exact blend semantics used by its previews and layer exports.
 */
function compositeWithRenderer(
  width: number,
  height: number,
  layers: CompositeLayer[],
): PixelImage {
  const accelerated = globalLayerCompositor?.(width, height, layers);
  if (accelerated) return accelerated;
  // compositeLayers implements the same alpha/blend semantics on the CPU.
  return compositeLayers(width, height, layers);
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Convenience helper for applying palette to an arbitrary image. */
export function paletteSnap(
  img: PixelImage,
  colors: string[],
  space: 'oklab' | 'rgb' = 'oklab',
): PixelImage {
  const out = cloneImage(img);
  snapToPalette(out, colors, space, 1);
  return out;
}

/** Exposed for tests and the CLI. */
export function nearestPaletteDistance(
  img: PixelImage,
  colors: string[],
  x: number,
  y: number,
): number {
  const matcher = createPaletteMatcher(colors, 'oklab');
  const i = (y * img.width + x) * 4;
  return matcher.distance(img.data[i], img.data[i + 1], img.data[i + 2]);
}

export function blendLayerColors(
  base: [number, number, number],
  top: [number, number, number],
  mode: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay',
): [number, number, number] {
  return blendPixel(base, top, mode);
}

export function resampleImage(img: PixelImage, w: number, h: number): PixelImage {
  return resizeImage(img, w, h, 'box');
}

export function lerpNumber(a: number, b: number, t: number): number {
  return lerp(a, b, t);
}
