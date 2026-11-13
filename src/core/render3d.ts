/**
 * Software 3D primitive renderer for the "3D object" node.
 *
 * Orthographic camera, z-buffer and Lambert shading. No DOM or WebGL
 * dependency, so the same render is produced in the app, in workers and in the
 * CLI. Primitives are generated procedurally and stay within roughly one world
 * unit so they frame consistently at any output size.
 */

import type { PixelImage } from './types';
import { createImage } from './image';
import { clamp01, parseHex } from './color';
import type { ImportedMesh } from './meshImport';

export type Primitive3D = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'pyramid';

export type ObjectBackground = 'transparent' | 'solid';

export interface Render3DParams {
  primitive: Primitive3D;
  color: string;
  background: ObjectBackground;
  backgroundColor: string;
  /** Standalone output size; ignored when an input image is connected. */
  width: number;
  height: number;
  zoom: number;
  scale: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  ambient: number;
  shading: number;
  lightAngle: number;
  antiAlias: number;
  /** Imported triangle mesh (overrides `primitive`). */
  mesh?: ImportedMesh;
  /** Display name of the imported mesh. */
  meshName?: string;
}

export const DEFAULT_OBJECT3D: Render3DParams = {
  primitive: 'cube',
  color: '#e6a23c',
  background: 'transparent',
  backgroundColor: '#111827',
  width: 512,
  height: 512,
  zoom: 1,
  scale: 1,
  rotationX: -18,
  rotationY: 32,
  rotationZ: 0,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  ambient: 0.28,
  shading: 0.85,
  lightAngle: -35,
  antiAlias: 1,
};

export const PRIMITIVES_3D: Array<{ value: Primitive3D; label: string }> = [
  { value: 'cube', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'cone', label: 'Cone' },
  { value: 'torus', label: 'Torus' },
  { value: 'pyramid', label: 'Pyramid' },
];

interface Vertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

interface Mesh {
  vertices: Vertex[];
  triangles: number[];
}

function v(
  x: number,
  y: number,
  z: number,
  nx = x,
  ny = y,
  nz = z,
): Vertex {
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x, y, z, nx: nx / len, ny: ny / len, nz: nz / len };
}

function quad(mesh: Mesh, a: number, b: number, c: number, d: number): void {
  mesh.triangles.push(a, b, c, a, c, d);
}

function cube(): Mesh {
  const h = 0.5;
  const faces: Array<Array<[number, number, number]>> = [
    // +Z, -Z
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
    // +X, -X
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
    // +Y, -Y
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
  ];
  const normals: Array<[number, number, number]> = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const mesh: Mesh = { vertices: [], triangles: [] };
  faces.forEach((corners, face) => {
    const [nx, ny, nz] = normals[face];
    const base = mesh.vertices.length;
    for (const [x, y, z] of corners) mesh.vertices.push(v(x, y, z, nx, ny, nz));
    quad(mesh, base, base + 1, base + 2, base + 3);
  });
  return mesh;
}

function sphere(lonSegments = 36, latSegments = 22): Mesh {
  const radius = 0.56;
  const mesh: Mesh = { vertices: [], triangles: [] };
  for (let lat = 0; lat <= latSegments; lat++) {
    const theta = (lat / latSegments) * Math.PI - Math.PI / 2;
    const cy = Math.sin(theta);
    const cr = Math.cos(theta);
    for (let lon = 0; lon <= lonSegments; lon++) {
      const phi = (lon / lonSegments) * Math.PI * 2;
      const x = Math.cos(phi) * cr;
      const z = Math.sin(phi) * cr;
      mesh.vertices.push(v(x * radius, cy * radius, z * radius, x, cy, z));
    }
  }
  const stride = lonSegments + 1;
  for (let lat = 0; lat < latSegments; lat++) {
    for (let lon = 0; lon < lonSegments; lon++) {
      const a = lat * stride + lon;
      const b = a + stride;
      if (lat > 0) mesh.triangles.push(a, b, a + 1);
      if (lat < latSegments - 1) mesh.triangles.push(a + 1, b, b + 1);
    }
  }
  return mesh;
}

