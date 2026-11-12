import type { GraphNode, PipelineGraph } from '../core/types';
import { DITHER_BY_ID } from '../core/dither';
import { gpuAvailable } from './gpuPixelate';
import { gpuDitherAvailable, supportsGpuDither } from './gpuFinish';

export interface CpuWarning {
  /** Short label used in badges. */
  title: string;
  /** Human-readable reason and suggestion. */
  detail: string;
}

const HEAVY_PREPROCESS = new Set(['painterly', 'oil', 'watercolor', 'displace', 'bloom']);
const HEAVY_POSTPROCESS = new Set(['bloom', 'crt']);

const EFFECT_LABELS: Record<string, string> = {
  painterly: 'Painterly (Kuwahara)',
  oil: 'Oil paint',
  watercolor: 'Watercolour',
  displace: 'Noise displacement',
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
      const filter = String(node.params.filter ?? 'lanczos3');
      if (filter === 'lanczos3' || filter === 'bicubic') {
        return {
          title: 'CPU resize',
          detail: `${filter === 'lanczos3' ? 'Lanczos3' : 'Bicubic'} resampling runs on the CPU. Box or bilinear is much cheaper for large sources.`,
        };
      }
      return null;
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
        ? (node.params.layers as Array<{ visible?: boolean; inpaintOcclusion?: boolean }>)
        : [];
      const visible = layers.filter((layer) => layer.visible !== false);
      if (visible.length === 0) return null;
      const inpainting = visible.some((layer) => layer.inpaintOcclusion);
      return {
        title: inpainting ? 'CPU inpainting' : 'CPU layers',
        detail: inpainting
          ? 'Layer compositing and background inpainting run on the CPU. Inpainting is especially expensive during playback.'
          : 'Layer compositing runs on the CPU. More visible layers and larger working resolutions increase the cost.',
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
        } on the CPU at the art resolution. Bloom/CRT are the most expensive post effects.`,
      };
    }

    default:
      return null;
  }
}
