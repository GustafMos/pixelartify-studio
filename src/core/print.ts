/**
 * Printable A4 layout.
 *
 * Frames are laid out on white pages at a chosen DPI. The gap between frames is
 * a gutter, and a black "+" registration mark is drawn at every cell corner so
 * the printed sheet can be scanned and re-registered later.
 */

import type { PixelImage, PrintSettings } from './types';
import { clamp } from './color';
import { createImage, resizeImage } from './image';

export const A4_MM = { width: 210, height: 297 };
const MM_PER_INCH = 25.4;
const MAX_PRINT_PAGES = 96;

export interface PrintPlacement {
  index: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintPage {
  page: number;
  pages: number;
  placements: PrintPlacement[];
  columns: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  dpi: number;
  width: number;
  height: number;
}

export interface PrintLayout {
  pages: PrintPage[];
  placements: PrintPlacement[];
  columns: number;
  rows: number;
  scale: number;
  dpi: number;
  widthMm: number;
  heightMm: number;
  pageWidth: number;
  pageHeight: number;
  cellWidth: number;
  cellHeight: number;
  pitchX: number;
  pitchY: number;
  marginPx: number;
  gutterPx: number;
  markPx: number;
}

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH);
}

function sanitize(settings: PrintSettings): Required<PrintSettings> {
  const dpi = clamp(Math.round(Number(settings.dpi) || 300), 72, 600);
  const gutterMm = clamp(Number(settings.gutterMm) || 4, 1, 30);
  const marginMm = clamp(Number(settings.marginMm) || 10, 2, 40);
  const markMm = clamp(Number(settings.markMm) || 3, 0.5, Math.max(1, gutterMm - 0.5));
  return {
    orientation: settings.orientation === 'landscape' ? 'landscape' : 'portrait',
    dpi,
    marginMm,
    gutterMm,
    markMm,
    scaleMode: settings.scaleMode === 'fit' ? 'fit' : 'actual',
  };
}

export function layoutPrintPages(frames: PixelImage[], settings: PrintSettings): PrintLayout {
  if (frames.length === 0) throw new Error('No frames to print.');
  const s = sanitize(settings);
  const portrait = s.orientation === 'portrait';
  const widthMm = portrait ? A4_MM.width : A4_MM.height;
  const heightMm = portrait ? A4_MM.height : A4_MM.width;
  const pageW = mmToPx(widthMm, s.dpi);
  const pageH = mmToPx(heightMm, s.dpi);
  const gutter = mmToPx(s.gutterMm, s.dpi);
  const mark = Math.max(1, Math.min(gutter - 1, mmToPx(s.markMm, s.dpi)));
  const margin = Math.max(mmToPx(s.marginMm, s.dpi), Math.ceil(gutter / 2) + 2);

  const frameW = Math.max(1, Math.max(...frames.map((f) => f.width)));
  const frameH = Math.max(1, Math.max(...frames.map((f) => f.height)));
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;

  let scale: number;
  if (s.scaleMode === 'fit') {
    scale = Math.min(contentW / frameW, contentH / frameH);
  } else {
    scale = 1;
  }
  // Always shrink until at least one cell fits between the margins.
  if (frameW * scale > contentW || frameH * scale > contentH) {
    scale = Math.min(contentW / frameW, contentH / frameH);
  }
  scale = Math.max(0.01, Math.min(32, scale));

  const cellW = Math.max(1, Math.round(frameW * scale));
  const cellH = Math.max(1, Math.round(frameH * scale));
  const pitchX = cellW + gutter;
  const pitchY = cellH + gutter;
  const columns = Math.max(1, Math.floor((contentW + gutter) / pitchX));
  const rows = Math.max(1, Math.floor((contentH + gutter) / pitchY));
  const capacity = columns * rows;
  const pages = Math.ceil(frames.length / capacity);
  if (pages > MAX_PRINT_PAGES) {
    throw new Error(
      `A4 print would need ${pages} pages (limit ${MAX_PRINT_PAGES}). Reduce the frame count, choose Actual size with smaller art, or lower the DPI.`,
    );
  }

  const placements: PrintPlacement[] = [];
  const pageDescriptors: PrintPage[] = [];

  for (let p = 0; p < pages; p++) {
    const start = p * capacity;
    const chunk = frames.slice(start, start + capacity);
    const pagePlacements: PrintPlacement[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = margin + col * pitchX;
      const y = margin + row * pitchY;
      const placement: PrintPlacement = { index: start + i, page: p, x, y, w: cellW, h: cellH };
      pagePlacements.push(placement);
      placements.push(placement);
    }

    pageDescriptors.push({
      page: p + 1,
      pages,
      placements: pagePlacements,
      columns,
      rows: Math.max(1, Math.ceil(chunk.length / columns)),
      widthMm,
      heightMm,
      dpi: s.dpi,
      width: pageW,
      height: pageH,
    });
  }

  return {
    pages: pageDescriptors,
    placements,
    columns,
    rows,
    scale,
    dpi: s.dpi,
    widthMm,
    heightMm,
    pageWidth: pageW,
    pageHeight: pageH,
    cellWidth: cellW,
    cellHeight: cellH,
    pitchX,
    pitchY,
    marginPx: margin,
    gutterPx: gutter,
    markPx: mark,
  };
}