function cylinder(segments = 36): Mesh {
  const r = 0.45;
  const h = 0.5;
  const mesh: Mesh = { vertices: [], triangles: [] };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const base = mesh.vertices.length;
    mesh.vertices.push(
      v(c0 * r, -h, s0 * r, c0, 0, s0),
      v(c0 * r, h, s0 * r, c0, 0, s0),
      v(c1 * r, h, s1 * r, c1, 0, s1),
      v(c1 * r, -h, s1 * r, c1, 0, s1),
    );
    quad(mesh, base, base + 1, base + 2, base + 3);
  }
  for (const [y, ny] of [[-h, -1], [h, 1]] as Array<[number, number]>) {
    const center = mesh.vertices.length;
    mesh.vertices.push(v(0, y, 0, 0, ny, 0));
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const first = mesh.vertices.length;
      mesh.vertices.push(
        v(Math.cos(a0) * r, y, Math.sin(a0) * r, 0, ny, 0),
        v(Math.cos(a1) * r, y, Math.sin(a1) * r, 0, ny, 0),
      );
      mesh.triangles.push(center, first, first + 1);
    }
  }
  return mesh;
}

function cone(segments = 36): Mesh {
  const r = 0.48;
  const h = 1.05;
  const baseY = -0.5;
  const mesh: Mesh = { vertices: [], triangles: [] };
  const slope = r / h;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const first = mesh.vertices.length;
    mesh.vertices.push(
      v(c0 * r, baseY, s0 * r, c0, slope, s0),
      v(c1 * r, baseY, s1 * r, c1, slope, s1),
      v(0, baseY + h, 0, (c0 + c1) / 2, slope, (s0 + s1) / 2),
    );
    mesh.triangles.push(first, first + 1, first + 2);
  }
  const center = mesh.vertices.length;
  mesh.vertices.push(v(0, baseY, 0, 0, -1, 0));
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const first = mesh.vertices.length;
    mesh.vertices.push(
      v(Math.cos(a0) * r, baseY, Math.sin(a0) * r, 0, -1, 0),
      v(Math.cos(a1) * r, baseY, Math.sin(a1) * r, 0, -1, 0),
    );
    mesh.triangles.push(center, first + 1, first);
  }
  return mesh;
}

function torus(majorSegments = 40, minorSegments = 18): Mesh {
  const R = 0.42;
  const r = 0.17;
  const mesh: Mesh = { vertices: [], triangles: [] };
  for (let i = 0; i <= majorSegments; i++) {
    const u = (i / majorSegments) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= minorSegments; j++) {
      const vv = (j / minorSegments) * Math.PI * 2;
      const cv = Math.cos(vv);
      const sv = Math.sin(vv);
      const x = (R + r * cv) * cu;
      const y = r * sv;
      const z = (R + r * cv) * su;
      mesh.vertices.push(v(x, y, z, cv * cu, sv, cv * su));
    }
  }
  const stride = minorSegments + 1;
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      mesh.triangles.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh;
}

function pyramid(): Mesh {
  const h = 0.48;
  const top = 0.55;
  const base: Array<[number, number]> = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const mesh: Mesh = { vertices: [], triangles: [] };
  const apex = v(0, top, 0, 0, 1, 0);
  const apexIndex = 0;
  mesh.vertices.push(apex);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = base[i];
    const [x1, z1] = base[(i + 1) % 4];
    const nx = (x0 + x1) / 2;
    const nz = (z0 + z1) / 2;
    const first = mesh.vertices.length;
    mesh.vertices.push(
      v(x0, -0.5, z0, nx, 0.55, nz),
      v(x1, -0.5, z1, nx, 0.55, nz),
    );
    mesh.triangles.push(apexIndex, first + 1, first);
  }
  const baseFirst = mesh.vertices.length;
  for (const [x, z] of base) mesh.vertices.push(v(x, -0.5, z, 0, -1, 0));
  quad(mesh, baseFirst, baseFirst + 3, baseFirst + 2, baseFirst + 1);
  return mesh;
}

