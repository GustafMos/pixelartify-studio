/**
 * Canvas-backed text layer renderer for the Text node.
 *
 * The core engine is DOM-free, so the Text node receives this renderer through
 * `EvaluateOptions.textRenderer`. The CLI (Node) passes nothing and the Text
 * node then simply passes its input through.
 */

import type { PixelImage } from '../core/types';
import { createCanvas, canvasToPixelImage } from './canvas';

const FONT_STACK: Record<string, string> = {
  monospace: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

export function renderTextLayer(
  params: Record<string, unknown>,
  width: number,
  height: number,
): PixelImage | null {
  const text = String(params.text ?? '');
  const canvas = createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fontKey = String(params.font ?? 'monospace');
  const size = Math.max(1, Number(params.size ?? 48));
  ctx.font = `${size}px ${FONT_STACK[fontKey] ?? FONT_STACK.monospace}`;
  ctx.textAlign = (String(params.align ?? 'center') as CanvasTextAlign) ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(params.alpha ?? 1)));

  const x = Number(params.x ?? 0.5) * canvas.width;
  const y = Number(params.y ?? 0.5) * canvas.height;

  const outline = Number(params.outline ?? 0);
  if (outline > 0 && text.length > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(1, outline * 2);
    ctx.strokeStyle = String(params.outlineColor ?? '#000000');
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = String(params.color ?? '#ffffff');
  ctx.fillText(text, x, y);

  return canvasToPixelImage(canvas);
}
