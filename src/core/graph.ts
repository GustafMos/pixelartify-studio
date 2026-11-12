/**
 * Node graph model and evaluation.
 *
 * Supported topology: any acyclic DAG of typed nodes. Multiple input nodes
 * (each holding a folder / multi-selection) can feed separate chains or be
 * merged, and any number of output nodes can export their own results.
 *
 * Heavy image work is deferred: nodes accumulate a per-item render state, and
 * the runner materialises each output with the shared pipeline. That keeps
 * branching cheap and makes previews consistent with final renders.
 */

import type {
  DitherSettings,
  ExtractionSettings,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  LayerSettings,
  MaskData,
  OutputSettings,
  PaletteSettings,
  PixelArtifySettings,
  PixelImage,
  PixelateSettings,
  PipelineGraph,
  PostprocessOp,
  PostprocessSettings,
  PreprocessOp,
  ResolutionSettings,
  VideoSettings,
} from './types';
import {
  DEFAULT_DITHER,
  DEFAULT_EXTRACTION,
  DEFAULT_OUTPUT,
  DEFAULT_PALETTE,
  DEFAULT_PIXELATE,
  DEFAULT_VIDEO,
  defaultSettings,
  deepClone,
  threeLayerStack,
} from './defaults';
import { DEFAULT_RESOLUTION, computeArtSize } from './resolution';
import { extractMask } from './extraction';
import {
  cloneImage,
  compositeOver,
  cropImage,
  cropMaskNormalized,
  multiplyAlpha,
  resizeImage,
  resizeMask,
  type ResizeFilter,
} from './image';
import { DEFAULT_CHANNELS, applyChannels, type ChannelSettings } from './channels';
import { DEFAULT_COLOR_CORRECTION } from './preprocess';
import { DEFAULT_BACKGROUND, renderBackground, type BackgroundParams } from './background';
import { DEFAULT_OBJECT3D, renderObject3D, type Render3DParams } from './render3d';

export type SocketType = 'media' | 'mask' | 'palette';

export interface NodePortDef {
  id: string;
  label: string;
  type: SocketType;
  multiple?: boolean;
  optional?: boolean;
}

export interface NodeDefinition {
  type: GraphNodeType;
  title: string;
  category: 'source' | 'process' | 'colour' | 'layer' | 'output';
  description: string;
  accent: string;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
}

