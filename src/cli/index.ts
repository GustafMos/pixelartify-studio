#!/usr/bin/env node
/**
 * PixelArtify Studio CLI — batch images and video, headless.
 *
 * Uses the same pure-TypeScript core as the browser studio, plus sharp for
 * image I/O and ffmpeg for video decode/encode.
 */

import { parseArgs } from 'node:util';
import { mkdir, readdir, writeFile, rm, mkdtemp, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import {
  BUILTIN_PRESETS,
  DITHER_ALGORITHMS,
  computeArtSize,
  deepClone,
  defaultSettings,
  evaluateGraph,
  mediaAtPort,
  mergeSettings,
  packSpritesheet,
  parsePalette,
  parsePreset,
  renderPixelArt,
  settingsFromGraph,
  settingsFromItem,
  spritesheetMetadata,
  type GraphAsset,
  type PixelArtifySettings,
  type PixelImage,
  type Preset,
} from '../core';

const HELP = `
PixelArtify Studio CLI

Usage:
  pixelartify [options] <files or folders...>

Media:
  -o, --out <dir>            Output directory (default: ./output)
  -p, --preset <id|file>     Built-in preset id or .pixelartify.json file
      --preset-file <file>   Preset file (same as --preset with a path)
      --list-presets         Print built-in presets and exit
      --list-dithers         Print dithering algorithms and exit

Resolution (overrides the preset):
      --height <px>          Fixed art height
      --width <px>           Fixed art width
      --short-side <px>      Fixed short side
      --block <px>           Source pixels per art pixel
      --scale <n>            Integer export upscale (1-16)
      --even                 Snap art dimensions to even numbers

Colour & dithering:
      --palette-mode <m>     none | auto | custom
      --colors <n>           Auto palette colour count
      --palette <hex,...>    Custom palette, comma separated
      --palette-file <file>  Import .hex/.gpl/.pal/.txt/.json palette
      --dither <id>          Dither algorithm id (see --list-dithers)
      --dither-strength <n>  0..1
      --dither-scale <n>     Pattern scale in art pixels

Output:
      --format <png|webp>    Image format (default: preset or png)
      --quality <n>          WebP quality 0..1
      --layers               Export each layer as a separate PNG
      --no-manifest          Skip the JSON manifest
      --overwrite            Overwrite existing files

Video (requires ffmpeg; bundled optional install or FFMPEG_PATH):
      --video-output <m>     video | spritesheet | both
      --fps <n>              Output frame rate (default 24)
      --start <s>            Start time in seconds
      --end <s>              End time in seconds
      --codec <avc|vp9|av1>  Video codec (default avc)
      --crf <n>              Encoder quality (default 20)
      --no-audio             Do not mux the original audio
      --sheet-columns <n>    0 = auto
      --sheet-padding <px>
      --sheet-max <px>
      --sheet-pot            Power-of-two sheet dimensions

Other:
  -j, --jobs <n>             Parallel image jobs (default: 4)
      --no-graph             Ignore graph geometry; use the preset's settings only
      --dry-run              Print the resolved settings and files, no writes
  -h, --help                 Show this help
      --version              Print version
`;

type Options = ReturnType<typeof parseCli>['values'];

function parseCli(): {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
} {
  return parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      out: { type: 'string', short: 'o', default: 'output' },
      preset: { type: 'string', short: 'p' },
      'preset-file': { type: 'string' },
      'list-presets': { type: 'boolean' },
      'list-dithers': { type: 'boolean' },
      height: { type: 'string' },
      width: { type: 'string' },
      'short-side': { type: 'string' },
      block: { type: 'string' },
      scale: { type: 'string' },
      even: { type: 'boolean' },
      'palette-mode': { type: 'string' },
      colors: { type: 'string' },
      palette: { type: 'string' },
      'palette-file': { type: 'string' },
      dither: { type: 'string' },
      'dither-strength': { type: 'string' },
      'dither-scale': { type: 'string' },
      format: { type: 'string' },
      quality: { type: 'string' },
      layers: { type: 'boolean' },
      'no-manifest': { type: 'boolean' },
      overwrite: { type: 'boolean' },
      'video-output': { type: 'string' },
      fps: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      codec: { type: 'string' },
      crf: { type: 'string' },
      'no-audio': { type: 'boolean' },
      'sheet-columns': { type: 'string' },
      'sheet-padding': { type: 'string' },
      'sheet-max': { type: 'string' },
      'sheet-pot': { type: 'boolean' },
      jobs: { type: 'string', short: 'j' },
      'no-graph': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogv']);

function kindOf(file: string): 'image' | 'video' | null {
  const ext = extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

async function collectInputs(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && kindOf(full)) out.push(full);
    }
  };
  for (const p of paths) {
    const full = resolve(p);
    if (!existsSync(full)) {
      console.error(`warning: not found: ${full}`);
      continue;
    }
    const info = await stat(full);
    if (info.isDirectory()) await walk(full);
    else if (kindOf(full)) out.push(full);
  }
  return out;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolvePreset(options: Options): Preset | null {
  const value = (options.preset ?? options['preset-file']) as string | undefined;
  if (!value) return null;
  const builtin = BUILTIN_PRESETS.find((p) => p.id === value || p.name.toLowerCase() === value.toLowerCase());
  if (builtin) return deepClone(builtin);
  const path = resolve(value);
  if (existsSync(path)) {
    return parsePreset(readFileSync(path, 'utf8'));
  }
  console.error(`warning: preset not found: ${value}`);
  return null;
}

function applyOverrides(settings: PixelArtifySettings, options: Options): PixelArtifySettings {
  const s = deepClone(settings);
  if (options.height) {
    s.resolution.mode = 'fixed-height';
    s.resolution.value = num(options.height, s.resolution.value);
  } else if (options.width) {
    s.resolution.mode = 'fixed-width';
    s.resolution.value = num(options.width, s.resolution.value);
  } else if (options['short-side']) {
    s.resolution.mode = 'short-side';
    s.resolution.value = num(options['short-side'], s.resolution.value);
  } else if (options.block) {
    s.resolution.mode = 'block-size';
    s.resolution.value = num(options.block, 4);
  }
  if (options.scale) s.resolution.exportScale = num(options.scale, s.resolution.exportScale);
  if (options.even) s.resolution.snapEven = true;

  const mode = options['palette-mode'] as string | undefined;
  if (mode === 'none' || mode === 'auto' || mode === 'custom') s.palette.mode = mode;
  if (options.colors) s.palette.autoCount = num(options.colors, s.palette.autoCount);
  if (options.palette) {
    s.palette.mode = 'custom';
    s.palette.colors = String(options.palette).split(',').map((c) => c.trim()).filter(Boolean);
  }
  if (options['palette-file']) {
    const text = readFileSync(resolve(String(options['palette-file'])), 'utf8');
    const colors = parsePalette(text);
    if (colors.length === 0) throw new Error(`No colours in ${options['palette-file']}`);
    s.palette.mode = 'custom';
    s.palette.colors = colors;
  }
  if (options.dither) s.dither.algorithm = String(options.dither);
  if (options['dither-strength']) s.dither.strength = Math.max(0, Math.min(1, num(options['dither-strength'], 1)));
  if (options['dither-scale']) s.dither.scale = num(options['dither-scale'], 1);

  if (options.format === 'png' || options.format === 'webp') s.output.format = options.format;
  if (options.quality) s.output.quality = Math.max(0, Math.min(1, num(options.quality, 0.92)));
  if (options.layers) s.output.exportLayers = true;
  if (options['no-manifest']) s.output.writeManifest = false;

  if (options['video-output']) {
    const v = String(options['video-output']);
    if (v === 'video' || v === 'spritesheet' || v === 'both') s.video.output = v;
  }
  if (options.fps) s.video.fps = num(options.fps, s.video.fps);
  if (options.start !== undefined) s.video.start = num(options.start, 0);
  if (options.end !== undefined) s.video.end = num(options.end, 0);
  if (options.codec === 'avc' || options.codec === 'vp9' || options.codec === 'av1') s.video.codec = options.codec;
  if (options['sheet-columns']) s.video.spritesheet.columns = num(options['sheet-columns'], 0);
  if (options['sheet-padding']) s.video.spritesheet.padding = num(options['sheet-padding'], 0);
  if (options['sheet-max']) s.video.spritesheet.maxSize = num(options['sheet-max'], 4096);
  if (options['sheet-pot']) s.video.spritesheet.powerOfTwo = true;
  return s;
}

function settingsForPreset(preset: Preset | null): PixelArtifySettings {
  if (!preset) return defaultSettings();
  return preset.settings ? mergeSettings(defaultSettings(), preset.settings) : settingsFromGraph(preset.graph);
}

function formatName(pattern: string, data: { name: string; width: number; height: number; index?: number; ext: string }): string {
  const base = data.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'pixelart';
  let out = pattern || '{name}-{width}x{height}';
  out = out
    .replace(/\{name\}/g, base)
    .replace(/\{width\}/g, String(data.width))
    .replace(/\{height\}/g, String(data.height))
    .replace(/\{index\}/g, String(data.index ?? 0).padStart(4, '0'))
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
  if (!out.toLowerCase().endsWith(`.${data.ext}`)) out += `.${data.ext}`;
  return out;
}

async function loadImage(file: string): Promise<PixelImage> {
  const { data, info } = await sharp(file)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function writeImage(
  image: PixelImage,
  file: string,
  format: 'png' | 'webp',
  quality: number,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  let pipeline = sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
  pipeline = format === 'webp' ? pipeline.webp({ quality: Math.round(quality * 100) }) : pipeline.png();
  await pipeline.toFile(file);
}

interface RenderOutput {
  itemName: string;
  outputName: string;
  result: ReturnType<typeof renderPixelArt>;
  settings: PixelArtifySettings;
}

function renderWithGraph(
  graph: Preset['graph'],
  image: PixelImage,
  file: string,
  options: Options,
): RenderOutput[] {
  const inputNode = graph.nodes.find((n) => n.type === 'input');
  if (!inputNode) throw new Error('Graph has no Media input node.');
  const asset: GraphAsset = {
    id: basename(file),
    name: basename(file),
    kind: 'image',
    image,
    width: image.width,
    height: image.height,
  };
  const assetsByNode: Record<string, GraphAsset[]> = {};
  for (const n of graph.nodes) if (n.type === 'input') assetsByNode[n.id] = [];
  assetsByNode[inputNode.id] = [asset];
  const evaluation = evaluateGraph(graph, { assetsByNode, maskCache: new Map() });
  const outputs: RenderOutput[] = [];
  for (const outNode of graph.nodes.filter((n) => n.type === 'output')) {
    const items = mediaAtPort(evaluation, outNode.id);
    for (const item of items) {
      let settings = settingsFromItem(item);
      const output = outNode.params.output as typeof settings.output | undefined;
      const video = outNode.params.video as typeof settings.video | undefined;
      settings.output = output ? deepClone(output) : settings.output;
      settings.video = video ? deepClone(video) : settings.video;
      settings = applyOverrides(settings, options);
      const result = renderPixelArt({ image: item.source, masks: item.masks, settings }, { upscale: true });
      outputs.push({
        itemName: item.name,
        outputName: String(outNode.params.label ?? outNode.title),
        result,
        settings,
      });
    }
  }
  return outputs;
}

function renderDirect(image: PixelImage, settings: PixelArtifySettings): RenderOutput[] {
  const result = renderPixelArt({ image, settings }, { upscale: true });
  return [{ itemName: 'image', outputName: 'Output', result, settings }];
}

async function processImage(file: string, outDir: string, options: Options, preset: Preset | null, baseSettings: PixelArtifySettings): Promise<number> {
  const image = await loadImage(file);
  const outputs = preset && !options['no-graph']
    ? renderWithGraph(preset.graph, image, file, options)
    : renderDirect(image, applyOverrides(preset ? settingsFromGraph(preset.graph) : baseSettings, options));

  let written = 0;
  for (const out of outputs) {
    const settings = out.settings;
    const name = formatName(settings.output.filenamePattern, {
      name: basename(file),
      width: out.result.size.width,
      height: out.result.size.height,
      ext: settings.output.format,
    });
    const target = join(outDir, name);
    if (existsSync(target) && !options.overwrite) {
      console.log(`  skip existing ${target} (use --overwrite)`);
      continue;
    }
    if (options['dry-run']) {
      console.log(`  would write ${target} (${out.result.size.exportWidth}x${out.result.size.exportHeight})`);
      written++;
      continue;
    }
    await writeImage(out.result.art, target, settings.output.format, settings.output.quality);
    written++;
    console.log(`  wrote ${target} (${out.result.size.exportWidth}x${out.result.size.exportHeight}, ${out.result.palette.length} colours, ${out.result.stats.durationMs.toFixed(0)}ms)`);

    if (settings.output.writeManifest) {
      const manifestPath = target.replace(/\.(png|webp)$/i, '.pixelartify.json');
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            app: 'PixelArtify Studio CLI',
            source: basename(file),
            output: out.outputName,
            artWidth: out.result.size.width,
            artHeight: out.result.size.height,
            exportScale: out.result.size.pixelScale,
            palette: out.result.palette,
            stats: out.result.stats,
            layers: out.result.layers.map((l) => ({
              name: l.name,
              role: l.role,
              opacity: l.opacity,
              blend: l.blend,
              file: `${l.name.replace(/[^\w.-]+/g, '-')}.png`,
            })),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }

    if (settings.output.exportLayers && out.result.layers.length > 0) {
      const layerDir = join(outDir, `${basename(file).replace(/\.[^.]+$/, '')}-layers`);
      for (const layer of out.result.layers) {
        const lf = join(layerDir, `${layer.name.replace(/[^\w.-]+/g, '-')}.png`);
        await writeImage(layer.image, lf, 'png', 1);
        written++;
      }
      if (!options['dry-run']) console.log(`  wrote ${out.result.layers.length} layer files to ${layerDir}`);
    }
  }
  return written;
}

let resolvedFfmpeg: string | null = null;

async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (resolvedFfmpeg) return resolvedFfmpeg;
  try {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    resolvedFfmpeg = (mod.default ?? mod).path;
  } catch {
    // Fall back to a system ffmpeg.
    resolvedFfmpeg = 'ffmpeg';
  }
  return resolvedFfmpeg;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const binary = await ffmpegPath();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-3000)}`));
    });
  });
}

async function processVideo(file: string, outDir: string, options: Options, settings: PixelArtifySettings): Promise<number> {
  const v = settings.video;
  const tmp = await mkdtemp(join(tmpdir(), 'pixelartify-'));
  const framesDir = join(tmp, 'frames');
  const outFramesDir = join(tmp, 'out');
  await mkdir(framesDir, { recursive: true });
  await mkdir(outFramesDir, { recursive: true });
  const start = v.start ?? 0;
  const end = v.end ?? undefined;
  const codec = v.codec;
  const crf = num(options.crf, 20);
  const ext = codec === 'vp9' ? 'webm' : 'mp4';
  const base = basename(file).replace(/\.[^.]+$/, '');
  const targetDir = join(outDir, base);
  await mkdir(targetDir, { recursive: true });

  console.log(`  extracting frames at ${v.fps} fps…`);
  const extractArgs = [
    '-y',
    ...(start > 0 ? ['-ss', String(start)] : []),
    ...(end !== undefined ? ['-to', String(end)] : []),
    '-i', file,
    '-vf', `fps=${v.fps}`,
    '-start_number', '0',
    join(framesDir, 'frame_%06d.png'),
  ];
  await runFfmpeg(extractArgs);

  const frameFiles = (await readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
  if (frameFiles.length === 0) throw new Error('No frames extracted.');
  console.log(`  pixelating ${frameFiles.length} frames…`);

  const sheetFrames: PixelImage[] = [];
  let outW = 0;
  let outH = 0;
  for (let i = 0; i < frameFiles.length; i++) {
    const frame = await loadImage(join(framesDir, frameFiles[i]));
    const result = renderPixelArt({ image: frame, settings }, { upscale: true });
    outW = result.art.width;
    outH = result.art.height;
    await writeImage(result.art, join(outFramesDir, `frame_${String(i).padStart(6, '0')}.png`), 'png', 1);
    if (v.output === 'spritesheet' || v.output === 'both') sheetFrames.push(result.art);
    if (i % 10 === 0 || i === frameFiles.length - 1) {
      process.stdout.write(`\r  frame ${i + 1}/${frameFiles.length}`);
    }
  }
  process.stdout.write('\n');

  let written = 0;
  if (v.output === 'video' || v.output === 'both') {
    const videoPath = join(targetDir, `${base}-pixelart.${ext}`);
    const codecArgs =
      codec === 'vp9'
        ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-pix_fmt', 'yuv420p']
        : codec === 'av1'
          ? ['-c:v', 'libsvtav1', '-crf', String(crf), '-pix_fmt', 'yuv420p']
          : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
    const args = [
      '-y',
      '-framerate', String(v.fps),
      '-i', join(outFramesDir, 'frame_%06d.png'),
      ...(!options['no-audio'] ? ['-i', file] : []),
      '-map', '0:v:0',
      ...(!options['no-audio'] ? ['-map', '1:a?', '-c:a', 'aac', '-shortest'] : []),
      ...codecArgs,
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      videoPath,
    ];
    await runFfmpeg(args);
    console.log(`  wrote ${videoPath} (${outW}x${outH})`);
    written++;
  }

  if (v.output === 'spritesheet' || v.output === 'both') {
    const sheet = packSpritesheet(sheetFrames, v.spritesheet, sheetFrames.map(() => 1 / v.fps));
    const sheetPath = join(targetDir, `${base}-sheet.png`);
    await writeImage(sheet.image, sheetPath, 'png', 1);
    const metaPath = join(targetDir, `${base}-sheet.json`);
    await writeFile(metaPath, `${JSON.stringify(spritesheetMetadata(sheet, `${base}-sheet`, v.fps), null, 2)}\n`, 'utf8');
    console.log(`  wrote ${sheetPath} (${sheet.sheetWidth}x${sheet.sheetHeight}, ${sheet.frames.length} frames)`);
    written += 2;
  }

  await rm(tmp, { recursive: true, force: true });
  return written;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const { values: options, positionals } = parseCli();

  if (options.help || (!positionals.length && !options['list-presets'] && !options['list-dithers'])) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log('PixelArtify Studio CLI 0.1.0');
    return;
  }
  if (options['list-presets']) {
    for (const p of BUILTIN_PRESETS) {
      console.log(`${p.id.padEnd(22)} ${p.name}`);
    }
    return;
  }
  if (options['list-dithers']) {
    for (const a of DITHER_ALGORITHMS) {
      console.log(`${a.id.padEnd(22)} ${a.category.padEnd(10)} ${a.name}`);
    }
    return;
  }
  if (!positionals.length) {
    console.error('No inputs. Pass files or folders, or use --help.');
    process.exitCode = 1;
    return;
  }

  const preset = resolvePreset(options);
  const baseSettings = applyOverrides(settingsForPreset(preset), options);
  const outDir = resolve(String(options.out ?? 'output'));
  await mkdir(outDir, { recursive: true });
  const inputs = await collectInputs(positionals);
  if (inputs.length === 0) {
    console.error('No supported media found.');
    process.exitCode = 1;
    return;
  }

  console.log(`PixelArtify Studio CLI`);
  console.log(`  inputs: ${inputs.length}`);
  console.log(`  preset: ${preset ? preset.name : 'default settings'}`);
  console.log(`  output: ${outDir}`);
  const art = computeArtSize(1920, 1080, baseSettings.resolution);
  console.log(`  sample art size (1080p source): ${art.width}x${art.height}, export ${art.exportWidth}x${art.exportHeight}`);
  console.log('');

  const jobs = Math.max(1, num(options.jobs, 4));
  let total = 0;
  let failures = 0;
  const startAt = Date.now();

  await mapLimit(inputs, jobs, async (file, index) => {
    const kind = kindOf(file);
    console.log(`[${index + 1}/${inputs.length}] ${file} (${kind})`);
    try {
      if (kind === 'image') {
        total += await processImage(file, outDir, options, preset, baseSettings);
      } else if (kind === 'video') {
        total += await processVideo(file, outDir, options, baseSettings);
      }
    } catch (err) {
      failures++;
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
    console.log('');
  });

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
  console.log(`Done: ${total} file(s) in ${elapsed}s${failures ? `, ${failures} failure(s)` : ''}.`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
