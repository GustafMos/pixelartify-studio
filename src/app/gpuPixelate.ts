/**
 * WebGL2 accelerator for the edge-aware pixel-art sampler.
 *
 * This mirrors `core/pixelate.ts` stage for stage so GPU and CPU output stay
 * close:
 *   1. offset pass      – 5×5 edge-alignment search per art pixel
 *   2. smoothing passes – the same grid smoothing the CPU applies
 *   3. sample pass      – area average + dominant-colour histogram
 *
 * If WebGL2, float render targets or the required texture sizes are missing,
 * every entry point returns null and the pipeline silently uses the CPU path.
 */

import type { PixelImage } from '../core/types';
import type { PixelateSourceOptions } from '../core/pixelate';
import { buildEdgeMap } from '../core/edges';
import { buildIntegral } from '../core/image';

const VERTEX = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const EDGE_SUM = `
float edgeSum(vec2 a, vec2 b) {
  int w = int(uSrcSize.x);
  int h = int(uSrcSize.y);
  int x0 = clamp(int(floor(a.x)), 0, w);
  int y0 = clamp(int(floor(a.y)), 0, h);
  int x1 = clamp(int(ceil(b.x)), 0, w);
  int y1 = clamp(int(ceil(b.y)), 0, h);
  if (x1 <= x0 || y1 <= y0) return 0.0;
  float s = texelFetch(uEdge, ivec2(x1, y1), 0).r
          - texelFetch(uEdge, ivec2(x0, y1), 0).r
          - texelFetch(uEdge, ivec2(x1, y0), 0).r
          + texelFetch(uEdge, ivec2(x0, y0), 0).r;
  return max(s, 0.0);
}
`;

const OFFSET_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uEdge;
uniform vec2 uSrcSize;
uniform vec2 uArtSize;
uniform float uAlign;

out vec4 outColor;
${EDGE_SUM}

void main() {
  vec2 cell = uSrcSize / uArtSize;
  float col = floor(gl_FragCoord.x);
  float row = uArtSize.y - 1.0 - floor(gl_FragCoord.y);
  vec2 center = (vec2(col, row) + 0.5) * cell;
  vec2 bestOffset = vec2(0.0);

  vec2 probe = cell * 0.9;
  if (edgeSum(center - probe, center + probe) > 1e-6) {
    float bestScore = 1e20;
    vec2 searchRange = cell * uAlign;
    vec2 halfWindow = cell * 0.49;
    for (int sy = -2; sy <= 2; sy++) {
      for (int sx = -2; sx <= 2; sx++) {
        vec2 off = vec2(float(sx), float(sy)) * 0.21 * searchRange;
        vec2 p = center + off;
        float edgeEnergy = edgeSum(p - halfWindow, p + halfWindow);
        vec2 frac = off / cell;
        float score = edgeEnergy / (halfWindow.x * halfWindow.y * 4.0)
                    + 0.055 * dot(frac, frac);
        if (score < bestScore) {
          bestScore = score;
          bestOffset = off;
        }
      }
    }
  }
  outColor = vec4(bestOffset, 0.0, 1.0);
}`;

const SMOOTH_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uOffset;
uniform vec2 uArtSize;

out vec4 outColor;

vec2 fetchOffset(ivec2 p) {
  ivec2 maxCoord = ivec2(uArtSize) - ivec2(1);
  return texelFetch(uOffset, clamp(p, ivec2(0), maxCoord), 0).xy;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 center = fetchOffset(p) * 4.0;
  vec2 axial = fetchOffset(p + ivec2(-1, 0))
             + fetchOffset(p + ivec2(1, 0))
             + fetchOffset(p + ivec2(0, -1))
             + fetchOffset(p + ivec2(0, 1));
  vec2 diag = fetchOffset(p + ivec2(-1, -1))
            + fetchOffset(p + ivec2(1, -1))
            + fetchOffset(p + ivec2(-1, 1))
            + fetchOffset(p + ivec2(1, 1));
  outColor = vec4((center + axial * 2.0 + diag) / 16.0, 0.0, 1.0);
}`;

const SAMPLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSrc;
uniform sampler2D uIntegral;
uniform sampler2D uOffset;
uniform vec2 uSrcSize;
uniform vec2 uArtSize;
uniform float uColorBlend;
uniform float uAlphaThreshold;

out vec4 outColor;

vec4 pre(vec4 s) {
  return vec4(s.rgb * s.a, s.a);
}

// Manual bilinear on the straight-alpha source, premultiplying each tap. This
// mirrors sampleBilinear() on the CPU; hardware linear filtering on an 8-bit
// texture biases the 5-bit histogram keys and changes dominant-colour picks.
vec4 sampleBilinear(vec2 pos) {
  vec2 hi = uSrcSize - vec2(1.0);
  vec2 f = clamp(pos, vec2(0.0), hi);
  vec2 base = floor(f);
  vec2 t = f - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = min(i0 + ivec2(1), ivec2(hi));
  vec4 s00 = pre(texelFetch(uSrc, i0, 0));
  vec4 s10 = pre(texelFetch(uSrc, ivec2(i1.x, i0.y), 0));
  vec4 s01 = pre(texelFetch(uSrc, ivec2(i0.x, i1.y), 0));
  vec4 s11 = pre(texelFetch(uSrc, i1, 0));
  return mix(mix(s00, s10, t.x), mix(s01, s11, t.x), t.y);
}

vec4 meanRect(vec2 a, vec2 b) {
  int w = int(uSrcSize.x);
  int h = int(uSrcSize.y);
  int x0 = clamp(int(floor(a.x)), 0, w);
  int y0 = clamp(int(floor(a.y)), 0, h);
  int x1 = clamp(int(ceil(b.x)), 0, w);
  int y1 = clamp(int(ceil(b.y)), 0, h);
  if (x1 <= x0 || y1 <= y0) return vec4(0.0);
  vec4 s = texelFetch(uIntegral, ivec2(x1, y1), 0)
         - texelFetch(uIntegral, ivec2(x0, y1), 0)
         - texelFetch(uIntegral, ivec2(x1, y0), 0)
         + texelFetch(uIntegral, ivec2(x0, y0), 0);
  if (s.a < 1e-6) return vec4(0.0);
  float area = float((x1 - x0) * (y1 - y0));
  return vec4(s.rgb / s.a, s.a / area);
}