export const NODE_DEFS: Record<GraphNodeType, NodeDefinition> = {
  input: {
    type: 'input',
    title: 'Media input',
    category: 'source',
    description:
      'A folder or multi-selection of images/videos. Every asset is processed independently through the graph.',
    accent: '#4cc9f0',
    inputs: [],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  crop: {
    type: 'crop',
    title: 'Crop',
    category: 'process',
    description:
      'Crop the source by normalized, percentage or pixel coordinates. Alpha and feature masks are cropped with it.',
    accent: '#fb8500',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  resize: {
    type: 'resize',
    title: 'Resize',
    category: 'process',
    description:
      'Resize by pixels, percent or a times multiplier. Nearest-neighbour is the default; bilinear, box, bicubic and Lanczos3 are also available. Premultiplied alpha is retained.',
    accent: '#2ec4b6',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  color: {
    type: 'color',
    title: 'Color correct',
    category: 'colour',
    description:
      'Exposure, contrast, brightness, saturation, gamma, hue, temperature and tint. Alpha is retained.',
    accent: '#ffb703',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  channels: {
    type: 'channels',
    title: 'Channels',
    category: 'colour',
    description:
      'Colour → channel mode: extract, swap, pack, luma↔alpha, or encode HSL into RGB. Optionally retain alpha.',
    accent: '#e07a5f',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  preprocess: {
    type: 'preprocess',
    title: 'Pre-process',
    category: 'process',
    description:
      'Painterly, oil, watercolour, displacement, grain, blur, bloom and more. Applied at the canonical working resolution.',
    accent: '#f72585',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  pixelate: {
    type: 'pixelate',
    title: 'Pixelate',
    category: 'process',
    description:
      'Resolution policy plus the edge-aware sampler. This node defines the art size and the pixel-art grid.',
    accent: '#ffd166',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  palette: {
    type: 'palette',
    title: 'Palette',
    category: 'colour',
    description:
      'Extract a palette from the image or supply a custom/library palette. Also outputs the palette for dithering.',
    accent: '#b5179e',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [
      { id: 'media', label: 'Media', type: 'media' },
      { id: 'palette', label: 'Palette', type: 'palette' },
    ],
  },
  dither: {
    type: 'dither',
    title: 'Dither',
    category: 'colour',
    description:
      'Choose from ordered, pattern, error-diffusion and palette-blend algorithms. Scale is in art pixels.',
    accent: '#7209b7',
    inputs: [
      { id: 'media', label: 'Media', type: 'media' },
      { id: 'palette', label: 'Palette', type: 'palette', optional: true },
    ],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  extract: {
    type: 'extract',
    title: 'Feature extract',
    category: 'layer',
    description:
      'Saliency, chroma-key, luma, edge or manual masks. Use several extract nodes for background/subject/detail layers.',
    accent: '#06d6a0',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [
      { id: 'media', label: 'Media', type: 'media' },
      { id: 'mask', label: 'Mask', type: 'mask' },
    ],
  },
  compose: {
    type: 'compose',
    title: 'Compose layers',
    category: 'layer',
    description:
      'Builds a layer stack. Background layers can inpaint regions occluded by foreground layers.',
    accent: '#118ab2',
    inputs: [
      { id: 'media', label: 'Media', type: 'media' },
      { id: 'masks', label: 'Masks', type: 'mask', multiple: true, optional: true },
    ],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  background: {
    type: 'background',
    title: 'Background',
    category: 'source',
    description:
      'Generate a solid colour, gradient or pattern. Connect media to place it behind an image or video; leave unconnected to output the background on its own.',
    accent: '#4d96ff',
    inputs: [{ id: 'media', label: 'Media', type: 'media', optional: true }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  object3d: {
    type: 'object3d',
    title: '3D object',
    category: 'source',
    description:
      'Render a cube, sphere, cylinder, cone, torus or pyramid with an orthographic camera. Rotate, move and light it; connect media to composite the object on top.',
    accent: '#f8961e',
    inputs: [{ id: 'media', label: 'Media', type: 'media', optional: true }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  postprocess: {
    type: 'postprocess',
    title: 'Post-process',
    category: 'process',
    description:
      'Sprite outline, bloom, grain, scanlines, vignette, chromatic aberration, CRT and sharpening.',
    accent: '#ef476f',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  merge: {
    type: 'merge',
    title: 'Merge inputs',
    category: 'source',
    description: 'Concatenates multiple media bundles into one batch stream.',
    accent: '#8ecae6',
    inputs: [{ id: 'media', label: 'Media', type: 'media', multiple: true }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
  router: {
    type: 'router',
    title: 'Router',
    category: 'process',
    description:
      'A pure pass-through/reroute point for media, masks and palettes. Insert one to keep branches intact when replacing or deleting a node.',
    accent: '#90e0ef',
    inputs: [
      { id: 'media', label: 'Media', type: 'media', multiple: true, optional: true },
      { id: 'mask', label: 'Mask', type: 'mask', multiple: true, optional: true },
      { id: 'palette', label: 'Palette', type: 'palette', multiple: true, optional: true },
    ],
    outputs: [
      { id: 'media', label: 'Media', type: 'media' },
      { id: 'mask', label: 'Mask', type: 'mask' },
      { id: 'palette', label: 'Palette', type: 'palette' },
    ],
  },
  output: {
    type: 'output',
    title: 'Output',
    category: 'output',
    description:
      'Exports PNG/WebP images, videos, spritesheets or both — with optional layer manifests. Add several outputs to render variants.',
    accent: '#90be6d',
    inputs: [{ id: 'media', label: 'Media', type: 'media' }],
    outputs: [{ id: 'media', label: 'Media', type: 'media' }],
  },
};

/* -------------------------------------------------------------------------- */
/* Runtime types                                                              */
/* -------------------------------------------------------------------------- */

export type AssetKind = 'image' | 'video';

export interface GraphAsset {
  id: string;
  name: string;
  kind: AssetKind;
  image: PixelImage;
  width: number;
  height: number;
  duration?: number;
  fps?: number;
}

export interface GraphMediaItem {
  key: string;
  name: string;
  assetId: string;
  kind: AssetKind;
  source: PixelImage;
  sourceWidth: number;
  sourceHeight: number;
  masks: Record<string, MaskData>;
  /** Mask IDs applied to the media output by "only extracted" nodes. */
  alphaCutMaskIds?: string[];
  /** Cache keys (`node:asset:mask`) for tracked alpha cuts. */
  alphaCutKeys?: string[];
  layers: LayerSettings[];
  preprocessOps: PreprocessOp[];
  latePreprocessOps: PreprocessOp[];
  postprocess: PostprocessSettings;
  /** Generated backdrop applied behind live video frames. */
  underlay?: PixelImage;
  /** Generated overlay (for example a 3D object) applied on top of frames. */
  overlay?: PixelImage;
  resolution: ResolutionSettings;
  pixelate: PixelateSettings;
  /** True only if a Pixelate node is present in this branch. */
  pixelateEnabled: boolean;
  /** True only if a Palette node is present in this branch. */
  paletteEnabled: boolean;
  /** True only if a Dither node is present in this branch. */
  ditherEnabled: boolean;
  palette: PaletteSettings;
  dither: DitherSettings;
  output: OutputSettings;
  video: VideoSettings;
  extraction: ExtractionSettings;
  stage: 'source' | 'art';
  meta?: Record<string, unknown>;
}

export interface GraphMaskItem {
  assetKey: string;
  assetId: string;
  name: string;
  maskId: string;
  mask: MaskData;
}

export interface GraphPaletteItem {
  assetKey: string;
  settings: PaletteSettings;
}

export type GraphValue =
  | { type: 'media'; items: GraphMediaItem[] }
  | { type: 'mask'; items: GraphMaskItem[] }
  | { type: 'palette'; items: GraphPaletteItem[] };

export interface GraphError {
  nodeId?: string;
  message: string;
}

export interface GraphEvaluation {
  /** Per-node, per-port values. */
  values: Map<string, Record<string, GraphValue>>;
  errors: GraphError[];
  order: string[];
}

export interface EvaluateOptions {
  assetsByNode: Record<string, GraphAsset[]>;
  /** Optional cache for extracted masks (keyed by asset + settings). */
  maskCache?: Map<string, MaskData>;
  /** Painted mask overrides keyed by `${nodeId}:${assetId}:${maskId}`. */
  maskOverrides?: Record<string, MaskData>;
}

/* -------------------------------------------------------------------------- */
/* Node creation & defaults                                                   */
/* -------------------------------------------------------------------------- */

export function nodeParams(type: GraphNodeType, settings?: PixelArtifySettings): Record<string, unknown> {
  const s = settings ?? defaultSettings();
  switch (type) {
    case 'input':
      return { label: 'Media' };
    case 'crop':
      return { x: 0, y: 0, width: 1, height: 1, unit: 'normalized' };
    case 'resize':
      return {
        width: 0,
        height: 0,
        unit: 'pixels',
        factor: 2,
        mode: 'fit',
        filter: 'nearest',
        allowUpscale: 1,
      };
    case 'channels':
      return { ...deepClone(DEFAULT_CHANNELS) };
    case 'color':
      return { color: deepClone(DEFAULT_COLOR_CORRECTION) };
    case 'preprocess':
      return { ops: deepClone(s.preprocess.ops) };
    case 'pixelate':
      return { resolution: deepClone(s.resolution), pixelate: deepClone(s.pixelate) };
    case 'palette':
      return { palette: deepClone(s.palette) };
    case 'dither':
      return { dither: deepClone(s.dither) };
    case 'extract':
      return {
        extraction: { ...deepClone(s.extraction), enabled: true },
        maskId: 'subject',
        onlyExtracted: false,
      };
    case 'compose':
      return { layers: deepClone(s.layers.length > 0 ? s.layers : threeLayerStack()) };
    case 'background':
      return { ...deepClone(DEFAULT_BACKGROUND) };
    case 'object3d':
      return { ...deepClone(DEFAULT_OBJECT3D) };
    case 'postprocess':
      return { postprocess: deepClone(s.postprocess) };
    case 'merge':
      return {};
    case 'router':
      return {};
    case 'output':
      return { output: deepClone(s.output), video: deepClone(s.video), label: 'Output' };
    default:
      return {};
  }
}

export function createNode(
  type: GraphNodeType,
  x: number,
  y: number,
  params?: Record<string, unknown>,
  settings?: PixelArtifySettings,
): GraphNode {
  const def = NODE_DEFS[type];
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: def.title,
    x,
    y,
    params: params ?? nodeParams(type, settings),
  };
}

export function connect(
  graph: PipelineGraph,
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
): PipelineGraph {
  const edge: GraphEdge = {
    id: `edge-${Math.random().toString(36).slice(2, 8)}`,
    fromNode,
    fromPort,
    toNode,
    toPort,
  };
  // Replace existing connection on a single-input port.
  const def = NODE_DEFS[graph.nodes.find((n) => n.id === toNode)?.type ?? 'merge'];
  const port = def.inputs.find((p) => p.id === toPort);
  const filtered = port && !port.multiple
    ? graph.edges.filter((e) => !(e.toNode === toNode && e.toPort === toPort))
    : graph.edges;
  return { ...graph, edges: [...filtered, edge] };
}

/* -------------------------------------------------------------------------- */
/* Default graphs                                                             */
/* -------------------------------------------------------------------------- */

export function createDefaultGraph(settings?: PixelArtifySettings, name = 'PixelArtify Graph'): PipelineGraph {
  const s = settings ?? defaultSettings();
  const ids = {
    input: 'input-main',
    pre: 'pre-main',
    pixel: 'pixelate-main',
    palette: 'palette-main',
    dither: 'dither-main',
    post: 'post-main',
    output: 'output-main',
  };
  // Compact 3-column layout that fits comfortably in the graph viewport.
  const nodes: GraphNode[] = [
    { ...createNode('input', 40, 40, { label: 'Media' }, s), id: ids.input },
    { ...createNode('preprocess', 40, 270, { ops: deepClone(s.preprocess.ops) }, s), id: ids.pre },
    { ...createNode('pixelate', 40, 500, nodeParams('pixelate', s), s), id: ids.pixel },
    { ...createNode('palette', 340, 40, { palette: deepClone(s.palette) }, s), id: ids.palette },
    { ...createNode('dither', 340, 270, { dither: deepClone(s.dither) }, s), id: ids.dither },
    { ...createNode('postprocess', 340, 500, { postprocess: deepClone(s.postprocess) }, s), id: ids.post },
    { ...createNode('output', 650, 270, nodeParams('output', s), s), id: ids.output },
  ];
  const edges: GraphEdge[] = [
    { id: 'e-in-pre', fromNode: ids.input, fromPort: 'media', toNode: ids.pre, toPort: 'media' },
    { id: 'e-pre-pix', fromNode: ids.pre, fromPort: 'media', toNode: ids.pixel, toPort: 'media' },
    { id: 'e-pix-pal', fromNode: ids.pixel, fromPort: 'media', toNode: ids.palette, toPort: 'media' },
    { id: 'e-pal-dit', fromNode: ids.palette, fromPort: 'media', toNode: ids.dither, toPort: 'media' },
    { id: 'e-pal2-dit', fromNode: ids.palette, fromPort: 'palette', toNode: ids.dither, toPort: 'palette' },
    { id: 'e-dit-post', fromNode: ids.dither, fromPort: 'media', toNode: ids.post, toPort: 'media' },
    { id: 'e-post-out', fromNode: ids.post, fromPort: 'media', toNode: ids.output, toPort: 'media' },
  ];
  return { id: `graph-${Math.random().toString(36).slice(2, 8)}`, name, description: '', nodes, edges };
}

export function createLayeredGraph(settings?: PixelArtifySettings): PipelineGraph {
  const s = settings ?? defaultSettings();
  const base = createDefaultGraph(s, 'Layered Graph');
  const input = base.nodes.find((n) => n.type === 'input')!;
  const pre = base.nodes.find((n) => n.type === 'preprocess')!;
  const pixel = base.nodes.find((n) => n.type === 'pixelate')!;
  const paletteNode = base.nodes.find((n) => n.type === 'palette')!;
  const ditherNode = base.nodes.find((n) => n.type === 'dither')!;
  const postNode = base.nodes.find((n) => n.type === 'postprocess')!;
  const outputNode = base.nodes.find((n) => n.type === 'output')!;

  const extractSubject = createNode('extract', 40, 260, {
    extraction: { ...deepClone(s.extraction), enabled: true, method: 'saliency' },
    maskId: 'subject',
  }, s);
  const extractDetail = createNode('extract', 40, 500, {
    extraction: { ...deepClone(s.extraction), enabled: true, method: 'edge', threshold: 0.4 },
    maskId: 'detail',
  }, s);
  const extractOcclusion = createNode('extract', 340, 700, {
    extraction: {
      ...deepClone(s.extraction),
      enabled: true,
      method: 'box',
      boxX: 0.37,
      boxY: 0.25,
      boxWidth: 0.28,
      boxHeight: 0.7,
      boxShape: 'ellipse',
    },
    maskId: 'occlusion',
  }, s);
  const stack = threeLayerStack().map((l) =>
    l.role === 'foreground' ? { ...l, occlusionMaskId: 'occlusion' } : l,
  );
  const compose = createNode('compose', 340, 280, { layers: deepClone(stack) }, s);

  // Re-route: input → extract(s) → compose → pixelate.
  const nodes = [
    ...base.nodes.filter((n) => n.id !== pre.id),
    extractSubject,
    extractDetail,
    extractOcclusion,
    compose,
  ];
  const edges = base.edges.filter(
    (e) =>
      !(e.toNode === pixel.id && e.toPort === 'media') &&
      !(e.fromNode === pre.id) &&
      !(e.toNode === pre.id),
  );
  // Keep palette/dither/post/output chain.
  edges.push(
    { id: 'e-in-sub', fromNode: input.id, fromPort: 'media', toNode: extractSubject.id, toPort: 'media' },
    { id: 'e-in-det', fromNode: input.id, fromPort: 'media', toNode: extractDetail.id, toPort: 'media' },
    { id: 'e-in-occ', fromNode: input.id, fromPort: 'media', toNode: extractOcclusion.id, toPort: 'media' },
    { id: 'e-sub-cmp', fromNode: extractSubject.id, fromPort: 'mask', toNode: compose.id, toPort: 'masks' },
    { id: 'e-det-cmp', fromNode: extractDetail.id, fromPort: 'mask', toNode: compose.id, toPort: 'masks' },
    { id: 'e-occ-cmp', fromNode: extractOcclusion.id, fromPort: 'mask', toNode: compose.id, toPort: 'masks' },
    { id: 'e-in-cmp', fromNode: input.id, fromPort: 'media', toNode: compose.id, toPort: 'media' },
    { id: 'e-cmp-pix', fromNode: compose.id, fromPort: 'media', toNode: pixel.id, toPort: 'media' },
  );

  // Compact layout for the layered branch.
  const layout: Record<string, [number, number]> = {
    [input.id]: [40, 40],
    [extractSubject.id]: [40, 260],
    [extractDetail.id]: [40, 500],
    [extractOcclusion.id]: [340, 700],
    [compose.id]: [340, 280],
    [pixel.id]: [340, 520],
    [paletteNode.id]: [640, 40],
    [ditherNode.id]: [640, 280],
    [postNode.id]: [640, 520],
    [outputNode.id]: [940, 390],
  };
  const positioned = nodes.map((n) => {
    const pos = layout[n.id];
    return pos ? { ...n, x: pos[0], y: pos[1] } : n;
  });
  return { ...base, nodes: positioned, edges };
}

export function createBatchGraph(settings?: PixelArtifySettings): PipelineGraph {
  const s = settings ?? defaultSettings();
  const base = createDefaultGraph(s, 'Batch Graph');
  const input = base.nodes.find((n) => n.type === 'input')!;
  const pre = base.nodes.find((n) => n.type === 'preprocess')!;
  const input2 = createNode('input', 40, 400, { label: 'Media B' }, s);
  const merge = createNode('merge', 340, 250, {}, s);
  const nodes = [...base.nodes, input2, merge];
  const edges = base.edges.filter((e) => !(e.toNode === pre.id && e.toPort === 'media'));
  edges.push(
    { id: 'e-a-merge', fromNode: input.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
    { id: 'e-b-merge', fromNode: input2.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
    { id: 'e-merge-pre', fromNode: merge.id, fromPort: 'media', toNode: pre.id, toPort: 'media' },
  );
  // Shift the main chain to the right of the merge node.
  const shifted = nodes.map((n) => {
    if (n.id === input.id) return { ...n, x: 40, y: 80 };
    if (n.id === input2.id) return { ...n, x: 40, y: 400 };
    if (n.id === merge.id) return { ...n, x: 340, y: 240 };
    if (n.id === pre.id) return { ...n, x: 640, y: 240 };
    if (n.type === 'pixelate') return { ...n, x: 940, y: 240 };
    if (n.type === 'palette') return { ...n, x: 1240, y: 240 };
    if (n.type === 'dither') return { ...n, x: 1540, y: 240 };
    if (n.type === 'postprocess') return { ...n, x: 1840, y: 240 };
    if (n.type === 'output') return { ...n, x: 2140, y: 240 };
    return n;
  });
  return { ...base, nodes: shifted, edges };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export function topoSort(graph: PipelineGraph): { order: string[]; errors: GraphError[] } {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!incoming.has(edge.fromNode) || !incoming.has(edge.toNode)) continue;
    incoming.set(edge.toNode, (incoming.get(edge.toNode) ?? 0) + 1);
    outgoing.get(edge.fromNode)!.push(edge.toNode);
  }
  const queue = [...graph.nodes].filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 1) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  const errors: GraphError[] = [];
  if (order.length !== graph.nodes.length) {
    errors.push({ message: 'The graph contains a cycle. Remove the loop to evaluate it.' });
  }
  return { order, errors };
}

export function validateGraph(graph: PipelineGraph): GraphError[] {
  const errors = topoSort(graph).errors;
  if (!graph.nodes.some((n) => n.type === 'output')) {
    errors.push({ message: 'Add an Output node to export results.' });
  }
  for (const edge of graph.edges) {
    const from = graph.nodes.find((n) => n.id === edge.fromNode);
    const to = graph.nodes.find((n) => n.id === edge.toNode);
    if (!from || !to) {
      errors.push({ message: 'An edge references a missing node.' });
      continue;
    }
    const out = NODE_DEFS[from.type].outputs.find((p) => p.id === edge.fromPort);
    const inp = NODE_DEFS[to.type].inputs.find((p) => p.id === edge.toPort);
    if (!out || !inp || out.type !== inp.type) {
      errors.push({ nodeId: to.id, message: `Invalid connection into “${to.title}”.` });
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export function evaluateGraph(graph: PipelineGraph, options: EvaluateOptions): GraphEvaluation {
  const { order, errors } = topoSort(graph);
  const values = new Map<string, Record<string, GraphValue>>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const nodeId of order) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const inputs = new Map<string, GraphValue[]>();
    for (const edge of graph.edges) {
      if (edge.toNode !== nodeId) continue;
      const value = values.get(edge.fromNode)?.[edge.fromPort];
      if (!value) continue;
      const list = inputs.get(edge.toPort) ?? [];
      list.push(value);
      inputs.set(edge.toPort, list);
    }

    try {
      const outputs = evaluateNode(node, inputs, options);
      if (outputs) values.set(nodeId, outputs);
    } catch (err) {
      errors.push({ nodeId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { values, errors, order };
}

function evaluateNode(
  node: GraphNode,
  inputs: Map<string, GraphValue[]>,
  options: EvaluateOptions,
): Record<string, GraphValue> | null {
  const media = firstMedia(inputs, 'media');
  if (node.bypassed) {
    return bypassOutputs(inputs);
  }

  switch (node.type) {
    case 'input': {
      const assets = options.assetsByNode[node.id] ?? [];
      return {
        media: { type: 'media', items: assets.map((asset) => makeItem(node, asset)) },
      };
    }
    case 'crop': {
      if (!media) return null;
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => cropItem(item, node.params)),
        },
      };
    }
    case 'resize': {
      if (!media) return null;
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => resizeItem(item, node.params)),
        },
      };
    }
    case 'channels': {
      if (!media) return null;
      const settings = node.params as unknown as ChannelSettings;
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => ({
            ...item,
            source: applyChannels(item.source, { ...DEFAULT_CHANNELS, ...settings }),
          })),
        },
      };
    }
    case 'color': {
      if (!media) return null;
      const color = {
        ...deepClone(DEFAULT_COLOR_CORRECTION),
        ...(node.params.color as Partial<typeof DEFAULT_COLOR_CORRECTION> | undefined),
      };
      const op: PreprocessOp = {
        id: `color-${node.id}`,
        type: 'colorCorrect',
        enabled: true,
        params: { ...color },
      };
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => ({
            ...item,
            preprocessOps: [...item.preprocessOps, op],
          })),
        },
      };
    }
    case 'preprocess': {
      if (!media) return null;
      const ops = toOps(node.params.ops);
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => ({
            ...item,
            preprocessOps: [...item.preprocessOps, ...deepClone(ops)],
          })),
        },
      };
    }
    case 'pixelate': {
      if (!media) return null;
      const resolution = (node.params.resolution as ResolutionSettings) ?? deepClone(DEFAULT_RESOLUTION);
      const pixelate = (node.params.pixelate as PixelateSettings) ?? deepClone(DEFAULT_PIXELATE);
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => ({
            ...item,
            resolution: deepClone(resolution),
            pixelate: deepClone(pixelate),
            pixelateEnabled: true,
            stage: 'art',
          })),
        },
      };
    }
    case 'palette': {
      if (!media) return null;
      const palette = (node.params.palette as PaletteSettings) ?? deepClone(DEFAULT_PALETTE);
      const items = media.items.map((item) => ({
        ...item,
        palette: deepClone(palette),
        paletteEnabled: true,
      }));
      return {
        media: { type: 'media', items },
        palette: {
          type: 'palette',
          items: items.map((item) => ({ assetKey: item.key, settings: deepClone(palette) })),
        },
      };
    }
    case 'dither': {
      if (!media) return null;
      const dither = (node.params.dither as DitherSettings) ?? deepClone(DEFAULT_DITHER);
      const paletteInput = inputs.get('palette')?.[0];
      const paletteByKey = new Map<string, PaletteSettings>();
      if (paletteInput && paletteInput.type === 'palette') {
        for (const p of paletteInput.items) paletteByKey.set(p.assetKey, p.settings);
      }
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => {
            const override = paletteByKey.get(item.key);
            return {
              ...item,
              dither: deepClone(dither),
              ditherEnabled: true,
              palette: override ? deepClone(override) : item.palette,
              paletteEnabled: item.paletteEnabled || Boolean(override),
              stage: 'art',
            };
          }),
        },
      };
    }
    case 'extract': {
      if (!media) return null;
      const extraction: ExtractionSettings = {
        ...deepClone(DEFAULT_EXTRACTION),
        ...(node.params.extraction as Partial<ExtractionSettings> | undefined),
      };
      const maskId = String(node.params.maskId ?? 'subject');
      const onlyExtracted = Boolean(node.params.onlyExtracted);
      if (!extraction.enabled) {
        return { media, mask: { type: 'mask', items: [] } };
      }
      const maskItems: GraphMaskItem[] = [];
      const cacheKeyBase = `${maskId}:${JSON.stringify(extraction)}`;
      const items = media.items.map((item) => {
        const art = computeArtSize(item.sourceWidth, item.sourceHeight, item.resolution);
        const userOverride = options.maskOverrides?.[`${node.id}:${item.assetId}:${maskId}`];
        const key = `${item.assetId}:${art.width}:${cacheKeyBase}`;
        let mask = userOverride;
        if (!mask) {
          const cached = options.maskCache?.get(key);
          mask = cached ?? extractMask(item.source, extraction, art.width);
          if (!cached && options.maskCache && options.maskCache.size < 48) {
            options.maskCache.set(key, mask);
          }
        }
        maskItems.push({
          assetKey: item.key,
          assetId: item.assetId,
          name: item.name,
          maskId,
          mask,
        });
        let source = item.source;
        if (onlyExtracted) {
          source = cloneImage(source);
          multiplyAlpha(source, mask);
        }
        return {
          ...item,
          source,
          masks: { ...item.masks, [maskId]: mask },
          alphaCutMaskIds: onlyExtracted
            ? [...(item.alphaCutMaskIds ?? []), maskId]
            : item.alphaCutMaskIds,
          alphaCutKeys: onlyExtracted
            ? [...(item.alphaCutKeys ?? []), `${node.id}:${item.assetId}:${maskId}`]
            : item.alphaCutKeys,
          extraction: deepClone(extraction),
        };
      });
      return {
        media: { type: 'media', items },
        mask: { type: 'mask', items: maskItems },
      };
    }
    case 'compose': {
      if (!media) return null;
      const layers = (node.params.layers as LayerSettings[]) ?? [];
      const maskInputs = inputs.get('masks') ?? [];
      const masksByKey = new Map<string, Record<string, MaskData>>();
      for (const value of maskInputs) {
        if (value.type !== 'mask') continue;
        for (const m of value.items) {
          const acc = masksByKey.get(m.assetKey) ?? {};
          acc[m.maskId] = m.mask;
          masksByKey.set(m.assetKey, acc);
        }
      }
      return {
        media: {
          type: 'media',
          items: media.items.map((item, index) => {
            const extra = masksByKey.get(item.key) ?? {};
            const fallback: Record<string, MaskData> = { ...item.masks };
            if (Object.keys(extra).length === 0) {
              for (const value of maskInputs) {
                if (value.type !== 'mask') continue;
                const m = value.items[index] ?? value.items[0];
                if (m) fallback[m.maskId] = m.mask;
              }
            }
            return {
              ...item,
              masks: Object.keys(extra).length > 0 ? { ...item.masks, ...extra } : fallback,
              layers: deepClone(layers),
            };
          }),
        },
      };
    }
    case 'background': {
      const params: BackgroundParams = {
        ...deepClone(DEFAULT_BACKGROUND),
        ...(node.params as Partial<BackgroundParams>),
      };
      if (!media) {
        const image = renderBackground(params.width, params.height, params);
        return {
          media: { type: 'media', items: [makeGeneratedItem(node, image, 'Background')] },
        };
      }
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => {
            const backdrop = renderBackground(item.sourceWidth, item.sourceHeight, params);
            const underlay = item.underlay ? compositeOver(backdrop, item.underlay) : backdrop;
            return {
              ...item,
              source: compositeOver(backdrop, item.source),
              underlay,
            };
          }),
        },
      };
    }
    case 'object3d': {
      const params: Render3DParams = {
        ...deepClone(DEFAULT_OBJECT3D),
        ...(node.params as Partial<Render3DParams>),
      };
      if (!media) {
        const image = renderObject3D(params.width, params.height, params);
        return {
          media: { type: 'media', items: [makeGeneratedItem(node, image, '3D object')] },
        };
      }
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => {
            // With an input the object is an overlay, so a solid background
            // would hide the source. The Background node handles backdrops.
            const object = renderObject3D(item.sourceWidth, item.sourceHeight, {
              ...params,
              background: 'transparent',
            });
            const overlay = item.overlay ? compositeOver(item.overlay, object) : object;
            return {
              ...item,
              source: compositeOver(item.source, object),
              overlay,
            };
          }),
        },
      };
    }
    case 'postprocess': {
      if (!media) return null;
      const post = (node.params.postprocess as PostprocessSettings) ?? { ops: [], lockPalette: false };
      return {
        media: {
          type: 'media',
          items: media.items.map((item) => ({
            ...item,
            postprocess: {
              ops: [...item.postprocess.ops, ...deepClone(post.ops)],
              lockPalette: post.lockPalette || item.postprocess.lockPalette,
            },
          })),
        },
      };
    }
    case 'merge': {
      const list = inputs.get('media') ?? [];
      const items = list.flatMap((v) => (v.type === 'media' ? v.items : []));
      return { media: { type: 'media', items } };
    }
    case 'router': {
      const out: Record<string, GraphValue> = {};
      const mediaItems = (inputs.get('media') ?? []).flatMap((v) =>
        v.type === 'media' ? v.items : [],
      );
      if (mediaItems.length > 0) out.media = { type: 'media', items: mediaItems };
      const maskItems = (inputs.get('mask') ?? []).flatMap((v) =>
        v.type === 'mask' ? v.items : [],
      );
      if (maskItems.length > 0) out.mask = { type: 'mask', items: maskItems };
      const palette = (inputs.get('palette') ?? []).find(
        (v): v is Extract<GraphValue, { type: 'palette' }> => v.type === 'palette',
      );
      if (palette) out.palette = palette;
      return out;
    }
    case 'output': {
      return media ? { media: { type: 'media', items: media.items } } : null;
    }
    default:
      return null;
  }
}