function meshFor(primitive: Primitive3D): Mesh {
  switch (primitive) {
    case 'sphere':
      return sphere();
    case 'cylinder':
      return cylinder();
    case 'cone':
      return cone();
    case 'torus':
      return torus();
    case 'pyramid':
      return pyramid();
    case 'cube':
    default:
      return cube();
  }
}

function rotate(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
): [number, number, number] {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // Z, then Y, then X.
  const x1 = x * cz - y * sz;
  const y1 = x * sz + y * cz;
  const z1 = z;
  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;
  const x3 = x2;
  const y3 = y2 * cx - z2 * sx;
  const z3 = y2 * sx + z2 * cx;
  return [x3, y3, z3];
}

interface ProjectedVertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

function downsample(src: Uint8ClampedArray, sw: number, sh: number, factor: number): PixelImage {
  if (factor <= 1) return { width: sw, height: sh, data: src };
  const w = Math.max(1, Math.floor(sw / factor));
  const h = Math.max(1, Math.floor(sh / factor));
  const out = createImage(w, h);
  const count = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const si = ((y * factor + sy) * sw + (x * factor + sx)) * 4;
          const sa = src[si + 3] / 255;
          r += src[si] * sa;
          g += src[si + 1] * sa;
          b += src[si + 2] * sa;
          a += sa;
        }
      }
      const di = (y * w + x) * 4;
      if (a <= 0) continue;
      out.data[di] = r / a;
      out.data[di + 1] = g / a;
      out.data[di + 2] = b / a;
      out.data[di + 3] = (a / count) * 255;
    }
  }
  return out;
}

/** Build a normalized, smooth-shaded Mesh from an imported triangle mesh. */
function meshFromImported(imported: ImportedMesh): Mesh {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of imported.vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const s = 1 / span;
  const vertices: Vertex[] = imported.vertices.map((v) => ({
    x: (v[0] - cx) * s,
    y: (v[1] - cy) * s,
    z: (v[2] - cz) * s,
    nx: 0,
    ny: 0,
    nz: 0,
  }));
  const triangles = imported.triangles;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = vertices[triangles[i]];
    const b = vertices[triangles[i + 1]];
    const c = vertices[triangles[i + 2]];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const idx of [triangles[i], triangles[i + 1], triangles[i + 2]]) {
      const vtx = vertices[idx];
      if (vtx) {
        vtx.nx += nx;
        vtx.ny += ny;
        vtx.nz += nz;
      }
    }
  }
  for (const vtx of vertices) {
    const len = Math.hypot(vtx.nx, vtx.ny, vtx.nz) || 1;
    vtx.nx /= len;
    vtx.ny /= len;
    vtx.nz /= len;
  }
  return { vertices, triangles: triangles.slice() };
}

