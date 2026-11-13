/**
 * 2D shape generator for the "Shape 2D" node.
 *
 * Pure TypeScript so it matches in the browser, workers and CLI. Shapes are
 * rasterized with signed-distance fields for crisp edges and optional
 * anti-aliasing, filled with solid/linear/radial gradients.
 */

import type { PixelImage } from './types';
import { createImage } from './image';
import { mixRgb, parseHex } from './color';

export type Shape2DType = 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'star' | 'line';
export type Shape2DFill = 'solid' | 'linear' | 'radial';

export interface Shape2DParams {
  shape: Shape2DType;
  fill: Shape2DFill;
  colorA: string;
  colorB: string;
  /** Linear gradient direction in degrees. */
  gradientAngle: number;
  /** Number of sides (polygon) or points (star). */
  sides: number;
  /** Star inner radius as a fraction of the outer radius. */
  innerRatio: number;
  /** Line thickness in art pixels (for the line shape). */
  lineWidth: number;
  /** Optional outline width in art pixels (0 = none). */
  strokeWidth: number;
  strokeColor: string;
  /** Center offset, normalized to -1..1 of the frame. */
  positionX: number;
  positionY: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Scale multiplier (relative to the frame short side). */
  scale: number;
  /** Standalone output size; ignored when composited over an input. */
  width: number;
  height: number;
  antiAlias: number;
}

export const DEFAULT_SHAPE2D: Shape2DParams = {
  shape: 'circle',
  fill: 'linear',
  colorA: '#4cc9f0',
  colorB: '#b5179e',
  gradientAngle: 45,
  sides: 6,
  innerRatio: 0.5,
  lineWidth: 4,
  strokeWidth: 0,
  strokeColor: '#000000',
  positionX: 0,
  positionY: 0,
  rotation: 0,
  scale: 1,
  width: 512,
  height: 512,
  antiAlias: 1,
};

export const SHAPE2D_TYPES: Array<{ value: Shape2DType; label: string }> = [
  { value: 'circle', label: 'Circle' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'polygon', label: 'Polygon (n-gon)' },
  { value: 'star', label: 'Star' },
  { value: 'line', label: 'Line' },
];

export const SHAPE2D_FILLS: Array<{ value: Shape2DFill; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial gradient' },
];

interface Vec2 {
  x: number;
  y: number;
}

function rotatePoint(x: number, y: number, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

function regularPolygonVertices(n: number, radius: number, rotation: number): Vec2[] {
  const out: Vec2[] = [];
  const rad = (rotation * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push(rotatePoint(Math.cos(a) * radius, Math.sin(a) * radius, rad));
  }
  return out;
}

function starVertices(n: number, outer: number, inner: number, rotation: number): Vec2[] {
  const out: Vec2[] = [];
  const rad = (rotation * Math.PI) / 180;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    out.push(rotatePoint(Math.cos(a) * r, Math.sin(a) * r, rad));
  }
  return out;
}

function rectVertices(hw: number, hh: number, rotation: number): Vec2[] {
  const rad = (rotation * Math.PI) / 180;
  return [
    rotatePoint(-hw, -hh, rad),
    rotatePoint(hw, -hh, rad),
    rotatePoint(hw, hh, rad),
    rotatePoint(-hw, hh, rad),
  ];
}

function pointInPolygon(p: Vec2, verts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i];
    const b = verts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polygonSdf(p: Vec2, verts: Vec2[]): number {
  let minDist = Infinity;
  for (let i = 0; i < verts.length; i++) {
    minDist = Math.min(minDist, distanceToSegment(p, verts[i], verts[(i + 1) % verts.length]));
  }
  return pointInPolygon(p, verts) ? -minDist : minDist;
}

