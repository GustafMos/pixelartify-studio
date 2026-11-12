import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PALETTES,
  BUILTIN_PRESETS,
  DEFAULT_DITHER,
  DEFAULT_EXTRACTION,
  DEFAULT_PALETTE,
  DEFAULT_PIXELATE,
  applyChannels,
  applyColorCorrection,
  applyDither,
  buildMagicMask,
  computeArtSize,
  createPreprocessOp,
  DEFAULT_MOTION,
  evaluateExpression,
  evaluateMotion,
  computeWorkingSize,
  createImage,
  createPaletteMatcher,
  defaultSettings,
  extractPalette,
  generateHarmony,
  layoutPrintPages,
  packSpritesheet,
  packSpritesheets,
  parsePalette,
  renderPrintPage,
  parsePreset,
  PRIMITIVES_3D,
  renderBackground,
  renderObject3D,
  renderPixelArt,
  serializePalette,
  serializePreset,
  settingsFromGraph,
  settingsFromItem,
  threeLayerStack,
  trackMagicMaskFrame,
  upscaleNearest,
} from '../src/core';
import {
  connect,
  createDefaultGraph,
  createNode,
  applyItemAlphaCuts,
  applyTrackedAlphaCuts,
  deleteNodePreservingGraph,
  evaluateGraph,
  mediaAtPort,
} from '../src/core/graph';
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

  it('colour-corrects contrast while retaining alpha and dimensions', () => {
    const img = gradient(32, 24, 128);
    const flat = applyColorCorrection(img, {});
    expect(Array.from(flat.data)).toEqual(Array.from(img.data));

    const punchy = applyColorCorrection(img, { contrast: 1.5, saturation: 1.3 });
    expect(punchy.width).toBe(img.width);
    expect(punchy.height).toBe(img.height);
    for (let i = 3; i < punchy.data.length; i += 4) expect(punchy.data[i]).toBe(128);
    // Contrast must spread values away from mid-grey rather than collapse them.
    const spread = (data: Uint8ClampedArray): number => {
      let min = 255;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        min = Math.min(min, data[i]);
        max = Math.max(max, data[i]);
      }
      return max - min;
    };
    expect(spread(punchy.data)).toBeGreaterThanOrEqual(spread(img.data));
    expect(Array.from(punchy.data)).not.toEqual(Array.from(img.data));

    const grey = applyColorCorrection(img, { saturation: 0 });
    for (let i = 0; i < grey.data.length; i += 4) {
      expect(Math.abs(grey.data[i] - grey.data[i + 1])).toBeLessThanOrEqual(1);
      expect(Math.abs(grey.data[i + 1] - grey.data[i + 2])).toBeLessThanOrEqual(1);
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

  it('defaults resize to nearest and supports a times multiplier', () => {
    const input = createNode('input', 0, 0);
    const resize = createNode('resize', 200, 0);
    const out = createNode('output', 400, 0);
    expect(resize.params.filter).toBe('nearest');
    resize.params = {
      unit: 'times',
      factor: 2,
      mode: 'stretch',
      filter: 'nearest',
      allowUpscale: 1,
    };
    const graph: PipelineGraph = {
      id: 'g',
      name: 'g',
      description: '',
      nodes: [input, resize, out],
      edges: [
        { id: 'e1', fromNode: input.id, fromPort: 'media', toNode: resize.id, toPort: 'media' },
        { id: 'e2', fromNode: resize.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
      ],
    };
    const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [asset] } });
    const item = mediaAtPort(evaluation, out.id)[0];
    expect(item.source.width).toBe(asset.width * 2);
    expect(item.source.height).toBe(asset.height * 2);
  });

  it('isolates the extracted subject when onlyExtracted is enabled', () => {
    const input = createNode('input', 0, 0);
    const extract = createNode('extract', 200, 0);
    const out = createNode('output', 400, 0);
    const img = createImage(40, 30);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 40; x++) {
        const i = (y * 40 + x) * 4;
        const inside = x > 12 && x < 28 && y > 8 && y < 22;
        img.data[i] = inside ? 240 : 0;
        img.data[i + 1] = inside ? 230 : 255;
        img.data[i + 2] = inside ? 210 : 0;
        img.data[i + 3] = 255;
      }
    }
    const localAsset: GraphAsset = { id: 'iso', name: 'iso.png', kind: 'image', image: img, width: 40, height: 30 };
    const makeGraph = (onlyExtracted: boolean): PipelineGraph => {
      extract.params = {
        extraction: {
          ...DEFAULT_EXTRACTION,
          enabled: true,
          method: 'chroma',
          keyColor: '#00ff00',
          tolerance: 0.25,
        },
        maskId: 'subject',
        onlyExtracted,
      };
      return {
        id: 'g',
        name: 'g',
        description: '',
        nodes: [input, extract, out],
        edges: [
          { id: 'e1', fromNode: input.id, fromPort: 'media', toNode: extract.id, toPort: 'media' },
          { id: 'e2', fromNode: extract.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
        ],
      };
    };
    const countAlpha = (graph: PipelineGraph): { clear: number; solid: number } => {
      const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [localAsset] } });
      const item = mediaAtPort(evaluation, out.id)[0];
      let clear = 0;
      let solid = 0;
      for (let i = 3; i < item.source.data.length; i += 4) {
        if (item.source.data[i] === 0) clear++;
        else if (item.source.data[i] === 255) solid++;
      }
      return { clear, solid };
    };
    expect(countAlpha(makeGraph(false))).toEqual({ clear: 0, solid: 40 * 30 });
    const isolated = countAlpha(makeGraph(true));
    expect(isolated.clear).toBeGreaterThan(0);
    expect(isolated.solid).toBeGreaterThan(0);
    expect(isolated.clear + isolated.solid).toBe(40 * 30);

    const evaluation = evaluateGraph(makeGraph(true), { assetsByNode: { [input.id]: [localAsset] } });
    const item = mediaAtPort(evaluation, out.id)[0];
    expect(item.alphaCutMaskIds).toContain('subject');
    const frame = createImage(40, 30);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] = 200;
      frame.data[i + 3] = 255;
    }
    const cut = applyItemAlphaCuts(item, frame);
    expect(cut.data[3]).toBe(0);
    const center = (15 * 40 + 20) * 4 + 3;
    expect(cut.data[center]).toBe(255);
  });

  it('passes input to output completely unaltered when no processing nodes exist', () => {    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const input = createNode('input', 0, 0);
    const out = createNode('output', 200, 0);
    graph.nodes.push(input, out);
    graph.edges.push({ id: 'e1', fromNode: input.id, fromPort: 'media', toNode: out.id, toPort: 'media' });
    const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [asset] } });
    const item = mediaAtPort(evaluation, out.id)[0];
    const settings = settingsFromItem(item);
    expect(settings.pixelate.enabled).toBe(false);
    expect(settings.dither.algorithm).toBe('none');
    expect(settings.palette.mode).toBe('none');
    const result = renderPixelArt({ image: item.source, settings });
    expect(result.size.width).toBe(asset.width);
    expect(result.size.height).toBe(asset.height);
    expect(Array.from(result.art.data)).toEqual(Array.from(asset.image.data));
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

  it('bridges a deleted node automatically', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('preprocess', 0, 0);
    const b = createNode('preprocess', 100, 0);
    const c = createNode('output', 200, 0);
    graph.nodes.push(a, b, c);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: b.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: c.id, toPort: 'media' },
    );
    const result = deleteNodePreservingGraph(graph, b.id);
    expect(result.routerAdded).toBe(false);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toMatchObject({ fromNode: a.id, toNode: c.id });
  });

  it('reconnects every branch when deleting a multi-output node', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('preprocess', 0, 0);
    const b = createNode('color', 100, 0);
    const c = createNode('output', 200, -50);
    const d = createNode('output', 200, 50);
    graph.nodes.push(a, b, c, d);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: b.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: c.id, toPort: 'media' },
      { id: 'e3', fromNode: b.id, fromPort: 'media', toNode: d.id, toPort: 'media' },
    );
    const result = deleteNodePreservingGraph(graph, b.id);
    expect(result.routerAdded).toBe(false);
    expect(result.graph.edges.some((e) => e.fromNode === a.id && e.toNode === c.id)).toBe(true);
    expect(result.graph.edges.some((e) => e.fromNode === a.id && e.toNode === d.id)).toBe(true);
    expect(result.graph.edges.some((e) => e.fromNode === b.id || e.toNode === b.id)).toBe(false);
  });

  it('inserts a router when several branches feed the deleted node', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('input', 0, 0);
    const b = createNode('input', 0, 100);
    const merge = createNode('merge', 100, 50);
    const out = createNode('output', 200, 50);
    graph.nodes.push(a, b, merge, out);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: merge.id, toPort: 'media' },
      { id: 'e3', fromNode: merge.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
    );
    const result = deleteNodePreservingGraph(graph, merge.id);
    expect(result.routerAdded).toBe(true);
    const router = result.graph.nodes.find((n) => n.type === 'router');
    expect(router).toBeTruthy();
    expect(result.graph.edges).toHaveLength(3);
    expect(
      result.graph.edges.filter((e) => e.toNode === router!.id && e.toPort === 'media'),
    ).toHaveLength(2);
    expect(
      result.graph.edges.some((e) => e.fromNode === router!.id && e.toNode === out.id),
    ).toBe(true);
  });

  it('passes media and masks through a router', () => {
    const graph: PipelineGraph = { id: 'g', name: 'g', description: '', nodes: [], edges: [] };
    const a = createNode('input', 0, 0);
    const b = createNode('input', 0, 100);
    const router = createNode('router', 100, 50);
    const out = createNode('output', 200, 50);
    graph.nodes.push(a, b, router, out);
    graph.edges.push(
      { id: 'e1', fromNode: a.id, fromPort: 'media', toNode: router.id, toPort: 'media' },
      { id: 'e2', fromNode: b.id, fromPort: 'media', toNode: router.id, toPort: 'media' },
      { id: 'e3', fromNode: router.id, fromPort: 'media', toNode: out.id, toPort: 'media' },
    );
    const evaluation = evaluateGraph(graph, {
      assetsByNode: { [a.id]: [asset], [b.id]: [{ ...asset, id: 'b' }] },
    });
    expect(mediaAtPort(evaluation, out.id)).toHaveLength(2);
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

describe('spritesheet safety', () => {
  it('sanitizes missing numeric options instead of producing NaN dimensions', () => {
    const frame = createImage(4, 3);
    const sheet = packSpritesheet(
      [frame, frame],
      {
        columns: undefined as unknown as number,
        padding: undefined as unknown as number,
        maxSize: undefined as unknown as number,
        powerOfTwo: false,
      },
      [0.04, 0.04],
    );
    expect(Number.isFinite(sheet.sheetWidth)).toBe(true);
    expect(Number.isFinite(sheet.sheetHeight)).toBe(true);
    expect(sheet.sheetWidth).toBeGreaterThanOrEqual(4);
    expect(sheet.sheetHeight).toBeGreaterThanOrEqual(3);
    expect(sheet.frames).toHaveLength(2);
  });

  it('rejects sheets that would exceed canvas limits with a clear error', () => {
    const huge = { width: 9000, height: 9000, data: new Uint8ClampedArray(0) } as ReturnType<typeof createImage>;
    expect(() =>
      packSpritesheet([huge, huge, huge, huge], { columns: 0, padding: 0, maxSize: 4096, powerOfTwo: false }),
    ).toThrow(/too large|would be/i);
  });

  it('splits a long animation across several sheets', () => {
    const frames = Array.from({ length: 20 }, () => createImage(16, 16));
    const sheets = packSpritesheets(
      frames,
      { columns: 0, padding: 0, maxSize: 64, powerOfTwo: false, split: true },
      [],
    );
    expect(sheets.length).toBeGreaterThan(1);
    for (const sheet of sheets) {
      expect(sheet.sheetWidth).toBeLessThanOrEqual(64);
      expect(sheet.sheetHeight).toBeLessThanOrEqual(64);
    }
    expect(sheets.reduce((n, s) => n + s.frames.length, 0)).toBe(20);
  });
});

describe('magic mask', () => {
  const makeSubject = (offset: number): ReturnType<typeof createImage> => {
    const img = createImage(80, 60);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        const i = (y * 80 + x) * 4;
        const inside = x >= 20 + offset && x < 44 + offset && y >= 14 && y < 42;
        const inner = x >= 28 + offset && x < 36 + offset && y >= 22 && y < 34;
        img.data[i] = inside ? (inner ? 45 : 235) : 0;
        img.data[i + 1] = inside ? (inner ? 55 : 225) : 255;
        img.data[i + 2] = inside ? (inner ? 65 : 210) : 0;
        img.data[i + 3] = 255;
      }
    }
    return img;
  };

  it('grows a subject mask from a positive brush seed', () => {
    const img = makeSubject(0);
    const mask = buildMagicMask(
      img,
      [{ x: 26, y: 22, radius: 5, positive: true }],
      { tolerance: 0.14, feather: 0 },
    );
    const at = (x: number, y: number): number => mask.data[y * 80 + x];
    expect(at(2, 2)).toBe(0);
    expect(at(78, 58)).toBe(0);
    expect(at(30, 20)).toBe(255);
    expect(at(34, 28)).toBe(255); // enclosed inner detail is filled
  });

  it('tracks the mask into a shifted frame', () => {
    const first = makeSubject(0);
    const second = makeSubject(10);
    const mask = buildMagicMask(
      first,
      [{ x: 26, y: 22, radius: 5, positive: true }],
      { tolerance: 0.14, feather: 0 },
    );
    const tracked = trackMagicMaskFrame(second, first, mask, { tolerance: 0.14, feather: 0 });
    const at = (x: number, y: number): number => tracked.data[y * 80 + x];
    expect(at(36, 26)).toBe(255);
    expect(at(2, 2)).toBe(0);
    expect(at(78, 58)).toBe(0);
  });
});