void main() {
  vec2 cell = uSrcSize / uArtSize;
  float col = floor(gl_FragCoord.x);
  float row = uArtSize.y - 1.0 - floor(gl_FragCoord.y);
  ivec2 texel = ivec2(int(col), int(gl_FragCoord.y));
  vec2 offset = texelFetch(uOffset, texel, 0).xy;
  vec2 center = (vec2(col, row) + 0.5) * cell + offset;

  vec2 halfWindow = cell * 0.49;
  vec4 mean = meanRect(center - halfWindow, center + halfWindow);
  vec3 color = mean.rgb;

  if (uColorBlend > 0.01 && cell.x > 1.2 && cell.y > 1.2) {
    int gridSize = (cell.x * cell.y > 64.0) ? 5 : 3;
    vec3 binsColor[25];
    int binsCount[25];
    int binsKey[25];
    int bins = 0;
    for (int i = 0; i < 25; i++) {
      binsColor[i] = vec3(0.0);
      binsCount[i] = 0;
      binsKey[i] = -1;
    }

    vec2 rectSize = halfWindow * 2.0;
    for (int gy = 0; gy < 5; gy++) {
      if (gy >= gridSize) break;
      for (int gx = 0; gx < 5; gx++) {
        if (gx >= gridSize) break;
        vec2 pos = (center - halfWindow)
                 + (vec2(float(gx), float(gy)) + 0.5) / float(gridSize) * rectSize;
        vec4 s = sampleBilinear(pos);
        if (s.a < 0.0625) continue;
        vec3 rgb = s.rgb / max(s.a, 1e-4);
        ivec3 q = ivec3(floor(rgb * 255.0 + 0.5)) >> 3;
        int key = (q.r << 10) | (q.g << 5) | q.b;
        int found = -1;
        for (int k = 0; k < 25; k++) {
          if (binsKey[k] == key) {
            found = k;
            break;
          }
        }
        if (found < 0) {
          if (bins >= 25) continue;
          found = bins;
          binsKey[bins] = key;
          bins++;
        }
        binsColor[found] += rgb;
        binsCount[found]++;
      }
    }

    if (bins > 0) {
      int best = 0;
      for (int k = 1; k < bins; k++) {
        if (binsCount[k] > binsCount[best]) best = k;
      }
      vec3 dominant = binsColor[best] / float(max(binsCount[best], 1));
      color = mix(color, dominant, uColorBlend);
    }
  }

  float alpha = mean.a;
  if (alpha < uAlphaThreshold) alpha = 0.0;
  outColor = vec4(color, alpha);
}`;

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface GpuState {
  gl: WebGL2RenderingContext;
  offset: Program;
  smooth: Program;
  sample: Program;
  buffer: WebGLBuffer;
  maxTexture: number;
}

let state: GpuState | null | undefined;
let disabled = false;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log ?? 'unknown error'}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
  names: string[],
): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed.');
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

function getState(): GpuState | null {
  if (disabled) return null;
  if (state !== undefined) return state;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      disabled = true;
      state = null;
      return null;
    }
    // Offsets and the integral image live in float render targets.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      disabled = true;
      state = null;
      return null;
    }

    const offset = createProgram(gl, OFFSET_FRAGMENT, [
      'uEdge',
      'uSrcSize',
      'uArtSize',
      'uAlign',
    ]);
    const smooth = createProgram(gl, SMOOTH_FRAGMENT, ['uOffset', 'uArtSize']);
    const sample = createProgram(gl, SAMPLE_FRAGMENT, [
      'uSrc',
      'uIntegral',
      'uOffset',
      'uSrcSize',
      'uArtSize',
      'uColorBlend',
      'uAlphaThreshold',
    ]);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    state = {
      gl,
      offset,
      smooth,
      sample,
      buffer,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    return state;
  } catch (err) {
    console.warn('PixelArtify: GPU sampler unavailable, using CPU.', err);
    disabled = true;
    state = null;
    return null;
  }
}

export function gpuAvailable(): boolean {
  return getState() !== null;
}

/**
 * Below this art-pixel count the CPU sampler is faster: the GPU path still has
 * to build the integral/edge maps on the CPU and pay upload/readback costs.
 */
export const GPU_MIN_PIXELS = 48000;

function bindProgram(gl: WebGL2RenderingContext, gpu: GpuState, p: Program): void {
  gl.useProgram(p.program);
  const pos = gl.getAttribLocation(p.program, 'aPos');
  if (pos >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  }
}

function makeTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  data: ArrayBufferView | null,
  filter: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  return texture;
}

function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function gpuPixelate(
  src: PixelImage,
  options: PixelateSourceOptions,
): PixelImage | null {
  const gpu = getState();
  if (!gpu) return null;
  const artW = Math.max(2, Math.round(options.artWidth));
  const artH = Math.max(2, Math.round(options.artHeight));
  // Setup + readback dominates for small images; the CPU is faster there.
  if (artW * artH < GPU_MIN_PIXELS) return null;
  if (
    src.width + 1 > gpu.maxTexture ||
    src.height + 1 > gpu.maxTexture ||
    artW > gpu.maxTexture ||
    artH > gpu.maxTexture
  ) {
    return null;
  }

  const { gl } = gpu;
  const settings = options.settings;
  const useEdges = settings.edgeAware && settings.alignment > 0.001;
  const passes = Math.max(0, Math.min(4, Math.round(settings.gridPasses)));
  const textures: WebGLTexture[] = [];
  let framebuffer: WebGLFramebuffer | null = null;

  try {
    const integral = buildIntegral(src);
    const stride = src.width + 1;
    const count = stride * (src.height + 1);
    const integralData = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      integralData[i * 4] = integral.r[i] / 255;
      integralData[i * 4 + 1] = integral.g[i] / 255;
      integralData[i * 4 + 2] = integral.b[i] / 255;
      integralData[i * 4 + 3] = integral.a[i];
    }

    const edges = useEdges
      ? buildEdgeMap(src, {
          sensitivity: Math.max(0, Math.min(1, settings.edgeThreshold)),
          chroma: true,
        })
      : null;
    const edgeData = edges ? new Float32Array(edges.integral) : new Float32Array([0]);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);

    const srcTex = makeTexture(
      gl,
      src.width,
      src.height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      src.data,
      gl.NEAREST,
    );
    textures.push(srcTex);

    const integralTex = makeTexture(
      gl,
      src.width + 1,
      src.height + 1,
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      integralData,
      gl.NEAREST,
    );
    textures.push(integralTex);

    const edgeTex = makeTexture(
      gl,
      edges ? src.width + 1 : 1,
      edges ? src.height + 1 : 1,
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      edgeData,
      gl.NEAREST,
    );
    textures.push(edgeTex);

    const offsetA = makeTexture(gl, artW, artH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
    const offsetB = makeTexture(gl, artW, artH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
    textures.push(offsetA, offsetB);

    const renderTex = makeTexture(
      gl,
      artW,
      artH,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
      gl.NEAREST,
    );
    textures.push(renderTex);

    framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;

    const attach = (texture: WebGLTexture): boolean => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, artW, artH);

    // Pass 1: per-cell edge alignment offsets.
    if (!attach(offsetA)) return null;
    bindProgram(gl, gpu, gpu.offset);
    const off = gpu.offset.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, edgeTex);
    gl.uniform1i(off.uEdge, 0);
    gl.uniform2f(off.uSrcSize, src.width, src.height);
    gl.uniform2f(off.uArtSize, artW, artH);
    gl.uniform1f(off.uAlign, useEdges ? settings.alignment : 0);
    drawFullscreen(gl);

    // Pass 2..n: identical 3×3 smoothing as smoothOffsets() on the CPU.
    let current = offsetA;
    let spare = offsetB;
    if (useEdges) {
      bindProgram(gl, gpu, gpu.smooth);
      for (let i = 0; i < passes; i++) {
        if (!attach(spare)) return null;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, current);
        gl.uniform1i(gpu.smooth.uniforms.uOffset, 0);
        gl.uniform2f(gpu.smooth.uniforms.uArtSize, artW, artH);
        drawFullscreen(gl);
        const swap = current;
        current = spare;
        spare = swap;
      }
    }

    // Final pass: area average + dominant colour.
    if (!attach(renderTex)) return null;
    bindProgram(gl, gpu, gpu.sample);
    const smp = gpu.sample.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(smp.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, integralTex);
    gl.uniform1i(smp.uIntegral, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, current);
    gl.uniform1i(smp.uOffset, 2);
    gl.uniform2f(smp.uSrcSize, src.width, src.height);
    gl.uniform2f(smp.uArtSize, artW, artH);
    gl.uniform1f(smp.uColorBlend, Math.max(0, Math.min(1, settings.colorBlend)));
    gl.uniform1f(smp.uAlphaThreshold, Math.max(0, Math.min(1, settings.alphaThreshold)));
    drawFullscreen(gl);

    const raw = new Uint8Array(artW * artH * 4);
    gl.readPixels(0, 0, artW, artH, gl.RGBA, gl.UNSIGNED_BYTE, raw);

    const out = new Uint8ClampedArray(artW * artH * 4);
    const rowBytes = artW * 4;
    for (let y = 0; y < artH; y++) {
      const srcRow = (artH - 1 - y) * rowBytes;
      out.set(raw.subarray(srcRow, srcRow + rowBytes), y * rowBytes);
    }
    return { width: artW, height: artH, data: out };
  } catch (err) {
    console.warn('PixelArtify: GPU sampler failed, using CPU.', err);
    disabled = true;
    return null;
  } finally {
    for (const texture of textures) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