/** Render one A4 page on demand; pages are not kept in memory by the layout. */
export function renderPrintPage(
  layout: PrintLayout,
  frames: PixelImage[],
  pageIndex: number,
): PixelImage {
  const page = layout.pages[pageIndex];
  if (!page) throw new Error(`Print page ${pageIndex + 1} does not exist.`);
  const image = createImage(page.width, page.height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255;
    image.data[i + 1] = 255;
    image.data[i + 2] = 255;
    image.data[i + 3] = 255;
  }
  for (const placement of page.placements) {
    const frame = frames[placement.index];
    if (frame) drawFrame(image, frame, placement.x, placement.y, placement.w, placement.h);
  }
  // Registration marks at every cell corner, centred in the gutters.
  const halfGutter = Math.floor(layout.gutterPx / 2);
  for (let c = 0; c <= layout.columns; c++) {
    const cx = layout.marginPx + c * layout.pitchX - halfGutter;
    for (let r = 0; r <= page.rows; r++) {
      const cy = layout.marginPx + r * layout.pitchY - halfGutter;
      drawPlus(image, cx, cy, layout.markPx);
    }
  }
  return image;
}

export function printMetadata(layout: PrintLayout, name: string): Record<string, unknown> {
  return {
    app: 'PixelArtify Studio',
    version: '1',
    name,
    paper: 'A4',
    orientation: layout.widthMm > layout.heightMm ? 'landscape' : 'portrait',
    widthMm: layout.widthMm,
    heightMm: layout.heightMm,
    dpi: layout.dpi,
    marginPx: layout.marginPx,
    gutterPx: layout.gutterPx,
    markPx: layout.markPx,
    scale: layout.scale,
    columns: layout.columns,
    rows: layout.rows,
    pageCount: layout.pages.length,
    frames: layout.placements.map((p) => ({
      index: p.index,
      page: p.page + 1,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
    })),
  };
}

function drawFrame(
  page: PixelImage,
  frame: PixelImage,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scaled =
    frame.width === w && frame.height === h
      ? frame
      : resizeImage(frame, w, h, w >= frame.width && h >= frame.height ? 'nearest' : 'box');
  const pageData = page.data;
  const src = scaled.data;
  for (let sy = 0; sy < scaled.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= page.height) continue;
    for (let sx = 0; sx < scaled.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= page.width) continue;
      const si = (sy * scaled.width + sx) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0) continue;
      const di = (dy * page.width + dx) * 4;
      if (a >= 0.999) {
        pageData[di] = src[si];
        pageData[di + 1] = src[si + 1];
        pageData[di + 2] = src[si + 2];
      } else {
        pageData[di] = src[si] * a + 255 * (1 - a);
        pageData[di + 1] = src[si + 1] * a + 255 * (1 - a);
        pageData[di + 2] = src[si + 2] * a + 255 * (1 - a);
      }
      pageData[di + 3] = 255;
    }
  }
}

function drawPlus(page: PixelImage, cx: number, cy: number, size: number): void {
  const arm = Math.max(1, Math.round(size / 2));
  const thickness = Math.max(1, Math.round(size / 5));
  fillRect(page, cx - arm, cy - Math.floor(thickness / 2), arm * 2, thickness);
  fillRect(page, cx - Math.floor(thickness / 2), cy - arm, thickness, arm * 2);
}

function fillRect(page: PixelImage, x: number, y: number, w: number, h: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(page.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(page.width, x + w); xx++) {
      const i = (yy * page.width + xx) * 4;
      page.data[i] = 0;
      page.data[i + 1] = 0;
      page.data[i + 2] = 0;
      page.data[i + 3] = 255;
    }
  }
}
