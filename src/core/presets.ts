/**
 * Built-in presets, graph ↔ settings bridging, serialisation and migration.
 */

import type { PixelArtifySettings, PipelineGraph, Preset } from './types';
import {
  DEFAULT_DITHER,
  DEFAULT_EXTRACTION,
  DEFAULT_VIDEO,
  deepClone,
  defaultSettings,
  mergeSettings,
  threeLayerStack,
} from './defaults';
import { createBatchGraph, createDefaultGraph, createLayeredGraph, nodeParams } from './graph';
import { createPostprocessOp, createPreprocessOp } from './preprocess';
import { BUILTIN_PALETTES } from './palette';

type GraphKind = 'classic' | 'layered' | 'batch';

function makePreset(
  id: string,
  name: string,
  description: string,
  settings: PixelArtifySettings,
  graphKind: GraphKind,
  tags: string[],
): Preset {
  const graph =
    graphKind === 'layered'
      ? createLayeredGraph(settings)
      : graphKind === 'batch'
        ? createBatchGraph(settings)
        : createDefaultGraph(settings, name);
  graph.id = `graph-${id}`;
  graph.name = name;
  graph.description = description;
  return {
    schema: 'pixelartify/preset',
    version: 1,
    id,
    name,
    description,
    author: 'PixelArtify Studio',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    graph,
    settings,
    tags,
  };
}

function presetSettings(patch: Partial<PixelArtifySettings>): PixelArtifySettings {
  return mergeSettings(defaultSettings(), patch);
}

const pico = BUILTIN_PALETTES.find((p) => p.id === 'pico-8')!;
const gameboy = BUILTIN_PALETTES.find((p) => p.id === 'gameboy-dmg')!;
const endesga = BUILTIN_PALETTES.find((p) => p.id === 'endesga-32')!;
const sweetie = BUILTIN_PALETTES.find((p) => p.id === 'sweetie-16')!;

