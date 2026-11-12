import type { PixelImage } from '../core/types';

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function canvasToPixelImage(canvas: HTMLCanvasElement): PixelImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data.data) };
}

export function pixelImageToCanvas(image: PixelImage): HTMLCanvasElement {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function drawPixelImage(
  ctx: CanvasRenderingContext2D,
  image: PixelImage,
  dx = 0,
  dy = 0,
  dw = image.width,
  dh = image.height,
  smooth = false,
): void {
  const canvas = pixelImageToCanvas(image);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(canvas, dx, dy, dw, dh);
}