/** Render a single primitive with an orthographic camera. */
export function renderObject3D(
  width: number,
  height: number,
  params: Partial<Render3DParams> = {},
): PixelImage {
  const p: Render3DParams = { ...DEFAULT_OBJECT3D, ...params };
  const outW = Math.max(2, Math.round(width));
  const outH = Math.max(2, Math.round(height));
  const requested = p.antiAlias ? 2 : 1;
  const maxInternal = 1536;
  const factor = Math.max(
    1,
    Math.min(requested, Math.floor(maxInternal / Math.max(outW, outH)) || 1),
  );
  const w = outW * factor;
  const h = outH * factor;
  const report = new Uint8ClampedArray(w * h * 4);

  const solid = p.background === 'solid';
  if (solid) {
    const bg = parseHex(p.backgroundColor || '#111827');
    for (let i = 0; i < report.length; i += 4) {
      report[i] = bg.r;
      report[i + 1] = bg.g;
      report[i + 2] = bg.b;
      report[i + 3] = 255;
    }
  }

  const base = parseHex(p.color || '#e6a23c');
  const zoom = Math.max(0.25, Math.min(4, p.zoom || 1));
  const viewH = 2.2 / zoom;
  const scale = h / viewH;
  const mesh = p.mesh ? meshFromImported(p.mesh) : meshFor(p.primitive);
  const rx = ((p.rotationX || 0) * Math.PI) / 180;
  const ry = ((p.rotationY || 0) * Math.PI) / 180;
  const rz = ((p.rotationZ || 0) * Math.PI) / 180;
  const objectScale = Math.max(0.05, Math.min(4, p.scale || 1));
  const offsetX = (p.positionX || 0) * (viewH * 1.4);
  const offsetY = (p.positionY || 0) * (viewH * 1.4);
  const offsetZ = (p.positionZ || 0) * 1.4;
  const lightAngle = ((p.lightAngle ?? -35) * Math.PI) / 180;
  // Angle 0 puts the key light in front of the object; negative angles swing
  // it to the left, which reads well on most primitives.
  const lx = Math.sin(lightAngle) * 0.6;
  const ly = 0.7;
  const lz = Math.cos(lightAngle) * 0.6;
  const lLen = Math.hypot(lx, ly, lz) || 1;
  const lightX = lx / lLen;
  const lightY = ly / lLen;
  const lightZ = lz / lLen;
  const ambient = clamp01(p.ambient ?? 0.28);
  const shading = clamp01(p.shading ?? 0.85);

  const projected: ProjectedVertex[] = mesh.vertices.map((vertex) => {
    const [px, py, pz] = rotate(
      vertex.x * objectScale,
      vertex.y * objectScale,
      vertex.z * objectScale,
      rx,
      ry,
      rz,
    );
    const [nx, ny, nz] = rotate(vertex.nx, vertex.ny, vertex.nz, rx, ry, rz);
    return {
      x: w / 2 + (px + offsetX) * scale,
      y: h / 2 - (py + offsetY) * scale,
      z: pz + offsetZ,
      nx,
      ny,
      nz,
    };
  });

  const depth = new Float32Array(w * h);
  depth.fill(-Infinity);

  const shade = (nx: number, ny: number, nz: number): number => {
    const len = Math.hypot(nx, ny, nz) || 1;
    const dx = nx / len;
    const dy = ny / len;
    const dz = nz / len;
    const key = Math.max(0, dx * lightX + dy * lightY + dz * lightZ);
    // A small camera-facing fill keeps silhouette and front faces readable.
    const diffuse = Math.min(1, key + Math.max(0, dz) * 0.22);
    const lit = ambient + (1 - ambient) * diffuse;
    const rim = Math.pow(1 - Math.max(0, dz), 2) * 0.22;
    return clamp01(1 - shading * (1 - lit) + shading * rim);
  };

  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const ia = mesh.triangles[t];
    const ib = mesh.triangles[t + 1];
    const ic = mesh.triangles[t + 2];
    const a = projected[ia];
    const b = projected[ib];
    const c = projected[ic];
    if (!a || !b || !c) continue;
    // Backface culling: only faces whose average normal points at the camera.
    if ((a.nz + b.nz + c.nz) / 3 <= 0.001) continue;

    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-7) continue;

    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = a.z * w0 + b.z * w1 + c.z * w2;
        const di = y * w + x;
        if (z <= depth[di]) continue;
        depth[di] = z;
        const nx = a.nx * w0 + b.nx * w1 + c.nx * w2;
        const ny = a.ny * w0 + b.ny * w1 + c.ny * w2;
        const nz = a.nz * w0 + b.nz * w1 + c.nz * w2;
        const s = shade(nx, ny, nz);
        const pi = di * 4;
        report[pi] = base.r * s;
        report[pi + 1] = base.g * s;
        report[pi + 2] = base.b * s;
        report[pi + 3] = 255;
      }
    }
  }

  if (factor === 1) return { width: w, height: h, data: report };
  return downsample(report, w, h, factor);
}

/**
 * The screen-space centre of a 3D object (in pixels, before rotation is applied
 * around the origin). Used to show an off-screen indicator in the viewer.
 */
export function projectedObjectCenter(
  params: Render3DParams,
  width: number,
  height: number,
): { x: number; y: number } {
  const zoom = Math.max(0.25, Math.min(4, params.zoom || 1));
  const viewH = 2.2 / zoom;
  const offsetX = (params.positionX || 0) * (viewH * 1.4);
  const offsetY = (params.positionY || 0) * (viewH * 1.4);
  const scale = height / viewH;
  return { x: width / 2 + offsetX * scale, y: height / 2 - offsetY * scale };
}
