/**
 * PixelArtify Studio — shared type definitions.
 *
 * Every parameter that affects geometry is expressed in *art pixels* or as a
 * normalized unit, never in source pixels. This is what makes a 480p and a
 * 1080p source produce the same visual result when the same preset is used.
 */

export interface PixelImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8ClampedArray;
}

export interface MaskData {
  width: number;
  height: number;
  /** 8-bit coverage, 0 = transparent, 255 = selected. */
  data: Uint8Array;
}

export type ResolutionMode =
  | 'fixed-height'
  | 'fixed-width'
  | 'short-side'
  | 'block-size';

export interface ResolutionSettings {
  mode: ResolutionMode;
  /**
   * Art pixels for height/width/short-side modes, or source pixels per art
   * pixel for block-size mode.
   */
  value: number;
  /** Integer nearest-neighbour upscale applied at export/preview. */
  exportScale: number;
  /** Keep both output dimensions even (useful for video encoders). */
  snapEven: boolean;
  minSide: number;
  maxSide: number;
}

export type PreprocessType =
  | 'painterly'
  | 'oil'
  | 'watercolor'
  | 'posterize'
  | 'displace'
  | 'grain'
  | 'soften'
  | 'sharpen'
  | 'bloom'
  | 'pixelBlur';

export interface PreprocessOp {
  id: string;
  type: PreprocessType;
  enabled: boolean;
  /** Parameter values, names documented by the preprocess registry. */
  params: Record<string, number>;
  /** Optional colour for effects such as outline. */
  color?: string;
}

export interface PreprocessSettings {
  ops: PreprocessOp[];
}

export type PostprocessType =
  | 'outline'
  | 'bloom'
  | 'grain'
  | 'scanlines'
  | 'vignette'
  | 'chromatic'
  | 'crt'
  | 'sharpen';

export interface PostprocessOp {
  id: string;
  type: PostprocessType;
  enabled: boolean;
  params: Record<string, number>;
  color?: string;
}

export interface PostprocessSettings {
  ops: PostprocessOp[];
  /** Re-map colours to the chosen palette after post effects. */
  lockPalette: boolean;
}

export interface PixelateSettings {
  edgeAware: boolean;
  /** 0 = homogeneous cells, 1 = strongly snap sampling windows to edges. */
  alignment: number;
  /** 0 = soft average colour, 1 = crisp dominant colour. */
  colorBlend: number;
  /** Sobel sensitivity, 0..1. */
  edgeThreshold: number;
  /** Offset-field smoothing passes. */
  gridPasses: number;
  /** Pre-blur radius in art pixels. */
  preBlur: number;
  /** Sample sharpening after downscale, 0..1. */
  postSharpen: number;
  contrast: number;
  brightness: number;
  saturation: number;
  gamma: number;
  hueShift: number;
  /** Alpha below this value becomes fully transparent. */
  alphaThreshold: number;
}

export type PaletteMode = 'none' | 'auto' | 'custom';
export type Quantizer = 'median-cut' | 'kmeans';
export type PaletteColorSpace = 'oklab' | 'rgb';

export interface PaletteSettings {
  mode: PaletteMode;
  /** Embedded colours. Presets stay self-contained. */
  colors: string[];
  autoCount: number;
  quantizer: Quantizer;
  colorSpace: PaletteColorSpace;
  /** Blend between the true colour and its palette match, 0..1. */
  strength: number;
}

export type DitherColorSpace = 'srgb' | 'linear' | 'oklab';

export interface DitherSettings {
  /** Registry id, e.g. `floyd-steinberg`, `bayer-8`, `blue-noise`. */
  algorithm: string;
  strength: number;
  /** Pattern scale in art pixels. */
  scale: number;
  serpentine: boolean;
  colorSpace: DitherColorSpace;
  seed: number;
  /** Threshold bias for pattern/1-bit workflows, -1..1. */
  threshold: number;
}

export type ExtractionMethod = 'saliency' | 'chroma' | 'luma' | 'edge' | 'manual' | 'box';

export interface ExtractionSettings {
  enabled: boolean;
  method: ExtractionMethod;
  /** 0..1 selection threshold. */
  threshold: number;
  /** 0..1 edge softness of the resulting mask. */
  softness: number;
  /** 0..1 pull toward the image centre. */
  centerBias: number;
  keyColor: string;
  /** OKLab distance tolerance for chroma keying. */
  tolerance: number;
  lumaMin: number;
  lumaMax: number;
  invert: boolean;
  /** Feather radius in art pixels. */
  feather: number;
  /** Subject box, normalized 0..1. */
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  boxShape: 'ellipse' | 'rectangle';
}

export type LayerRole = 'background' | 'foreground' | 'detail' | 'overlay';
export type LayerBlend = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay';
export type InpaintMethod = 'directional' | 'diffusion' | 'pyramid' | 'dither';

export interface InpaintSettings {
  method: InpaintMethod;
  /** Texture regeneration amount for `dither`, 0..1. */
  texture: number;
  /** Number of relaxation iterations. */
  iterations: number;
  /** Diffusion radius in art pixels (controls coherence). */
  radius: number;
}