function firstMedia(inputs: Map<string, GraphValue[]>, port: string): { type: 'media'; items: GraphMediaItem[] } | null {
  const value = inputs.get(port)?.[0];
  return value && value.type === 'media' ? value : null;
}

function bypassOutputs(inputs: Map<string, GraphValue[]>): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};
  const media = firstMedia(inputs, 'media');
  if (media) out.media = media;
  const mask = inputs.get('masks')?.[0] ?? inputs.get('mask')?.[0];
  if (mask && mask.type === 'mask') out.mask = mask;
  const palette = inputs.get('palette')?.[0];
  if (palette && palette.type === 'palette') out.palette = palette;
  return out;
}

export function valueAtPort(
  evaluation: GraphEvaluation,
  nodeId: string,
  port: string,
): GraphValue | undefined {
  return evaluation.values.get(nodeId)?.[port];
}

export function mediaAtPort(
  evaluation: GraphEvaluation,
  nodeId: string,
  port = 'media',
): GraphMediaItem[] {
  const value = valueAtPort(evaluation, nodeId, port);
  return value && value.type === 'media' ? value.items : [];
}

/**
 * Apply "only extracted" masks to a live video frame. Image sources already
 * carry the cut in `item.source`, so only use this with frame overrides.
 */
export function applyItemAlphaCuts(item: GraphMediaItem, image: PixelImage): PixelImage {
  const ids = item.alphaCutMaskIds ?? [];
  if (ids.length === 0) return image;
  const out = cloneImage(image);
  for (const id of ids) {
    const mask = item.masks[id];
    if (mask) multiplyAlpha(out, mask);
  }
  return out;
}