export const BUILTIN_PRESETS: Preset[] = [
  makePreset(
    'sharp-sprite',
    'Sharp Sprite',
    'Crisp edge-aware sprites with an automatic 24-colour palette, Floyd–Steinberg dithering and a clean outer outline.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 270, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      pixelate: {
        edgeAware: true,
        alignment: 0.82,
        colorBlend: 0.82,
        edgeThreshold: 0.5,
        gridPasses: 3,
        preBlur: 0.2,
        postSharpen: 0.3,
        contrast: 1.06,
        brightness: 0,
        saturation: 1.08,
        gamma: 1,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: { mode: 'auto', colors: [], autoCount: 24, quantizer: 'kmeans', colorSpace: 'oklab', strength: 1 },
      dither: { ...DEFAULT_DITHER, algorithm: 'floyd-steinberg', strength: 1, serpentine: true },
      postprocess: { ops: [createPostprocessOp('outline')], lockPalette: true },
      output: { ...defaultSettings().output, transparent: true, exportLayers: false },
    }),
    'classic',
    ['sprite', 'game', 'crisp', 'default'],
  ),
  makePreset(
    'painterly-mosaic',
    'Painterly Mosaic',
    'Kuwahara painterly pre-pass, soft grain and blue-noise dithering for a rich, hand-painted mosaic.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 320, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      preprocess: { ops: [createPreprocessOp('painterly'), createPreprocessOp('grain')] },
      pixelate: {
        edgeAware: true,
        alignment: 0.55,
        colorBlend: 0.55,
        edgeThreshold: 0.55,
        gridPasses: 2,
        preBlur: 0.3,
        postSharpen: 0.08,
        contrast: 1.02,
        brightness: 0.01,
        saturation: 1.02,
        gamma: 1.02,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: { mode: 'auto', colors: [], autoCount: 40, quantizer: 'kmeans', colorSpace: 'oklab', strength: 1 },
      dither: { ...DEFAULT_DITHER, algorithm: 'blue-noise', strength: 0.85 },
      postprocess: {
        ops: [
          { ...createPostprocessOp('vignette'), params: { amount: 0.18, radius: 0.7 } },
          { ...createPostprocessOp('grain'), params: { amount: 0.05, scale: 1, monochrome: 1, seed: 3 } },
        ],
        lockPalette: false,
      },
    }),
    'classic',
    ['painterly', 'illustration', 'soft'],
  ),
  makePreset(
    'one-bit-ink',
    '1-bit Ink',
    'Two-colour ink art with Atkinson diffusion and a bold outline. Ideal for high-contrast illustrative sprites.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 240, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      preprocess: { ops: [createPreprocessOp('sharpen')] },
      pixelate: {
        edgeAware: true,
        alignment: 0.72,
        colorBlend: 0.95,
        edgeThreshold: 0.45,
        gridPasses: 2,
        preBlur: 0,
        postSharpen: 0.25,
        contrast: 1.25,
        brightness: 0.02,
        saturation: 0,
        gamma: 1.02,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: {
        mode: 'custom',
        colors: ['#0b0c10', '#f5f0e6'],
        autoCount: 2,
        quantizer: 'kmeans',
        colorSpace: 'oklab',
        strength: 1,
      },
      dither: { ...DEFAULT_DITHER, algorithm: 'atkinson', strength: 1, serpentine: true },
      postprocess: { ops: [createPostprocessOp('outline')], lockPalette: true },
    }),
    'classic',
    ['1-bit', 'ink', 'monochrome', 'high-contrast'],
  ),
  makePreset(
    'gameboy-dmg',
    'Game Boy DMG',
    'The four-shade DMG palette, 8× export and ordered Bayer dithering. Instantly readable retro hardware look.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 144, exportScale: 8, snapEven: true, minSide: 16, maxSide: 2048 },
      pixelate: {
        edgeAware: true,
        alignment: 0.6,
        colorBlend: 0.85,
        edgeThreshold: 0.5,
        gridPasses: 2,
        preBlur: 0.1,
        postSharpen: 0.15,
        contrast: 1.12,
        brightness: 0.02,
        saturation: 0,
        gamma: 1,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: {
        mode: 'custom',
        colors: gameboy.colors,
        autoCount: 4,
        quantizer: 'kmeans',
        colorSpace: 'oklab',
        strength: 1,
      },
      dither: { ...DEFAULT_DITHER, algorithm: 'bayer-4', strength: 1 },
    }),
    'classic',
    ['retro', 'gameboy', '4-colour'],
  ),
  makePreset(
    'cinematic-32',
    'Cinematic 32',
    'Endesga 32 with Sierra diffusion, bloom, vignette and scanline-free cinematic grading at 360p.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 360, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      preprocess: {
        ops: [
          { ...createPreprocessOp('bloom'), params: { threshold: 0.78, radius: 5, amount: 0.3 } },
        ],
      },
      pixelate: {
        edgeAware: true,
        alignment: 0.58,
        colorBlend: 0.6,
        edgeThreshold: 0.55,
        gridPasses: 2,
        preBlur: 0.4,
        postSharpen: 0.12,
        contrast: 1.08,
        brightness: -0.01,
        saturation: 1.08,
        gamma: 1.02,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: {
        mode: 'custom',
        colors: endesga.colors,
        autoCount: 32,
        quantizer: 'kmeans',
        colorSpace: 'oklab',
        strength: 1,
      },
      dither: { ...DEFAULT_DITHER, algorithm: 'sierra', strength: 0.9 },
      postprocess: {
        ops: [
          { ...createPostprocessOp('vignette'), params: { amount: 0.3, radius: 0.55 } },
          { ...createPostprocessOp('grain'), params: { amount: 0.035, scale: 1, monochrome: 1, seed: 11 } },
        ],
        lockPalette: false,
      },
    }),
    'classic',
    ['cinematic', 'film', '32-colour'],
  ),
  makePreset(
    'layered-parallax',
    'Layered Parallax',
    'Auto-extracts a subject and edge-detail layer, inpaints the background behind the cutout, and renders a game-ready parallax stack.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 270, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      extraction: {
        ...DEFAULT_EXTRACTION,
        enabled: true,
        method: 'saliency',
        threshold: 0.82,
        softness: 0.3,
        feather: 1.2,
      },
      layers: threeLayerStack().map((l) =>
        l.role === 'foreground' ? { ...l, occlusionMaskId: 'occlusion' } : l,
      ),
      palette: { mode: 'auto', colors: [], autoCount: 32, quantizer: 'kmeans', colorSpace: 'oklab', strength: 1 },
      dither: { ...DEFAULT_DITHER, algorithm: 'blue-noise', strength: 0.8 },
      output: { ...defaultSettings().output, exportLayers: true, writeManifest: true },
      postprocess: { ops: [createPostprocessOp('outline')], lockPalette: true },
    }),
    'layered',
    ['layers', 'parallax', 'background', 'game'],
  ),
  makePreset(
    'spritesheet-export',
    'Spritesheet Export',
    'A 128p animation preset with even dimensions, transparent background and spritesheet output at 12 fps.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 128, exportScale: 4, snapEven: true, minSide: 16, maxSide: 1024 },
      pixelate: {
        edgeAware: true,
        alignment: 0.7,
        colorBlend: 0.8,
        edgeThreshold: 0.5,
        gridPasses: 2,
        preBlur: 0.1,
        postSharpen: 0.22,
        contrast: 1.05,
        brightness: 0,
        saturation: 1.05,
        gamma: 1,
        hueShift: 0,
        alphaThreshold: 0.1,
      },
      palette: { mode: 'auto', colors: [], autoCount: 20, quantizer: 'kmeans', colorSpace: 'oklab', strength: 1 },
      dither: { ...DEFAULT_DITHER, algorithm: 'bayer-4', strength: 0.9 },
      video: {
        fps: 12,
        start: 0,
        end: null,
        output: 'both',
        codec: 'avc',
        bitrateMbps: 8,
        spritesheet: { columns: 0, padding: 0, maxSize: 2048, powerOfTwo: false, split: true },
        print: { ...DEFAULT_VIDEO.print },
      },
      output: { ...defaultSettings().output, transparent: true, exportLayers: false },
      postprocess: { ops: [createPostprocessOp('outline')], lockPalette: true },
    }),
    'classic',
    ['video', 'spritesheet', 'animation', 'transparent'],
  ),
  makePreset(
    'chunky-sweetie',
    'Chunky Sweetie',
    'Block-size sampling for deliberately large pixels, Sweetie 16 palette and no dithering for ultra-clean game tiles.',
    presetSettings({
      resolution: { mode: 'block-size', value: 3, exportScale: 6, snapEven: false, minSide: 16, maxSide: 1024 },
      pixelate: {
        edgeAware: true,
        alignment: 0.9,
        colorBlend: 0.9,
        edgeThreshold: 0.42,
        gridPasses: 3,
        preBlur: 0.5,
        postSharpen: 0.32,
        contrast: 1.08,
        brightness: 0,
        saturation: 1.12,
        gamma: 1,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: {
        mode: 'custom',
        colors: sweetie.colors,
        autoCount: 16,
        quantizer: 'kmeans',
        colorSpace: 'oklab',
        strength: 1,
      },
      dither: { ...DEFAULT_DITHER, algorithm: 'none' },
      postprocess: { ops: [], lockPalette: false },
    }),
    'classic',
    ['chunky', 'tiles', 'clean', '16-colour'],
  ),
  makePreset(
    'batch-portraits',
    'Batch Portraits',
    'A mixed-resolution batch preset: fixed art height keeps 480p, 1080p and 4K portraits visually consistent.',
    presetSettings({
      resolution: { mode: 'fixed-height', value: 300, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 },
      preprocess: { ops: [createPreprocessOp('soften')] },
      pixelate: {
        edgeAware: true,
        alignment: 0.6,
        colorBlend: 0.65,
        edgeThreshold: 0.5,
        gridPasses: 2,
        preBlur: 0.25,
        postSharpen: 0.15,
        contrast: 1.03,
        brightness: 0,
        saturation: 1.04,
        gamma: 1,
        hueShift: 0,
        alphaThreshold: 0.02,
      },
      palette: { mode: 'auto', colors: [], autoCount: 28, quantizer: 'kmeans', colorSpace: 'oklab', strength: 1 },
      dither: { ...DEFAULT_DITHER, algorithm: 'floyd-steinberg', strength: 0.95 },
    }),
    'batch',
    ['batch', 'portrait', 'resolution-independent'],
  ),
];