export interface LayerSettings {
  id: string;
  name: string;
  role: LayerRole;
  visible: boolean;
  opacity: number;
  /** Painter's order: higher is closer to the viewer. */
  z: number;
  blend: LayerBlend;
  /**
   * Mask used to cut this layer out. Null means "use the whole image".
   * Masks are not stored in presets; extraction settings recreate them.
   */
  maskId: string | null;
  /**
   * Optional, usually looser mask used only when inpainting the region this
   * layer occludes. Keeps the foreground cutout tight while removing legs or
   * shadows from the background.
   */
  occlusionMaskId: string | null;
  /** Offset in art pixels, useful for parallax layers. */
  offsetX: number;
  offsetY: number;
  /** Scale around the layer centre. */
  scale: number;
  /** Inpaint the regions occluded by layers above this one. */
  inpaintOcclusion: boolean;
  inpaint: InpaintSettings;
  /** For detail layers: high-pass strength, 0..1. */
  detailStrength: number;
}

export type OutputFormat = 'png' | 'webp';
export type VideoOutput = 'video' | 'spritesheet' | 'both';
export type VideoCodec = 'avc' | 'vp9' | 'av1';

export interface OutputSettings {
  format: OutputFormat;
  /** PNG quality for WebP, 0..1 (ignored for PNG). */
  quality: number;
  filenamePattern: string;
  transparent: boolean;
  /** Export each layer as its own image. */
  exportLayers: boolean;
  /** Include a JSON manifest next to exported images. */
  writeManifest: boolean;
}

export interface SpritesheetSettings {
  /** 0 = auto columns. */
  columns: number;
  padding: number;
  maxSize: number;
  powerOfTwo: boolean;
}

export interface VideoSettings {
  fps: number;
  start: number;
  /** Null means "to the end". */
  end: number | null;
  output: VideoOutput;
  codec: VideoCodec;
  bitrateMbps: number;
  spritesheet: SpritesheetSettings;
}

export interface PixelArtifySettings {
  resolution: ResolutionSettings;
  preprocess: PreprocessSettings;
  postprocess: PostprocessSettings;
  pixelate: PixelateSettings;
  extraction: ExtractionSettings;
  layers: LayerSettings[];
  palette: PaletteSettings;
  dither: DitherSettings;
  output: OutputSettings;
  video: VideoSettings;
}

export type GraphNodeType =
  | 'input'
  | 'crop'
  | 'resize'
  | 'channels'
  | 'preprocess'
  | 'pixelate'
  | 'palette'
  | 'dither'
  | 'extract'
  | 'compose'
  | 'postprocess'
  | 'merge'
  | 'router'
  | 'output';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  title: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
  bypassed?: boolean;
}

export interface GraphEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface PipelineGraph {
  id: string;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Preset {
  schema: 'pixelartify/preset';
  version: 1;
  id: string;
  name: string;
  description: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  /** The node graph is the source of truth for a preset. */
  graph: PipelineGraph;
  /** Optional simple-mode snapshot, useful for interop and older clients. */
  settings?: PixelArtifySettings;
  /** Optional tiny preview as a data URL. */
  thumbnail?: string;
  tags?: string[];
}

export interface PaletteDefinition {
  id: string;
  name: string;
  colors: string[];
  source: 'builtin' | 'custom' | 'image' | 'harmony' | 'imported';
  author?: string;
  description?: string;
}

export type HarmonyRule =
  | 'monochromatic'
  | 'analogous'
  | 'complementary'
  | 'split-complementary'
  | 'triadic'
  | 'tetradic'
  | 'square'
  | 'compound';

export interface HarmonyOptions {
  base: string;
  rule: HarmonyRule;
  count: number;
  saturation: number;
  lightness: number;
  spread: number;
}

export interface ArtSize {
  width: number;
  height: number;
  exportWidth: number;
  exportHeight: number;
  pixelScale: number;
}

export interface RenderLayer {
  id: string;
  name: string;
  role: LayerRole;
  /** Art-resolution layer before global palette/dithering. */
  image: PixelImage;
  z: number;
  opacity: number;
  blend: LayerBlend;
  visible: boolean;
}

export interface RenderStats {
  durationMs: number;
  edgeAware: boolean;
  sourceWidth: number;
  sourceHeight: number;
  workingWidth: number;
  workingHeight: number;
  paletteSource: 'none' | 'auto' | 'custom';
  layerCount: number;
}

export interface RenderResult {
  /** Final art, already quantized/dithered and upscaled by exportScale. */
  art: PixelImage;
  /** Art-resolution final before exportScale upscale. */
  artAtPixelScale: PixelImage;
  layers: RenderLayer[];
  palette: string[];
  size: ArtSize;
  stats: RenderStats;
}

export interface PipelineInput {
  image: PixelImage;
  masks?: Record<string, MaskData>;
  settings: PixelArtifySettings;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  codec: string | null;
  hasAudio: boolean;
}

export const SCHEMA_VERSION = 1 as const;