export interface TrackedMaskSequence {
  /** Frames per second used when the sequence was generated. */
  fps: number;
  /** Masks at the tracking resolution, in time order. */
  masks: MaskData[];
}

/** Apply per-frame tracked masks when rendering a live/exported video frame. */
export function applyTrackedAlphaCuts(
  item: GraphMediaItem,
  image: PixelImage,
  time: number,
  tracked: Record<string, TrackedMaskSequence> | undefined,
): PixelImage {
  const keys = item.alphaCutKeys ?? [];
  let out = keys.length === 0 ? applyItemAlphaCuts(item, image) : cloneImage(image);
  if (keys.length > 0) {
    for (const key of keys) {
      const maskId = key.split(':')[2] ?? '';
      const seq = tracked?.[key];
      let mask: MaskData | undefined;
      if (seq && seq.masks.length > 0) {
        const index = Math.max(0, Math.min(seq.masks.length - 1, Math.round(time * seq.fps)));
        mask = seq.masks[index];
      }
      if (!mask) mask = item.masks[maskId];
      if (mask) multiplyAlpha(out, mask);
    }
  }
  // Generated scene layers are static, so they are baked into `item.source`
  // for stills. Live video frames arrive separately and need them reapplied.
  if (item.underlay) out = compositeOver(item.underlay, out);
  if (item.overlay) out = compositeOver(out, item.overlay);
  return out;
}

interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cropBounds(params: Record<string, unknown>, w: number, h: number): CropBounds {
  const unit = String(params.unit ?? 'normalized');
  const rawX = Number(params.x ?? 0);
  const rawY = Number(params.y ?? 0);
  const rawW = Number(params.width ?? (unit === 'pixels' ? w : 1));
  const rawH = Number(params.height ?? (unit === 'pixels' ? h : 1));
  const sx = unit === 'percent' ? 100 : unit === 'normalized' ? 1 : 0;
  const px = unit === 'pixels';
  const x = px ? rawX : (rawX / (sx || 1)) * w;
  const y = px ? rawY : (rawY / (sx || 1)) * h;
  const width = px ? rawW : (rawW / (sx || 1)) * w;
  const height = px ? rawH : (rawH / (sx || 1)) * h;
  const x0 = Math.max(0, Math.min(w - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.round(y)));
  return {
    x: x0,
    y: y0,
    width: Math.max(1, Math.min(w - x0, Math.round(width))),
    height: Math.max(1, Math.min(h - y0, Math.round(height))),
  };
}

function cropItem(item: GraphMediaItem, params: Record<string, unknown>): GraphMediaItem {
  const b = cropBounds(params, item.sourceWidth, item.sourceHeight);
  const source = cropImage(item.source, b.x, b.y, b.width, b.height);
  const masks: Record<string, MaskData> = {};
  for (const [id, mask] of Object.entries(item.masks)) {
    masks[id] = cropMaskNormalized(
      mask,
      b.x / item.sourceWidth,
      b.y / item.sourceHeight,
      (b.x + b.width) / item.sourceWidth,
      (b.y + b.height) / item.sourceHeight,
    );
  }
  return {
    ...item,
    source,
    sourceWidth: b.width,
    sourceHeight: b.height,
    masks,
    underlay: item.underlay ? cropImage(item.underlay, b.x, b.y, b.width, b.height) : undefined,
    overlay: item.overlay ? cropImage(item.overlay, b.x, b.y, b.width, b.height) : undefined,
  };
}

