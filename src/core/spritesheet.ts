/**
 * Spritesheet packing. Frames are already pixel art at export scale.
 */

import type { PixelImage } from './types';
import { createImage } from './image';

/** Hard limits used before allocating a sheet, to avoid canvas errors/OOM. */
export const SHEET_MAX_SIDE = 16384;
export const SHEET_MAX_PIXELS = 64_000_000;

export interface SpritesheetOptions {
  columns: number;
  padding: number;
  maxSize: number;
  powerOfTwo: boolean;
  /** Optional: split the result into several sheets. Defaults to true. */
  split?: boolean;
}

export interface SpritesheetFrameMeta {
  index: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  duration: number;
}

export interface SpritesheetResult {
  image: PixelImage;
  frames: SpritesheetFrameMeta[];
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  padding: number;
}

export function packSpritesheet(
  frames: PixelImage[],
  options: SpritesheetOptions,
  durations: number[] = [],
): SpritesheetResult {
  if (frames.length === 0) throw new Error('No frames to pack.');
  const cellW = Math.max(...frames.map((f) => f.width));
  const cellH = Math.max(...frames.map((f) => f.height));
  if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW < 1 || cellH < 1) {
    throw new Error('Spritesheet frames have an invalid size.');
  }
  // Sanitize every numeric option: old graphs and hand-edited presets may omit
  // fields, and NaN padding would otherwise produce NaN sheet dimensions.
  const opts = (options ?? {}) as Partial<SpritesheetOptions>;
  const rawPadding = Number(opts.padding);
  const padding = Math.max(0, Math.min(256, Math.round(Number.isFinite(rawPadding) ? rawPadding : 0)));
  const rawMax = Number(opts.maxSize);
  const maxSize = Math.max(
    64,
    Math.min(SHEET_MAX_SIDE, Math.round(Number.isFinite(rawMax) ? rawMax : 4096)),
  );
  const count = frames.length;
  const requestedColumns = Number(opts.columns);

  let columns =
    Number.isFinite(requestedColumns) && requestedColumns > 0
      ? Math.max(1, Math.round(requestedColumns))
      : Math.ceil(Math.sqrt(count));
  columns = Math.min(columns, count);

  const widthFor = (cols: number): number => cols * cellW + (cols - 1) * padding;
  const rowsFor = (cols: number): number => Math.ceil(count / cols);
  const heightFor = (cols: number): number => rowsFor(cols) * cellH + (rowsFor(cols) - 1) * padding;

  if (Number.isFinite(requestedColumns) && requestedColumns > 0) {
    // Respect an explicit column count.
    columns = Math.min(count, columns);
  } else {
    // Pick the column count closest to square that fits within maxSize.
    let best = -1;
    let bestScore = Infinity;
    for (let cols = 1; cols <= count; cols++) {
      const w = widthFor(cols);
      const h = heightFor(cols);
      if (w > maxSize || h > maxSize) continue;
      const aspect = Math.max(w / h, h / w);
      const score = aspect + Math.abs(cols - columns) * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = cols;
      }
    }
    if (best > 0) {
      columns = best;
    } else {
      // maxSize cannot be honoured. Use the layout with the smallest longest
      // side that still fits a canvas, rather than producing a giant sheet.
      let fallback = -1;
      let fallbackSide = Infinity;
      for (let cols = 1; cols <= count; cols++) {
        const w = widthFor(cols);
        const h = heightFor(cols);
        if (w > SHEET_MAX_SIDE || h > SHEET_MAX_SIDE) continue;
        if (w * h > SHEET_MAX_PIXELS) continue;
        const side = Math.max(w, h);
        const score = side + Math.abs(cols - columns) * 0.02;
        if (score < fallbackSide) {
          fallbackSide = score;
          fallback = cols;
        }
      }
      if (fallback < 0) {
        const needed = count * cellW * cellH;
        throw new Error(
          `Spritesheet too large: ${count} frames at ${cellW}×${cellH} need at least ${(
            needed / 1_000_000
          ).toFixed(1)} Mpx. Reduce the Art size or export scale, lower the frame count, raise Max size, or export Video only.`,
        );
      }
      columns = fallback;
    }
  }
  const rows = rowsFor(columns);
  let sheetW = widthFor(columns);
  let sheetH = heightFor(columns);

  if (opts.powerOfTwo) {
    const pot = (v: number): number => {
      let p = 1;
      while (p < v) p <<= 1;
      return p;
    };
    sheetW = pot(sheetW);
    sheetH = pot(sheetH);
  }

  if (
    sheetW > SHEET_MAX_SIDE ||
    sheetH > SHEET_MAX_SIDE ||
    sheetW * sheetH > SHEET_MAX_PIXELS
  ) {
    throw new Error(
      `Spritesheet would be ${sheetW}×${sheetH}. Reduce the Art size or export scale, turn off power-of-two, or export Video only.`,
    );
  }

  const image = createImage(sheetW, sheetH);
  const offsetX = opts.powerOfTwo ? Math.floor((sheetW - widthFor(columns)) / 2) : 0;
  const offsetY = opts.powerOfTwo ? Math.floor((sheetH - heightFor(columns)) / 2) : 0;
  const meta: SpritesheetFrameMeta[] = [];

  for (let i = 0; i < count; i++) {
    const frame = frames[i];
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = offsetX + col * (cellW + padding) + Math.floor((cellW - frame.width) / 2);
    const y = offsetY + row * (cellH + padding) + Math.floor((cellH - frame.height) / 2);
    blit(image, frame, x, y);
    meta.push({
      index: i,
      name: `frame_${String(i).padStart(4, '0')}`,
      x,
      y,
      w: frame.width,
      h: frame.height,
      duration: durations[i] ?? 1,
    });
  }

  return {
    image,
    frames: meta,
    columns,
    rows,
    cellWidth: cellW,
    cellHeight: cellH,
    sheetWidth: sheetW,
    sheetHeight: sheetH,
    padding,
  };
}