export function renderShape2D(width: number, height: number, params: Partial<Shape2DParams> = {}): PixelImage {
  const p: Shape2DParams = { ...DEFAULT_SHAPE2D, ...params };
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createImage(w, h);

  const a = parseHex(p.colorA || '#000000');
  const b = parseHex(p.colorB || p.colorA || '#000000');
  const stroke = parseHex(p.strokeColor || '#000000');
  const R = Math.max(2, Math.min(w, h) * 0.38 * Math.max(0.05, p.scale || 1));
  const cx = w * (0.5 + Math.max(-1, Math.min(1, p.positionX || 0)) * 0.5);
  const cy = h * (0.5 + Math.max(-1, Math.min(1, p.positionY || 0)) * 0.5);
  const rotation = p.rotation || 0;
  const gradAngle = ((p.gradientAngle || 0) * Math.PI) / 180;
  const gradCos = Math.cos(gradAngle);
  const gradSin = Math.sin(gradAngle);
  const sides = Math.max(3, Math.round(p.sides || 6));
  const innerRatio = Math.max(0.2, Math.min(0.95, p.innerRatio || 0.5));
  const strokeWidth = Math.max(0, p.strokeWidth || 0);
  const lineHalf = R;
  const lineHalfT = Math.max(0.5, (p.lineWidth || 4) / 2);
  const aa = p.antiAlias > 0.5;

  const verts: Vec2[] =
    p.shape === 'rectangle'
      ? rectVertices(R * 1.1, R * 0.72, rotation)
      : p.shape === 'triangle'
        ? regularPolygonVertices(3, R, rotation)
        : p.shape === 'polygon'
          ? regularPolygonVertices(sides, R, rotation)
          : p.shape === 'star'
            ? starVertices(sides, R, R * innerRatio, rotation)
            : [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const pt = { x: px, y: py };

      let d: number;
      if (p.shape === 'circle') {
        d = Math.hypot(px, py) - R;
      } else if (p.shape === 'line') {
        d = lineSdf(pt, lineHalf, lineHalfT);
      } else {
        d = polygonSdf(pt, verts);
      }

      let t = 0.5;
      if (p.fill === 'linear') {
        t = 0.5 + (px * gradCos + py * gradSin) / Math.max(1, R * 2);
      } else if (p.fill === 'radial') {
        t = Math.max(0, Math.min(1, Math.hypot(px, py) / Math.max(1, R)));
      }
      t = Math.max(0, Math.min(1, t));
      const fillRgb =
        p.fill === 'solid'
          ? { r: a.r, g: a.g, b: a.b }
          : mixRgb({ r: a.r, g: a.g, b: a.b }, { r: b.r, g: b.g, b: b.b }, t);

      let rgb = { r: 0, g: 0, b: 0 };
      let alpha = 0;

      if (d <= 0) {
        rgb = fillRgb;
        alpha = 255;
      } else if (aa) {
        const coverage = Math.max(0, Math.min(1, 1 - d));
        if (coverage > 0) {
          rgb = fillRgb;
          alpha = Math.round(coverage * 255);
        }
      }

      if (strokeWidth > 0) {
        const sd = Math.abs(d) - strokeWidth / 2;
        const strokeCoverage = aa ? Math.max(0, Math.min(1, 1 - sd)) : sd <= 0 ? 1 : 0;
        if (strokeCoverage > 0) {
          const aStroke = Math.round(strokeCoverage * 255);
          rgb = mixRgb(rgb, { r: stroke.r, g: stroke.g, b: stroke.b }, aStroke / 255);
          alpha = Math.max(alpha, aStroke);
        }
      }

      const i = (y * w + x) * 4;
      out.data[i] = rgb.r;
      out.data[i + 1] = rgb.g;
      out.data[i + 2] = rgb.b;
      out.data[i + 3] = alpha;
    }
  }
  return out;
}

function lineSdf(p: Vec2, half: number, halfT: number): number {
  const dx = Math.abs(p.x) - half;
  const qx = Math.max(dx, 0);
  const qy = Math.abs(p.y) - halfT;
  return Math.hypot(qx, Math.max(qy, 0)) + Math.min(Math.max(dx, qy), 0);
}