function resizeItem(item: GraphMediaItem, params: Record<string, unknown>): GraphMediaItem {
  const sw = item.sourceWidth;
  const sh = item.sourceHeight;
  const unit = String(params.unit ?? 'pixels');
  let tw = Number(params.width ?? 0);
  let th = Number(params.height ?? 0);
  if (unit === 'percent') {
    tw = (tw / 100) * sw;
    th = (th / 100) * sh;
  } else if (unit === 'times') {
    const factor = Math.max(0.01, Number(params.factor ?? params.width ?? 2));
    tw = sw * factor;
    th = sh * factor;
  }
  tw = Math.round(tw);
  th = Math.round(th);
  if (tw <= 0 && th <= 0) return item;
  if (tw <= 0) tw = Math.round((sw / sh) * th);
  if (th <= 0) th = Math.round((sh / sw) * tw);
  if (tw < 1 || th < 1) return item;

  const mode = String(params.mode ?? 'fit');
  const filterRaw = String(params.filter ?? 'nearest');
  const filter: ResizeFilter =
    filterRaw === 'nearest' || filterRaw === 'bilinear' || filterRaw === 'box' || filterRaw === 'bicubic'
      ? filterRaw
      : 'lanczos3';
  const allowUpscale = Number(params.allowUpscale ?? 1) > 0.5;

  let rw = tw;
  let rh = th;
  if (mode === 'fit' || mode === 'fill') {
    let scale = mode === 'fit' ? Math.min(tw / sw, th / sh) : Math.max(tw / sw, th / sh);
    if (!allowUpscale) scale = Math.min(1, scale);
    rw = Math.max(1, Math.round(sw * scale));
    rh = Math.max(1, Math.round(sh * scale));
  } else if (!allowUpscale) {
    rw = Math.min(tw, sw);
    rh = Math.min(th, sh);
  }

  let source = resizeImage(item.source, rw, rh, filter);
  const masks: Record<string, MaskData> = {};
  for (const [id, mask] of Object.entries(item.masks)) {
    masks[id] = resizeMask(mask, rw, rh);
  }

  let finalW = rw;
  let finalH = rh;
  let ox = 0;
  let oy = 0;
  if (mode === 'fill') {
    finalW = Math.min(tw, rw);
    finalH = Math.min(th, rh);
    ox = Math.max(0, Math.round((rw - finalW) / 2));
    oy = Math.max(0, Math.round((rh - finalH) / 2));
    source = cropImage(source, ox, oy, finalW, finalH);
    for (const [id, mask] of Object.entries(masks)) {
      masks[id] = cropMaskNormalized(
        mask,
        ox / rw,
        oy / rh,
        (ox + finalW) / rw,
        (oy + finalH) / rh,
      );
    }
  }

  return {
    ...item,
    source,
    sourceWidth: finalW,
    sourceHeight: finalH,
    masks,
    underlay: item.underlay
      ? cropImage(resizeImage(item.underlay, rw, rh, filter), ox, oy, finalW, finalH)
      : undefined,
    overlay: item.overlay
      ? cropImage(resizeImage(item.overlay, rw, rh, filter), ox, oy, finalW, finalH)
      : undefined,
  };
}

