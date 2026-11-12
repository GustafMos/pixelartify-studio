/**
 * Spritesheet packing. Frames are already pixel art at export scale.
 */

import type { PixelImage } from './types';
import { createImage } from './image';

export interface SpritesheetOptions {
  columns: number;
  padding: number;
  maxSize: number;
  powerOfTwo: boolean;
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
}

export function packSpritesheet(
  frames: PixelImage[],
  options: SpritesheetOptions,
  durations: number[] = [],
): SpritesheetResult {
  if (frames.length === 0) throw new Error('No frames to pack.');
  const cellW = Math.max(...frames.map((f) => f.width));
  const cellH = Math.max(...frames.map((f) => f.height));
  const padding = Math.max(0, Math.round(options.padding));
  const maxSize = Math.max(64, Math.round(options.maxSize));
  const count = frames.length;

  let columns = options.columns > 0 ? Math.max(1, Math.round(options.columns)) : Math.ceil(Math.sqrt(count));
  columns = Math.min(columns, count);

  const widthFor = (cols: number): number => cols * cellW + (cols - 1) * padding;
  const rowsFor = (cols: number): number => Math.ceil(count / cols);
  const heightFor = (cols: number): number => rowsFor(cols) * cellH + (rowsFor(cols) - 1) * padding;

  if (options.columns > 0) {
    // Respect an explicit column count.
    columns = Math.min(count, columns);
  } else {
    // Pick the column count closest to square that fits within maxSize.
    let best = columns;
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
    if (bestScore !== Infinity) columns = best;
  }
  const rows = rowsFor(columns);
  let sheetW = widthFor(columns);
  let sheetH = heightFor(columns);

  if (options.powerOfTwo) {
    const pot = (v: number): number => {
      let p = 1;
      while (p < v) p <<= 1;
      return p;
    };
    sheetW = pot(sheetW);
    sheetH = pot(sheetH);
  }

  const image = createImage(sheetW, sheetH);
  const offsetX = options.powerOfTwo ? Math.floor((sheetW - widthFor(columns)) / 2) : 0;
  const offsetY = options.powerOfTwo ? Math.floor((sheetH - heightFor(columns)) / 2) : 0;
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
  };
}

function blit(dst: PixelImage, src: PixelImage, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
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
      padding: sheet.frames.length > 1 ? sheet.frames[1].x - sheet.frames[0].x - sheet.frames[0].w : 0,
    },
  };
}