/**
 * Pack frames into one or more sheets. When a single sheet would exceed the
 * requested max size (or the hard canvas budget), frames are chunked onto
 * additional sheets using the same compatible grid.
 */
export function packSpritesheets(
  frames: PixelImage[],
  options: SpritesheetOptions,
  durations: number[] = [],
): SpritesheetResult[] {
  if (frames.length === 0) throw new Error('No frames to pack.');
  const opts = (options ?? {}) as Partial<SpritesheetOptions>;
  if (opts.split === false) return [packSpritesheet(frames, opts as SpritesheetOptions, durations)];

  const cellW = Math.max(...frames.map((f) => f.width));
  const cellH = Math.max(...frames.map((f) => f.height));
  if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW < 1 || cellH < 1) {
    throw new Error('Spritesheet frames have an invalid size.');
  }
  const rawPadding = Number(opts.padding);
  const padding = Math.max(0, Math.min(256, Math.round(Number.isFinite(rawPadding) ? rawPadding : 0)));
  const rawMax = Number(opts.maxSize);
  const maxSize = Math.max(
    64,
    Math.min(SHEET_MAX_SIDE, Math.round(Number.isFinite(rawMax) ? rawMax : 4096)),
  );
  const count = frames.length;
  const requested = Number(opts.columns);
  const maxColsBySize = Math.max(1, Math.floor((maxSize + padding) / (cellW + padding)));
  const columns =
    Number.isFinite(requested) && requested > 0
      ? Math.min(count, Math.round(requested), maxColsBySize)
      : Math.min(count, maxColsBySize, Math.max(1, Math.round(Math.sqrt(count))));

  const sheetW = columns * cellW + (columns - 1) * padding;
  const maxRowsBySize = Math.max(1, Math.floor((maxSize + padding) / (cellH + padding)));
  const maxRowsByBudget = Math.max(
    1,
    Math.floor(SHEET_MAX_PIXELS / Math.max(1, sheetW * (cellH + padding))),
  );
  const rowsPerSheet = Math.min(maxRowsBySize, maxRowsByBudget);
  const perSheet = Math.max(1, columns * rowsPerSheet);

  if (perSheet >= count) {
    return [packSpritesheet(frames, { ...opts, columns } as SpritesheetOptions, durations)];
  }

  const out: SpritesheetResult[] = [];
  for (let start = 0; start < count; start += perSheet) {
    const chunk = frames.slice(start, start + perSheet);
    out.push(
      packSpritesheet(
        chunk,
        { ...opts, columns } as SpritesheetOptions,
        durations.slice(start, start + perSheet),
      ),
    );
  }
  return out;
}

function blit(dst: PixelImage, src: PixelImage, x: number, y: number): void {  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4;
      const di = (dy * dst.width + dx) * 4;
      const a = src.data[si + 3] / 255;
      if (a <= 0) continue;
      if (a >= 0.999) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
      } else {
        const da = dst.data[di + 3] / 255;
        const outA = a + da * (1 - a);
        dst.data[di] = (src.data[si] * a + dst.data[di] * da * (1 - a)) / outA;
        dst.data[di + 1] = (src.data[si + 1] * a + dst.data[di + 1] * da * (1 - a)) / outA;
        dst.data[di + 2] = (src.data[si + 2] * a + dst.data[di + 2] * da * (1 - a)) / outA;
        dst.data[di + 3] = outA * 255;
      }
    }
  }
}

export function spritesheetMetadata(
  sheet: SpritesheetResult,
  name: string,
  fps: number,
): Record<string, unknown> {
  return {
    frames: sheet.frames.map((f) => ({
      filename: `${f.name}.png`,
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h },
      duration: f.duration,
    })),
    meta: {
      app: 'PixelArtify Studio',
      version: '1',
      image: `${name}.png`,
      format: 'RGBA8888',
      size: { w: sheet.sheetWidth, h: sheet.sheetHeight },
      scale: '1',
      frameRate: fps,
      columns: sheet.columns,
      rows: sheet.rows,
      cellWidth: sheet.cellWidth,
      cellHeight: sheet.cellHeight,
      padding: sheet.padding,
    },
  };
}