export function builtinPreset(id: string): Preset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}

/* -------------------------------------------------------------------------- */
/* Graph → settings bridge                                                    */
/* -------------------------------------------------------------------------- */

export function settingsFromGraph(graph: PipelineGraph): PixelArtifySettings {
  const s = defaultSettings();
  let hasPixelate = false;
  let hasPalette = false;
  let hasDither = false;
  for (const node of graph.nodes) {
    if (node.bypassed) continue;
    switch (node.type) {
      case 'preprocess':
        if (Array.isArray(node.params.ops)) s.preprocess.ops = deepClone(node.params.ops);
        break;
      case 'pixelate':
        hasPixelate = true;
        if (node.params.resolution) s.resolution = deepClone(node.params.resolution as typeof s.resolution);
        if (node.params.pixelate) s.pixelate = deepClone(node.params.pixelate as typeof s.pixelate);
        break;
      case 'palette':
        hasPalette = true;
        if (node.params.palette) s.palette = deepClone(node.params.palette as typeof s.palette);
        break;
      case 'dither':
        hasDither = true;
        if (node.params.dither) s.dither = deepClone(node.params.dither as typeof s.dither);
        break;
      case 'extract':
        if (node.params.extraction) s.extraction = deepClone(node.params.extraction as typeof s.extraction);
        break;
      case 'compose':
        if (Array.isArray(node.params.layers)) s.layers = deepClone(node.params.layers);
        break;
      case 'postprocess':
        if (node.params.postprocess) s.postprocess = deepClone(node.params.postprocess as typeof s.postprocess);
        break;
      case 'output':
        if (node.params.output) s.output = deepClone(node.params.output as typeof s.output);
        if (node.params.video) s.video = deepClone(node.params.video as typeof s.video);
        break;
      default:
        break;
    }
  }

  if (!hasPixelate) {
    s.pixelate.enabled = false;
    s.pixelate.contrast = 1;
    s.pixelate.brightness = 0;
    s.pixelate.saturation = 1;
    s.pixelate.gamma = 1;
    s.pixelate.hueShift = 0;
    s.pixelate.preBlur = 0;
    s.pixelate.postSharpen = 0;
    s.pixelate.alphaThreshold = 0;
    s.resolution = { ...s.resolution, mode: 'native', exportScale: 1, snapEven: false };
    s.layers = [];
  }
  if (!hasPalette) s.palette.mode = 'none';
  if (!hasDither) s.dither.algorithm = 'none';

  return s;
}

