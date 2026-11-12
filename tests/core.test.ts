import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PALETTES,
  BUILTIN_PRESETS,
  DEFAULT_DITHER,
  DEFAULT_EXTRACTION,
  DEFAULT_PALETTE,
  DEFAULT_PIXELATE,
  applyChannels,
  applyDither,
  computeArtSize,
  computeWorkingSize,
  createImage,
  createPaletteMatcher,
  defaultSettings,
  extractPalette,
  generateHarmony,
  parsePalette,
  parsePreset,
  renderPixelArt,
  serializePalette,
  serializePreset,
  settingsFromGraph,
  threeLayerStack,
  upscaleNearest,
} from '../src/core';
import { createDefaultGraph, createNode, evaluateGraph, mediaAtPort } from '../src/core/graph';
import type { GraphAsset, GraphNode, PipelineGraph } from '../src/core';

function gradient(w: number, h: number, alpha = 255): ReturnType<typeof createImage> {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = (x / Math.max(1, w - 1)) * 255;
      img.data[i + 1] = (y / Math.max(1, h - 1)) * 255;
      img.data[i + 2] = ((x + y) % 64) * 4;
      img.data[i + 3] = alpha;
    }
  }
  return img;
}

function checker(w: number, h: number): ReturnType<typeof createImage> {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      img.data[i] = on ? 230 : 20;
      img.data[i + 1] = on ? 40 : 30;
      img.data[i + 2] = on ? 60 : 200;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function pixel(img: ReturnType<typeof createImage>, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe('resolution independence', () => {
  it('computes identical art size for 480p and 1080p 16:9 sources', () => {
    const settings = defaultSettings();
    settings.resolution = { mode: 'fixed-height', value: 270, exportScale: 4, snapEven: false, minSide: 16, maxSide: 2048 };
    const a = computeArtSize(854, 480, settings.resolution);
    const b = computeArtSize(1920, 1080, settings.resolution);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.width).toBe(480);
    expect(a.height).toBe(270);
  });

  it('derives a canonical working resolution from art size', () => {
    const a = computeWorkingSize(480, 270);
    const b = computeWorkingSize(480, 270);
    expect(a).toEqual(b);
    expect(a.width).toBeGreaterThan(480);
  });

  it('supports block-size and short-side modes', () => {
    const base = { exportScale: 1, snapEven: false, minSide: 8, maxSide: 4096 };
    expect(computeArtSize(1000, 500, { ...base, mode: 'block-size', value: 10 })).toMatchObject({
      width: 100,
      height: 50,
    });
    expect(computeArtSize(1000, 500, { ...base, mode: 'short-side', value: 100 })).toMatchObject({
      width: 200,
      height: 100,
    });
  });

  it('snaps even dimensions for video', () => {
    const size = computeArtSize(853, 480, {
      mode: 'fixed-height',
      value: 271,
      exportScale: 1,
      snapEven: true,
      minSide: 16,
      maxSide: 2048,
    });
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});

describe('colour', () => {
  it('generates the requested number of harmony colours', () => {
    for (const rule of ['monochromatic', 'analogous', 'complementary', 'triadic', 'tetradic', 'compound'] as const) {
      const colors = generateHarmony({ base: '#3a86ff', rule, count: 5, saturation: 1, lightness: 1, spread: 1 });
      expect(colors).toHaveLength(5);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('palette', () => {
  it('extracts a deterministic palette', () => {
    const img = gradient(160, 90);
    const a = extractPalette(img, 12, 'kmeans');
    const b = extractPalette(img, 12, 'kmeans');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(2);
    expect(a.length).toBeLessThanOrEqual(12);
    expect(new Set(a).size).toBe(a.length);
  });

  it('round-trips GPL, JASC, Paint.NET, hex and JSON', () => {
    const colors = ['#112233', '#aabbcc', '#ff0000'];
    for (const format of ['gpl', 'jasc', 'paintnet', 'hex', 'json'] as const) {
      const text = serializePalette(colors, format, 'Test');
      expect(parsePalette(text)).toEqual(colors);
    }
  });

  it('parses built-in palettes', () => {
    for (const p of BUILTIN_PALETTES) {
      expect(p.colors.length).toBeGreaterThan(0);
      for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('matches colours in OKLab and caches results', () => {
    const m = createPaletteMatcher(['#000000', '#ffffff']);
    expect(m.match(10, 10, 10)).toBe(0);
    expect(m.match(240, 240, 240)).toBe(1);
    expect(m.match(10, 10, 10)).toBe(0);
  });
});

describe('dithering', () => {
  const palette = ['#000000', '#ffffff'];

  it('only emits palette colours and preserves alpha', () => {
    const img = gradient(96, 64, 180);
    for (const algorithm of ['floyd-steinberg', 'atkinson', 'bayer-8', 'blue-noise', 'riemersma', 'yliluoma', 'sierra-lite']) {
      const out = applyDither(img, palette, { ...DEFAULT_DITHER, algorithm });
      expect(out.width).toBe(img.width);
      for (let i = 0; i < out.data.length; i += 4) {
        expect(out.data[i + 3]).toBe(180);
        const c = `${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`;
        expect(['0,0,0', '255,255,255']).toContain(c);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const img = gradient(64, 48);
    const a = applyDither(img, palette, { ...DEFAULT_DITHER, algorithm: 'blue-noise', seed: 42 });
    const b = applyDither(img, palette, { ...DEFAULT_DITHER, algorithm: 'blue-noise', seed: 42 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe('resampling correctness', () => {
  it('keeps a solid colour intact through gaussian blur and unsharp mask', async () => {
    const { gaussianBlurRGBA, unsharpMask } = await import('../src/core/image');
    const img = createImage(32, 32);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 200;
      img.data[i + 1] = 80;
      img.data[i + 2] = 40;
      img.data[i + 3] = 255;
    }
    const blurred = gaussianBlurRGBA(img, 3);
    const sharpened = unsharpMask(img, 2, 0.8);
    const center = (im: typeof img) => {
      const i = (16 * 32 + 16) * 4;
      return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
    };
    expect(center(blurred)).toEqual([200, 80, 40, 255]);
    expect(center(sharpened)).toEqual([200, 80, 40, 255]);
  });

  it('pixelates to the local average colour', async () => {
    const { pixelateImage } = await import('../src/core/pixelate');
    const img = createImage(32, 32);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 120;
      img.data[i + 1] = 60;
      img.data[i + 2] = 30;
      img.data[i + 3] = 255;
    }
    const out = pixelateImage(img, {
      artWidth: 8,
      artHeight: 8,
      settings: { ...DEFAULT_PIXELATE, postSharpen: 0, colorBlend: 0, edgeAware: false },
    });
    const p = pixel(out.image, 4, 4);
    expect(p[0]).toBeGreaterThan(114);
    expect(p[1]).toBeGreaterThan(54);
    expect(p[2]).toBeGreaterThan(24);
    expect(p[3]).toBe(255);
  });
});

describe('render pipeline', () => {
  it('renders at the target art size and upscales', () => {
    const settings = defaultSettings();
    settings.resolution = { ...settings.resolution, value: 64, exportScale: 2 };
    settings.palette = { ...DEFAULT_PALETTE, mode: 'auto', autoCount: 12 };
    settings.dither = { ...DEFAULT_DITHER, algorithm: 'bayer-4' };
    const result = renderPixelArt({ image: gradient(320, 180), settings });
    expect(result.size.height).toBe(64);
    expect(result.art.width).toBe(result.size.exportWidth);
    expect(result.art.height).toBe(result.size.exportHeight);
    expect(result.artAtPixelScale.width).toBe(result.size.width);
    expect(result.palette.length).toBeGreaterThan(2);
    // Regression: a blurred/unsharp pipeline must not collapse the image to white.
    let coloured = 0;
    for (let i = 0; i < result.artAtPixelScale.data.length; i += 4) {
      const r = result.artAtPixelScale.data[i];
      const g = result.artAtPixelScale.data[i + 1];
      const b = result.artAtPixelScale.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) coloured++;
    }
    expect(coloured).toBeGreaterThan(20);
  });

  it('preserves source alpha through preprocess and pixelation', () => {
    const settings = defaultSettings();
    settings.resolution = { ...settings.resolution, value: 40, exportScale: 1 };
    settings.palette = { ...DEFAULT_PALETTE, mode: 'custom', colors: ['#000000', '#ffffff'] };
    const img = gradient(80, 80, 0);
    // Opaque circle in the middle.
    for (let y = 20; y < 60; y++) {
      for (let x = 20; x < 60; x++) {
        img.data[(y * 80 + x) * 4 + 3] = 255;
      }
    }
    const result = renderPixelArt({ image: img, settings });
    expect(pixel(result.artAtPixelScale, 0, 0)[3]).toBe(0);
    expect(pixel(result.artAtPixelScale, 20, 20)[3]).toBeGreaterThan(200);
  });

  it('inpaints the background behind a masked foreground layer', () => {
    const img = createImage(160, 90);
    for (let y = 0; y < 90; y++) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        const center = x >= 55 && x < 105 && y >= 20 && y < 70;
        if (center) {
          img.data[i] = 255;
          img.data[i + 1] = 0;
          img.data[i + 2] = 0;
        } else {
          img.data[i] = x < 80 ? 20 : 180;
          img.data[i + 1] = x < 80 ? 60 : 200;
          img.data[i + 2] = x < 80 ? 220 : 40;
        }
        img.data[i + 3] = 255;
      }
    }
    const mask = { width: 160, height: 90, data: new Uint8Array(160 * 90) };
    for (let y = 0; y < 90; y++) {
      for (let x = 0; x < 160; x++) {
        mask.data[y * 160 + x] = x >= 55 && x < 105 && y >= 20 && y < 70 ? 255 : 0;
      }
    }

    const settings = defaultSettings();
    settings.resolution = { ...settings.resolution, value: 90, exportScale: 1 };
    settings.extraction = { ...DEFAULT_EXTRACTION, enabled: true };
    settings.layers = threeLayerStack().filter((l) => l.role !== 'detail');
    settings.layers = settings.layers.map((l) =>
      l.role === 'background'
        ? { ...l, inpaintOcclusion: true, inpaint: { method: 'diffusion', texture: 0, iterations: 40, radius: 1 } }
        : { ...l, maskId: 'subject' },
    );
    settings.palette = { ...DEFAULT_PALETTE, mode: 'none' };
    settings.dither = { ...DEFAULT_DITHER, algorithm: 'none' };

    const result = renderPixelArt({ image: img, masks: { subject: mask }, settings });
    const bg = result.layers.find((l) => l.role === 'background');
    expect(bg).toBeTruthy();
    const c = pixel(bg!.image, Math.floor(bg!.image.width * 0.5), Math.floor(bg!.image.height * 0.45));
    // The inpainted background must no longer be the red subject colour.
    expect(Math.abs(c[0] - 255) + Math.abs(c[1]) + Math.abs(c[2])).toBeGreaterThan(40);
  });
});

describe('nodes and graph', () => {
  const asset: GraphAsset = {
    id: 'a',
    name: 'test.png',
    kind: 'image',
    image: gradient(100, 50, 128),
    width: 100,
    height: 50,
  };

  it('evaluates the default graph end to end', () => {
    const graph = createDefaultGraph();
    const input = graph.nodes.find((n) => n.type === 'input')!;
    const output = graph.nodes.find((n) => n.type === 'output')!;
    const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [asset] } });
    expect(evaluation.errors).toEqual([]);
    const items = mediaAtPort(evaluation, output.id);
    expect(items).toHaveLength(1);
    expect(items[0].sourceWidth).toBe(100);
  });

  it('merges multiple inputs into one batch', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('input', 0, 0);
    const b = createNode('input', 0, 200);
    const merge = createNode('merge', 200, 100);
    const out = createNode('output', 400, 100);
    graph.nodes.push(a, b, merge, out);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
      { id: 'e3', fromNode: merge.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
    );
    const evaluation = evaluateGraph(graph, {
      assetsByNode: { [a.id]: [asset], [b.id]: [{ ...asset, id: 'b' }] },
    });
    expect(mediaAtPort(evaluation, out.id)).toHaveLength(2);
  });

  it('detects graph cycles', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('preprocess', 0, 0);
    const b = createNode('preprocess', 100, 0);
    graph.nodes.push(a, b);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: b.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: a.id, toPort: 'media' },
    );
    const evaluation = evaluateGraph(graph, { assetsByNode: {} });
    expect(evaluation.errors.some((e) => /cycle/i.test(e.message))).toBe(true);
  });

  it('crops and resizes while retaining alpha', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const input = createNode('input', 0, 0);
    const resize = createNode('resize', 100, 0, {
      width: 200,
      height: 100,
      unit: 'pixels',
      mode: 'stretch',
      filter: 'nearest',
      allowUpscale: 1,
    });
    const crop = createNode('crop', 200, 0, { x: 0.25, y: 0.25, width: 0.5, height: 0.5, unit: 'normalized' });
    const out = createNode('output', 300, 0);
    graph.nodes.push(input, resize, crop, out);
    graph.edges.push(
      { id: 'e1', fromNode: input.id, fromPort: 'media', toNode: resize.id, toPort: 'media' },
      { id: 'e2', fromNode: resize.id, fromPort: 'media', toNode: crop.id, toPort: 'media' },
      { id: 'e3', fromNode: crop.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
    );
    const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [asset] } });
    const item = mediaAtPort(evaluation, out.id)[0];
    expect(item.sourceWidth).toBe(100);
    expect(item.sourceHeight).toBe(50);
    expect(item.source.data[3]).toBe(128);
  });

  it('routes colour into channels and retains alpha', () => {
    const out = applyChannels(gradient(16, 16, 128), {
      operation: 'extract',
      channel: 'r',
      swap: 'bgr',
      pack: { r: 'r', g: 'g', b: 'b', a: 'a' },
      keepAlpha: true,
      invert: false,
    });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i]).toBe(out.data[i + 2]);
      expect(out.data[i + 3]).toBe(128);
    }
  });
});

describe('presets', () => {
  it('round-trips a built-in preset through JSON', () => {
    const preset = BUILTIN_PRESETS[0];
    const parsed = parsePreset(serializePreset(preset));
    expect(parsed.graph.nodes.length).toBe(preset.graph.nodes.length);
    const settings = settingsFromGraph(parsed.graph);
    expect(settings.resolution.value).toBe(270);
  });

  it('keeps every built-in preset valid', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.graph.nodes.some((n: GraphNode) => n.type === 'output')).toBe(true);
      expect(settingsFromGraph(preset.graph).pixelate.edgeAware).toBe(true);
    }
  });
});

describe('upscale', () => {
  it('repeats pixels with nearest-neighbour', () => {
    const img = createImage(2, 1);
    img.data.set([10, 20, 30, 255, 40, 50, 60, 128]);
    const up = upscaleNearest(img, 3);
    expect(up.width).toBe(6);
    expect(pixel(up, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(up, 2, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(up, 3, 0)).toEqual([40, 50, 60, 128]);
  });
});

describe('sanity', () => {
  it('checker image renders', () => {
    const settings = defaultSettings();
    settings.resolution = { ...settings.resolution, value: 32, exportScale: 1 };
    settings.palette = { ...DEFAULT_PALETTE, mode: 'auto', autoCount: 8 };
    settings.dither = { ...DEFAULT_DITHER, algorithm: 'floyd-steinberg' };
    settings.pixelate = { ...DEFAULT_PIXELATE };
    const result = renderPixelArt({ image: checker(128, 64), settings });
    expect(result.artAtPixelScale.width).toBe(64);
    expect(result.artAtPixelScale.height).toBe(32);
  });
});
