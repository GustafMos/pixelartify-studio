import type { GraphNode, PipelineGraph } from '../core/types';
import { DITHER_BY_ID } from '../core/dither';
import { gpuAvailable } from './gpuPixelate';
import { gpuDitherAvailable, supportsGpuDither } from './gpuFinish';
import { gpuResizeAvailable } from './gpuResize';
import { gpuEffectsAvailable, supportsGpuEffects } from './gpuEffects';
import { gpuLayersAvailable } from './gpuLayers';

export interface CpuWarning {
  /** Short label used in badges. */
  title: string;
  /** Human-readable reason and suggestion. */
  detail: string;
}

const HEAVY_PREPROCESS = new Set([
  'painterly',
  'oil',
  'watercolor',
  'displace',
  'soften',
  'sharpen',
  'bloom',
  'pixelBlur',
]);
const HEAVY_POSTPROCESS = new Set(['bloom', 'crt', 'sharpen']);

const EFFECT_LABELS: Record<string, string> = {
  painterly: 'Painterly (Kuwahara)',
  oil: 'Oil paint',
  watercolor: 'Watercolour',
  displace: 'Noise displacement',
  soften: 'Soften',
  sharpen: 'Sharpen',
  pixelBlur: 'Chunky blur',
  bloom: 'Bloom',
  crt: 'CRT',
};

function enabledOps(value: unknown): Array<{ type?: string; enabled?: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.filter((op) => op && typeof op === 'object' && op.enabled !== false);
}

function opNames(ops: Array<{ type?: string }>): string {
  return ops
    .map((op) => (op.type ? EFFECT_LABELS[op.type] ?? op.type : 'effect'))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ');
}

/**
 * True when a node contains work that currently runs on the CPU and is likely
 * to dominate preview/playback time. This is intentionally conservative: cheap
 * per-pixel nodes (crop, channels, tone) are not flagged.
 */