export function updateGraphFromSettings(graph: PipelineGraph, settings: PixelArtifySettings): PipelineGraph {
  const nodes = graph.nodes.map((node) => {
    switch (node.type) {
      case 'preprocess':
        return { ...node, params: { ...node.params, ops: deepClone(settings.preprocess.ops) } };
      case 'pixelate':
        return {
          ...node,
          params: {
            ...node.params,
            resolution: deepClone(settings.resolution),
            pixelate: deepClone(settings.pixelate),
          },
        };
      case 'palette':
        return { ...node, params: { ...node.params, palette: deepClone(settings.palette) } };
      case 'dither':
        return { ...node, params: { ...node.params, dither: deepClone(settings.dither) } };
      case 'extract':
        return { ...node, params: { ...node.params, extraction: deepClone(settings.extraction) } };
      case 'compose':
        return { ...node, params: { ...node.params, layers: deepClone(settings.layers) } };
      case 'postprocess':
        return { ...node, params: { ...node.params, postprocess: deepClone(settings.postprocess) } };
      case 'output':
        return {
          ...node,
          params: {
            ...node.params,
            output: deepClone(settings.output),
            video: deepClone(settings.video),
          },
        };
      default:
        return node;
    }
  });
  return { ...graph, nodes };
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

export function createPreset(name: string, graph: PipelineGraph, description = ''): Preset {
  const now = new Date().toISOString();
  return {
    schema: 'pixelartify/preset',
    version: 1,
    id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    description,
    author: 'PixelArtify Studio',
    createdAt: now,
    updatedAt: now,
    graph: deepClone(graph),
    settings: settingsFromGraph(graph),
  };
}

export function serializePreset(preset: Preset): string {
  return `${JSON.stringify(preset, null, 2)}\n`;
}

export function parsePreset(text: string): Preset {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object') throw new Error('Not a PixelArtify preset.');
  const obj = raw as Record<string, unknown>;

  if (obj.schema && obj.schema !== 'pixelartify/preset') {
    throw new Error('Unsupported preset schema.');
  }

  let graph: PipelineGraph;
  if (obj.graph && typeof obj.graph === 'object') {
    graph = normalizeGraph(obj.graph as PipelineGraph);
  } else if (obj.settings) {
    graph = createDefaultGraph(obj.settings as PixelArtifySettings);
  } else {
    throw new Error('Preset has neither a graph nor settings.');
  }

  const now = new Date().toISOString();
  return {
    schema: 'pixelartify/preset',
    version: 1,
    id: typeof obj.id === 'string' ? obj.id : `preset-${Date.now().toString(36)}`,
    name: typeof obj.name === 'string' ? obj.name : 'Imported Preset',
    description: typeof obj.description === 'string' ? obj.description : '',
    author: typeof obj.author === 'string' ? obj.author : undefined,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: now,
    graph,
    settings: obj.settings ? (obj.settings as PixelArtifySettings) : settingsFromGraph(graph),
    thumbnail: typeof obj.thumbnail === 'string' ? obj.thumbnail : undefined,
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

function normalizeGraph(input: PipelineGraph): PipelineGraph {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(input.edges) ? input.edges : []).filter(
    (e) => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode),
  );
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    params: node.params && typeof node.params === 'object' ? node.params : nodeParams(node.type),
    x: Number.isFinite(node.x) ? node.x : 0,
    y: Number.isFinite(node.y) ? node.y : 0,
    title: typeof node.title === 'string' ? node.title : node.type,
  }));
  return {
    id: input.id ?? `graph-${Date.now().toString(36)}`,
    name: input.name ?? 'Imported Graph',
    description: input.description ?? '',
    nodes: normalizedNodes,
    edges,
  };
}

export function downloadPresetName(preset: Preset): string {
  return `${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pixelartify.json`;
}