function hashParams(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Wrap an image produced by a generator node (background, 3D object). */
function makeGeneratedItem(node: GraphNode, image: PixelImage, name: string): GraphMediaItem {
  const s = defaultSettings();
  const version = hashParams(node.params);
  const assetId = `generated:${node.id}:${version}`;
  return {
    key: `${node.id}:${version}`,
    name,
    assetId,
    kind: 'image',
    source: image,
    sourceWidth: image.width,
    sourceHeight: image.height,
    masks: {},
    alphaCutMaskIds: [],
    alphaCutKeys: [],
    layers: [],
    preprocessOps: [],
    latePreprocessOps: [],
    postprocess: { ops: [], lockPalette: false },
    resolution: deepClone(s.resolution),
    pixelate: deepClone(s.pixelate),
    pixelateEnabled: false,
    paletteEnabled: false,
    ditherEnabled: false,
    palette: deepClone(s.palette),
    dither: deepClone(s.dither),
    output: deepClone(s.output),
    video: deepClone(s.video),
    extraction: deepClone(s.extraction),
    stage: 'source',
  };
}

function makeItem(node: GraphNode, asset: GraphAsset): GraphMediaItem {
  const s = defaultSettings();
  return {
    key: `${node.id}:${asset.id}`,
    name: asset.name,
    assetId: asset.id,
    kind: asset.kind,
    source: asset.image,
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    masks: {},
    alphaCutMaskIds: [],
    alphaCutKeys: [],
    layers: [],
    preprocessOps: [],
    latePreprocessOps: [],
    postprocess: { ops: [], lockPalette: false },
    resolution: deepClone(s.resolution),
    pixelate: deepClone(s.pixelate),
    pixelateEnabled: false,
    paletteEnabled: false,
    ditherEnabled: false,
    palette: deepClone(s.palette),
    dither: deepClone(s.dither),
    output: deepClone(s.output),
    video: deepClone(s.video),
    extraction: deepClone(s.extraction),
    stage: 'source',
  };
}

function toOps(value: unknown): PreprocessOp[] {
  return Array.isArray(value) ? (value as PreprocessOp[]) : [];
}

/* -------------------------------------------------------------------------- */
/* Preview helpers                                                            */
/* -------------------------------------------------------------------------- */

export function settingsFromItem(item: GraphMediaItem): PixelArtifySettings {
  const pixelate = deepClone(item.pixelate);
  pixelate.enabled = item.pixelateEnabled;

  // Never apply the default look (tone, palette auto-extraction or dithering)
  // unless the corresponding node is actually present in the branch. A bare
  // Media input → Output graph is a true pass-through.
  if (!item.pixelateEnabled) {
    pixelate.contrast = 1;
    pixelate.brightness = 0;
    pixelate.saturation = 1;
    pixelate.gamma = 1;
    pixelate.hueShift = 0;
    pixelate.preBlur = 0;
    pixelate.postSharpen = 0;
    pixelate.alphaThreshold = 0;
  }

  const palette = deepClone(item.palette);
  if (!item.paletteEnabled) palette.mode = 'none';

  const dither = deepClone(item.dither);
  if (!item.ditherEnabled) dither.algorithm = 'none';

  return {
    resolution: item.pixelateEnabled
      ? deepClone(item.resolution)
      : {
          ...deepClone(item.resolution),
          mode: 'native',
          exportScale: 1,
          snapEven: false,
        },
    preprocess: { ops: [...item.preprocessOps, ...item.latePreprocessOps] },
    postprocess: deepClone(item.postprocess),
    pixelate,
    extraction: deepClone(item.extraction),
    layers: item.pixelateEnabled ? deepClone(item.layers) : [],
    palette,
    dither,
    output: deepClone(item.output),
    video: deepClone(item.video),
  };
}

export function stopStageForNode(type: GraphNodeType): 'source' | 'preprocess' | 'pixelate' | 'dither' | 'post' {
  switch (type) {
    case 'input':
    case 'background':
    case 'object3d':
      return 'source';
    case 'preprocess':
    case 'color':
      return 'preprocess';
    case 'pixelate':
      return 'pixelate';
    case 'palette':
    case 'dither':
      return 'dither';
    case 'extract':
    case 'compose':
    case 'merge':
    case 'router':
      return 'pixelate';
    case 'postprocess':
    case 'output':
    default:
      return 'post';
  }
}

export interface DeletePreserveResult {
  graph: PipelineGraph;
  bridged: number;
  routerAdded: boolean;
}

/**
 * Delete a node without breaking the tree. Incoming and outgoing connections
 * are bridged by socket type. If a type has several upstream sources (for
 * example a Merge or Compose node), a Router is inserted and every source is
 * forwarded through it, preserving branches.
 */
export function deleteNodePreservingGraph(
  graph: PipelineGraph,
  nodeId: string,
): DeletePreserveResult {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return { graph, bridged: 0, routerAdded: false };

  const incoming = graph.edges.filter((e) => e.toNode === nodeId);
  const outgoing = graph.edges.filter((e) => e.fromNode === nodeId);
  const nodes = graph.nodes.filter((n) => n.id !== nodeId);
  const edges = graph.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId);

  if (incoming.length === 0 || outgoing.length === 0) {
    return { graph: { ...graph, nodes, edges }, bridged: 0, routerAdded: false };
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const typeOf = (edge: GraphEdge, sourceNode: GraphNode | undefined): string | undefined => {
    if (!sourceNode) return undefined;
    return NODE_DEFS[sourceNode.type].outputs.find((p) => p.id === edge.fromPort)?.type;
  };

  const incomingByType = new Map<string, GraphEdge[]>();
  for (const edge of incoming) {
    const type = typeOf(edge, byId.get(edge.fromNode));
    if (!type) continue;
    const list = incomingByType.get(type) ?? [];
    list.push(edge);
    incomingByType.set(type, list);
  }

  const outgoingByType = new Map<string, GraphEdge[]>();
  for (const edge of outgoing) {
    const type = typeOf(edge, node);
    if (!type) continue;
    const list = outgoingByType.get(type) ?? [];
    list.push(edge);
    outgoingByType.set(type, list);
  }

  let router: GraphNode | null = null;
  let bridged = 0;
  const add = (fromNode: string, fromPort: string, toNode: string, toPort: string): void => {
    if (edges.some((e) => e.toNode === toNode && e.toPort === toPort && e.fromNode === fromNode && e.fromPort === fromPort)) {
      return;
    }
    edges.push({
      id: `edge-${Math.random().toString(36).slice(2, 9)}`,
      fromNode,
      fromPort,
      toNode,
      toPort,
    });
    bridged++;
  };

  for (const [type, ins] of incomingByType) {
    const outs = outgoingByType.get(type) ?? [];
    if (outs.length === 0) continue;
    if (ins.length === 1) {
      // A single upstream can fan out directly, preserving all branches.
      for (const out of outs) add(ins[0].fromNode, ins[0].fromPort, out.toNode, out.toPort);
    } else {
      if (!router) {
        router = createNode('router', node.x + 24, node.y + 24);
      }
      for (const input of ins) add(input.fromNode, input.fromPort, router.id, type);
      for (const out of outs) add(router.id, type, out.toNode, out.toPort);
    }
  }

  const nextNodes = router ? [...nodes, router] : nodes;
  return {
    graph: { ...graph, nodes: nextNodes, edges },
    bridged,
    routerAdded: Boolean(router),
  };
}

export function outputNodes(graph: PipelineGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.type === 'output');
}

export function mediaIntoOutput(graph: PipelineGraph, evaluation: GraphEvaluation, outputId: string): GraphMediaItem[] {
  void graph;
  return mediaAtPort(evaluation, outputId, 'media');
}

export function countNodes(graph: PipelineGraph, type: GraphNodeType): number {
  return graph.nodes.filter((n) => n.type === type).length;
}

export function graphToPresetGraph(graph: PipelineGraph): PipelineGraph {
  return deepClone(graph);
}

export type { PostprocessOp };