export function nodeCpuWarning(node: GraphNode, graph: PipelineGraph): CpuWarning | null {
  if (node.bypassed) return null;
  switch (node.type) {
    case 'pixelate': {
      if (!gpuAvailable()) {
        return {
          title: 'CPU pixelation',
          detail:
            'WebGL2 is unavailable, so the edge-aware sampler runs on the CPU. That is the main cost at high art sizes.',
        };
      }
      return null;
    }

    case 'dither': {
      const dither = (node.params.dither as { algorithm?: string } | undefined) ?? {};
      const algorithm = dither.algorithm ?? 'none';
      if (algorithm === 'none') return null;
      const def = DITHER_BY_ID[algorithm];
      const gpu = gpuDitherAvailable() && supportsGpuDither(algorithm);
      if (gpu) return null;
      if (def?.category === 'diffusion') {
        return {
          title: 'CPU dither',
          detail: `${def.name} is an error-diffusion algorithm and is inherently sequential, so it runs on the CPU. Use a Bayer, blue-noise or other ordered dither for GPU playback.`,
        };
      }
      if (def?.category === 'palette') {
        return {
          title: 'CPU dither',
          detail: `${def.name} performs an ordered palette search on the CPU. Try an ordered dither for faster playback.`,
        };
      }
      return {
        title: 'CPU dither',
        detail: 'WebGL2 dithering is unavailable, so palette matching and dithering run on the CPU.',
      };
    }

    case 'palette': {
      const palette = (node.params.palette as { mode?: string; quantizer?: string } | undefined) ?? {};
      const ditherNode = graph.nodes.find((n) => n.type === 'dither');
      const algorithm =
        ((ditherNode?.params.dither as { algorithm?: string } | undefined)?.algorithm) ?? 'none';
      const auto = palette.mode === 'auto' || (palette.mode === 'none' && algorithm !== 'none');
      if (!auto) return null;
      return {
        title: 'CPU palette',
        detail:
          palette.quantizer === 'median-cut'
            ? 'Automatic palette extraction (median cut) runs on the CPU whenever the palette is resolved.'
            : 'Automatic palette extraction (OKLab k-means) runs on the CPU whenever the palette is resolved. A custom/library palette is cheaper for playback and parameter tweaks.',
      };
    }

    case 'resize': {
      const filter = String(node.params.filter ?? 'nearest');
      if ((filter === 'nearest' || filter === 'bilinear') && gpuResizeAvailable()) return null;
      if (filter === 'nearest' || filter === 'bilinear') {
        return {
          title: 'CPU resize',
          detail: 'WebGL2 is unavailable, so this resize runs on the CPU.',
        };
      }
      return {
        title: 'CPU resize',
        detail: `${filter === 'lanczos3' ? 'Lanczos3' : filter === 'bicubic' ? 'Bicubic' : 'Box'} resampling runs on the CPU. Nearest-neighbour uses the GPU resize path and is much cheaper.`,
      };
    }

    case 'preprocess': {
      const ops = enabledOps(node.params.ops);
      const heavy = ops.filter((op) => op.type && HEAVY_PREPROCESS.has(op.type));
      if (heavy.length === 0) return null;
      return {
        title: 'CPU effects',
        detail: `${opNames(heavy)} run${
          heavy.length === 1 ? 's' : ''
        } on the CPU at the working resolution. This is usually the biggest preview bottleneck — lower the art size or remove the effect for smoother playback.`,
      };
    }

    case 'compose': {
      const layers = Array.isArray(node.params.layers)
        ? (node.params.layers as Array<{
            visible?: boolean;
            inpaintOcclusion?: boolean;
            role?: string;
            detailStrength?: number;
          }>)
        : [];
      const visible = layers.filter((layer) => layer.visible !== false);
      if (visible.length === 0) return null;
      // The final alpha/blend/offset/scale composite runs on the GPU. Only the
      // stages before it are CPU-bound: inpainting fills occluded regions with
      // a diffusion pass, and detail layers build a Gaussian high-pass copy.
      const hasMasks = graph.nodes.some((n) => n.type === 'extract');
      const inpainting =
        hasMasks && visible.some((layer) => layer.inpaintOcclusion);
      const detail = visible.some((layer) => layer.role === 'detail');
      if (!gpuLayersAvailable()) {
        return {
          title: 'CPU layers',
          detail:
            'WebGL2 is unavailable, so layer blending runs on the CPU. Occlusion inpainting and detail high-pass also run on the CPU.',
        };
      }
      if (!inpainting && !detail) return null;
      const parts: string[] = [];
      if (inpainting) parts.push('inpainting');
      if (detail) parts.push('detail high-pass');
      const detailText = [
        inpainting
          ? 'Occlusion inpainting fills the masked regions with a diffusion pass on the CPU.'
          : '',
        detail
          ? 'Detail layers build a Gaussian high-pass copy on the CPU before they are pixelated.'
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        title: `CPU ${parts.join(' + ')}`,
        detail: `${detailText} The final layer blend is GPU-accelerated when WebGL2 is available.`,
      };
    }

    case 'postprocess': {
      const ops = enabledOps(node.params.ops);
      const heavy = ops.filter((op) => op.type && HEAVY_POSTPROCESS.has(op.type));
      if (heavy.length === 0) return null;
      return {
        title: 'CPU post effects',
        detail: `${opNames(heavy)} run${
          heavy.length === 1 ? 's' : ''
        } on the CPU at the art resolution. Bloom, CRT and final sharpen are the most expensive post effects.`,
      };
    }

    default:
      return null;
  }
}

export interface PresetCpuSummary {
  count: number;
  short: string;
  detail: string;
}

/** Aggregate CPU warnings for a preset graph, for preset-browser badges. */
export function presetCpuSummary(graph: PipelineGraph): PresetCpuSummary | null {
  const warnings: Array<{ node: GraphNode; warning: CpuWarning }> = [];
  for (const node of graph.nodes) {
    const warning = nodeCpuWarning(node, graph);
    if (warning) warnings.push({ node, warning });
  }
  if (warnings.length === 0) return null;
  const labels = warnings
    .map(({ warning }) => warning.title.replace(/^CPU\s+/i, ''))
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const nodes = warnings.map(({ node }) => node.title).filter((v, i, arr) => arr.indexOf(v) === i);
  return {
    count: warnings.length,
    short: labels.join(' · '),
    detail: `${nodes.join(', ')}: ${warnings.map(({ warning }) => warning.detail).join(' ')}`,
  };
}
