/**
 * Browser I/O helpers: decode, thumbnails, PNG/WebP encoding, downloads, ZIP.
 */

import { zipSync } from 'fflate';
import type { PixelImage } from '../core/types';
import { resizeImage, upscaleNearest } from '../core/image';
import { createCanvas, canvasToPixelImage, pixelImageToCanvas } from './canvas';

export interface DecodedImage {
  image: PixelImage;
  thumb: string;
  originalWidth: number;
  originalHeight: number;
}

const MAX_IMPORT_SIDE = 4096;

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
    return decodeSvgFile(file);
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const scale = Math.min(1, MAX_IMPORT_SIDE / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = canvasToPixelImage(canvas);
    return {
      image,
      thumb: makeThumbnail(image, 360),
      originalWidth,
      originalHeight,
    };
  } finally {
    bitmap.close();
  }
}

async function decodeSvgFile(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not render the SVG file.'));
      el.src = url;
    });
    let width = img.naturalWidth || 1024;
    let height = img.naturalHeight || 1024;
    const scale = Math.min(1, MAX_IMPORT_SIDE / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    const image = canvasToPixelImage(canvas);
    return { image, thumb: makeThumbnail(image, 360), originalWidth: width, originalHeight: height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function makeThumbnail(image: PixelImage, maxSide: number): string {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const thumb = resizeImage(image, w, h, 'box');
  return pixelImageToDataUrl(thumb);
}

export function pixelImageToDataUrl(image: PixelImage): string {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function pixelImageToBlob(
  image: PixelImage,
  format: 'png' | 'webp' | 'jpeg' = 'png',
  quality = 0.92,
): Promise<Blob> {
  const canvas = pixelImageToCanvas(image);
  // JPEG has no alpha channel: the browser flattens transparent pixels (to
  // black) when encoding. PNG/WebP keep transparency as before.
  const mime = format === 'webp' ? 'image/webp' : format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
      mime,
      quality,
    );
  });
}

export function scaledImage(image: PixelImage, scale: number): PixelImage {
  const s = Math.max(1, Math.round(scale));
  return s === 1 ? image : upscaleNearest(image, s);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | Blob | string;
}

export async function downloadZip(entries: ZipEntry[], filename: string): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (typeof entry.data === 'string') {
      files[entry.name] = new TextEncoder().encode(entry.data);
    } else if (entry.data instanceof Blob) {
      files[entry.name] = new Uint8Array(await entry.data.arrayBuffer());
    } else {
      files[entry.name] = entry.data;
    }
  }
  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), filename);
}

export function formatFilename(
  pattern: string,
  data: { name: string; width: number; height: number; index?: number; ext: string; date?: Date },
): string {
  const date = data.date ?? new Date();
  const safeName = data.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'pixelart';
  let out = pattern || '{name}-{width}x{height}';
  out = out
    .replace(/\{name\}/g, safeName)
    .replace(/\{width\}/g, String(data.width))
    .replace(/\{height\}/g, String(data.height))
    .replace(/\{index\}/g, String(data.index ?? 0).padStart(4, '0'))
    .replace(/\{date\}/g, date.toISOString().slice(0, 10));
  if (!out.toLowerCase().endsWith(`.${data.ext}`)) out += `.${data.ext}`;
  return out;
}

export function readFileAsText(file: File): Promise<string> {
  return file.text();
}

export async function readFilesFromDataTransfer(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry && entry.isDirectory) {
      const nested = await readDirectory(entry as FileSystemDirectoryEntry);
      files.push(...nested);
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

async function readDirectory(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = entry.createReader();
  const out: File[] = [];
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  let batch = await readBatch();
  while (batch.length > 0) {
    for (const child of batch) {
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileSystemFileEntry).file(resolve, reject),
        );
        out.push(file);
      } else if (child.isDirectory) {
        out.push(...(await readDirectory(child as FileSystemDirectoryEntry)));
      }
    }
    batch = await readBatch();
  }
  return out;
}

export function maskToDataUrl(mask: { width: number; height: number; data: Uint8Array }): string {
  const canvas = createCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];
export const VIDEO_EXTENSIONS = [
  'mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv',
  'avi', 'ts', 'mts', 'm2ts', 'wmv', 'flv',
  '3gp', '3g2', 'mpg', 'mpeg', 'mxf', 'vob', 'divx',
];

export function fileKind(file: File): 'image' | 'video' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.includes(ext) || file.type.startsWith('image/')) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext) || file.type.startsWith('video/')) return 'video';
  return null;
}
