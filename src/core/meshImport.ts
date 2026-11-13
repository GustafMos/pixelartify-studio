/**
 * Static triangle-mesh import for the 3D object node.
 *
 * Parses OBJ (Wavefront) and ASCII FBX into a normalized triangle mesh. Binary
 * FBX and GLTF are not yet supported; the node falls back to its primitives
 * when the file is unreadable.
 */

export interface ImportedMesh {
  /** Vertex positions, [x, y, z]. */
  vertices: number[][];
  /** Triangle indices (flat triples). */
  triangles: number[];
}

export function parseMesh(fileName: string, text: string): ImportedMesh | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.obj')) return parseOBJ(text);
  if (lower.endsWith('.fbx')) return parseFBX(text);
  if (lower.endsWith('.gltf')) return parseGLTF(text);
  // Best effort: try OBJ first, then FBX.
  return parseOBJ(text) ?? parseFBX(text);
}

export function parseOBJ(text: string): ImportedMesh | null {
  const vertices: number[][] = [];
  const triangles: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];
    if (cmd === 'v') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if ([x, y, z].some((n) => !Number.isFinite(n))) continue;
      vertices.push([x, y, z]);
    } else if (cmd === 'f') {
      const indices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const idx = parseInt(parts[i].split('/')[0], 10);
        if (Number.isFinite(idx)) indices.push(idx > 0 ? idx - 1 : vertices.length + idx);
      }
      for (let i = 1; i < indices.length - 1; i++) {
        triangles.push(indices[0], indices[i], indices[i + 1]);
      }
    }
  }
  return vertices.length > 0 && triangles.length > 0 ? { vertices, triangles } : null;
}

export function parseFBX(text: string): ImportedMesh | null {
  // ASCII FBX only. Extract `Vertices: *N { a: ... }` and
  // `PolygonVertexIndex: *N { a: ... }`.
  const readArray = (name: string): number[] | null => {
    const re = new RegExp(`${name}:\\s*\\*\\d+\\s*\\{([^}]*)\\}`);
    const m = text.match(re);
    if (!m) return null;
    const raw = m[1].replace(/[a-zA-Z:]+/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
    const out: number[] = [];
    for (const s of raw) {
      const n = Number(s);
      if (Number.isFinite(n)) out.push(n);
    }
    return out;
  };

  const verts = readArray('Vertices');
  const polyIdx = readArray('PolygonVertexIndex');
  if (!verts || !polyIdx || verts.length < 3) return null;

  const vertices: number[][] = [];
  for (let i = 0; i + 2 < verts.length; i += 3) {
    vertices.push([verts[i], verts[i + 1], verts[i + 2]]);
  }

  const triangles: number[] = [];
  let face: number[] = [];
  for (const idx of polyIdx) {
    if (idx < 0) {
      // Negative index terminates the polygon; the value is ~index.
      face.push(~idx);
      for (let i = 1; i < face.length - 1; i++) {
        triangles.push(face[0], face[i], face[i + 1]);
      }
      face = [];
    } else {
      face.push(idx);
    }
  }
  if (face.length >= 3) {
    for (let i = 1; i < face.length - 1; i++) {
      triangles.push(face[0], face[i], face[i + 1]);
    }
  }
  return vertices.length > 0 && triangles.length > 0 ? { vertices, triangles } : null;
}

export function parseGLTF(text: string): ImportedMesh | null {
  try {
    const gltf = JSON.parse(text);
    const vertices: number[][] = [];
    const triangles: number[] = [];
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const posAccessor = gltf.accessors?.[primitive.attributes?.POSITION];
        const indexAccessor = gltf.accessors?.[primitive.indices];
        const bufferViews: unknown[] = gltf.bufferViews ?? [];
        const buffers: Array<{ uri?: string; byteLength?: number }> = gltf.buffers ?? [];

        const decode = (accessor: unknown): number[] | null => {
          const acc = accessor as { bufferView?: number; count?: number; componentType?: number; type?: string };
          if (!acc || acc.bufferView === undefined) return null;
          const view = bufferViews[acc.bufferView] as { buffer?: number; byteOffset?: number } | undefined;
          if (!view) return null;
          const buf = buffers[view.buffer ?? 0];
          const uri = buf?.uri ?? '';
          if (!uri.startsWith('data:')) return null;
          const b64 = uri.slice(uri.indexOf(',') + 1);
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const offset = view.byteOffset ?? 0;
          const count = acc.count ?? 0;
          const out: number[] = [];
          const comp = acc.componentType ?? 5126;
          const isFloat = comp === 5126;
          const comps = acc.type === 'VEC3' ? 3 : 1;
          for (let i = 0; i < count * comps; i++) {
            const o = offset + i * (isFloat ? 4 : 2);
            const v = isFloat
              ? new DataView(bytes.buffer, bytes.byteOffset + o, 4).getFloat32(0, true)
              : new DataView(bytes.buffer, bytes.byteOffset + o, 2).getInt16(0, true);
            out.push(v);
          }
          return out;
        };

        const positions = decode(posAccessor);
        const indices = decode(indexAccessor);
        if (!positions || positions.length < 3) continue;
        const base = vertices.length;
        for (let i = 0; i + 2 < positions.length; i += 3) {
          vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
        }
        if (indices && indices.length > 0) {
          for (let i = 0; i + 2 < indices.length; i += 3) {
            triangles.push(base + indices[i], base + indices[i + 1], base + indices[i + 2]);
          }
        } else {
          for (let i = 0; i + 2 < positions.length / 3 * 3; i += 3) {
            triangles.push(base + i, base + i + 1, base + i + 2);
          }
        }
      }
    }
    return vertices.length > 0 && triangles.length > 0 ? { vertices, triangles } : null;
  } catch {
    return null;
  }
}