describe('A4 print layout', () => {
  it('lays out frames on an A4 page with registration marks in the gutters', () => {
    const frames = Array.from({ length: 8 }, () => createImage(16, 16));
    const layout = layoutPrintPages(frames, {
      orientation: 'portrait',
      dpi: 150,
      marginMm: 10,
      gutterMm: 4,
      markMm: 3,
      scaleMode: 'actual',
    });
    expect(layout.pages).toHaveLength(1);
    const image = renderPrintPage(layout, frames, 0);
    expect(image.width).toBe(Math.round((210 * 150) / 25.4));
    expect(image.height).toBe(Math.round((297 * 150) / 25.4));
    expect(layout.columns).toBeGreaterThan(0);
    expect(layout.gutterPx).toBe(Math.round((4 * 150) / 25.4));
    // Paper starts white, frames are placed, and the first + mark is black.
    expect(pixel(image, 0, 0)).toEqual([255, 255, 255, 255]);
    const markX = layout.marginPx - Math.floor(layout.gutterPx / 2);
    const markY = markX;
    const [r, g, b] = pixel(image, markX, markY);
    expect(Math.max(r, g, b)).toBeLessThan(30);
    // Every frame is accounted for, in order.
    expect(layout.placements.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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

describe('generated backgrounds and 3D primitives', () => {
  it('renders solid, gradient, checker and transparent backgrounds', () => {
    const solid = renderBackground(24, 16, { mode: 'solid', colorA: '#112233', colorB: '#ffffff' });
    expect(pixel(solid, 0, 0)).toEqual([17, 34, 51, 255]);
    expect(pixel(solid, 23, 15)).toEqual([17, 34, 51, 255]);

    const linear = renderBackground(32, 8, {
      mode: 'linear',
      colorA: '#000000',
      colorB: '#ffffff',
      angle: 0,
    });
    const left = pixel(linear, 0, 4)[0];
    const right = pixel(linear, 31, 4)[0];
    expect(right).toBeGreaterThan(left + 100);

    const checker = renderBackground(32, 32, {
      mode: 'checker',
      colorA: '#ff0000',
      colorB: '#0000ff',
      scale: 8,
    });
    expect(pixel(checker, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(checker, 10, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(checker, 10, 10)).toEqual([255, 0, 0, 255]);

    const transparent = renderBackground(8, 8, { mode: 'transparent' });
    expect(transparent.data.every((value) => value === 0)).toBe(true);
  });

  it('renders every primitive with visible pixels', () => {
    for (const { value } of PRIMITIVES_3D) {
      const image = renderObject3D(96, 96, { primitive: value, antiAlias: 0 });
      expect(image.width).toBe(96);
      let opaque = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 0) opaque++;
      expect(opaque, value).toBeGreaterThan(400);
      expect(opaque, value).toBeLessThan(96 * 96);
    }
  });

  it('composites a generated background and 3D object through the graph', () => {
    const s = defaultSettings();
    const input = createNode('input', 0, 0, { label: 'Media' }, s);
    const background = createNode('background', 200, 0, {
      mode: 'checker',
      colorA: '#ff0000',
      colorB: '#0000ff',
      scale: 16,
    }, s);
    const object = createNode('object3d', 400, 0, {
      primitive: 'cube',
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      antiAlias: 0,
    }, s);
    let graph = { id: 'g', name: 'scene', description: '', nodes: [input, background, object], edges: [] } as PipelineGraph;
    graph = connect(graph, input.id, 'media', background.id, 'media');
    graph = connect(graph, background.id, 'media', object.id, 'media');
    const transparentSource: ReturnType<typeof createImage> = createImage(64, 64);
    const asset: GraphAsset = {
      id: 'transparent',
      name: 'transparent.png',
      kind: 'image',
      width: 64,
      height: 64,
      image: transparentSource,
    };
    const evaluation = evaluateGraph(graph, { assetsByNode: { [input.id]: [asset] } });
    expect(evaluation.errors).toEqual([]);
    const item = mediaAtPort(evaluation, object.id)[0];
    expect(item.sourceWidth).toBe(64);
    expect(item.sourceHeight).toBe(64);
    expect(item.underlay).toBeDefined();
    expect(item.overlay).toBeDefined();
    // The transparent source shows the generated checkerboard, and the cube is
    // composited on top of it.
    expect(pixel(item.source, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(item.source, 20, 2)).toEqual([0, 0, 255, 255]);
    let objectPixels = 0;
    for (let i = 0; i < item.source.data.length; i += 4) {
      const r = item.source.data[i];
      const g = item.source.data[i + 1];
      const b = item.source.data[i + 2];
      if (r > g && g > b && b < 150) objectPixels++;
    }
    expect(objectPixels).toBeGreaterThan(50);

    // Live video frames use the same underlay/overlay pair.
    const frame = createImage(64, 64);
    const composited = applyTrackedAlphaCuts(item, frame, 0, undefined);
    expect(pixel(composited, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(composited, 20, 2)).toEqual([0, 0, 255, 255]);
  });
});

describe('animation', () => {
  it('evaluates formulas and wraps translations', () => {
    expect(evaluateExpression('sin(pi / 2)', {})).toBeCloseTo(1);
    expect(evaluateExpression('frame + 2', { frame: 5 })).toBe(7);
    expect(evaluateExpression('clamp(9, 0, 4)', {})).toBe(4);
    expect(evaluateExpression('missing + 1', {})).toBe(1);

    const drift = evaluateMotion(
      { ...DEFAULT_MOTION, x: 't * 0.5', y: 'sin(t) * 0.1', rotationY: 't * 60', wrap: 'none' },
      2,
    );
    expect(drift.x).toBeCloseTo(1);
    expect(drift.rotationY).toBeCloseTo(120);
    expect(drift.y).toBeCloseTo(Math.sin(2) * 0.1);

    const wrapped = evaluateMotion(
      { ...DEFAULT_MOTION, x: 't * 1.3', wrap: 'horizontal', wrapWidth: 2.4 },
      2,
    );
    expect(wrapped.x).toBeCloseTo(0.2);
  });

  it('animates a generated 3D scene over time', () => {
    const s = defaultSettings();
    const background = createNode('background', 0, 0, { mode: 'solid', colorA: '#111827', width: 64, height: 64 }, s);
    const object = createNode('object3d', 200, 0, {
      primitive: 'cube',
      width: 64,
      height: 64,
      antiAlias: 0,
    }, s);
    const animate = createNode('animate', 400, 0, {
      ...DEFAULT_MOTION,
      y: 'sin(t * 2) * 0.3',
      rotationY: 't * 90',
    }, s);
    let graph = {
      id: 'g',
      name: 'animated',
      description: '',
      nodes: [background, object, animate],
      edges: [],
    } as PipelineGraph;
    graph = connect(graph, background.id, 'media', object.id, 'media');
    graph = connect(graph, animate.id, 'motion', object.id, 'motion');
    const sample = (time: number): number[] => {
      const evaluation = evaluateGraph(graph, { assetsByNode: {}, time });
      const item = mediaAtPort(evaluation, object.id)[0];
      return [...item.source.data];
    };
    const first = sample(0);
    const second = sample(0.5);
    expect(second).not.toEqual(first);
  });

  it('animates film grain and noise displacement', () => {
    const render = (type: 'grain' | 'displace', time: number): Uint8ClampedArray => {
      const settings = defaultSettings();
      settings.resolution = { ...settings.resolution, mode: 'short-side', value: 32 };
      settings.palette = { ...DEFAULT_PALETTE, mode: 'none' };
      settings.dither = { ...DEFAULT_DITHER, algorithm: 'none' };
      const op = createPreprocessOp(type);
      op.params = { ...op.params, animated: 1, amount: 0.5, seed: 3 };
      settings.preprocess = { ops: [op] };
      const result = renderPixelArt({ image: gradient(64, 64), settings }, { time });
      return result.artAtPixelScale.data;
    };
    expect(render('grain', 1)).not.toEqual(render('grain', 0.1));
    expect(render('displace', 1)).not.toEqual(render('displace', 0.1));
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
