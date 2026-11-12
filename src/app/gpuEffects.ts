/**
 * WebGL2 effect passes for single-pass pre/post effects.
 *
 * Supported today:
 *   pre  – colorCorrect, posterize, grain
 *   post – outline, grain, scanlines, vignette, chromatic
 *
 * Blur-based and painterly effects still run on the CPU. Callers should use
 * supportsGpuEffects() before handing a whole effect list to this module.
 */

import type { PixelImage } from '../core/types';
import type { AcceleratedEffectOp, EffectContext } from '../core/preprocess';
import { clamp01, parseHex } from '../core/color';

const PRE_SUPPORTED = new Set(['colorCorrect', 'posterize', 'grain']);
const POST_SUPPORTED = new Set(['outline', 'grain', 'scanlines', 'vignette', 'chromatic']);

export type EffectStage = 'preprocess' | 'postprocess';

interface EffectOp extends AcceleratedEffectOp {}

const VERTEX = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSrc;
uniform vec2 uSize;
uniform int uOp;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uColor;

out vec4 outColor;

vec4 pre(vec4 s) {
  return vec4(s.rgb * s.a, s.a);
}

vec4 sampleBilinear(vec2 pos) {
  vec2 hi = uSize - vec2(1.0);
  vec2 f = clamp(pos, vec2(0.0), hi);
  vec2 base = floor(f);
  vec2 t = f - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = min(i0 + ivec2(1), ivec2(hi));
  vec4 s00 = pre(texelFetch(uSrc, i0, 0));
  vec4 s10 = pre(texelFetch(uSrc, ivec2(i1.x, i0.y), 0));
  vec4 s01 = pre(texelFetch(uSrc, ivec2(i0.x, i1.y), 0));
  vec4 s11 = pre(texelFetch(uSrc, i1, 0));
  vec4 s = mix(mix(s00, s10, t.x), mix(s01, s11, t.x), t.y);
  if (s.a <= 1e-6) return vec4(0.0);
  return vec4(s.rgb / s.a, s.a);
}

uint hash2(int x, int y, int seed) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(seed) * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hash01(int x, int y, int seed) {
  return float(hash2(x, y, seed)) / 4294967296.0;
}

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 colorCorrect(vec3 c) {
  float exposure = uA.x;
  float contrast = uA.y;
  float brightness = uA.z;
  float saturation = uA.w;
  float gamma = uB.x;
  float hue = radians(uB.y);
  float temperature = clamp(uB.z, -1.0, 1.0);
  float tint = clamp(uB.w, -1.0, 1.0);

  float ef = pow(2.0, exposure);
  float rg = ef * max(0.05, 1.0 + temperature * 0.28 + tint * 0.06);
  float gg = ef * max(0.05, 1.0 - tint * 0.22);
  float bg = ef * max(0.05, 1.0 - temperature * 0.28 + tint * 0.06);
  vec3 lin = srgbToLinear(c);
  c = linearToSrgb(vec3(lin.r * rg, lin.g * gg, lin.b * bg));

  float ca = cos(hue);
  float sa = sin(hue);
  float h0 = 0.213 + ca * 0.787 - sa * 0.213;
  float h1 = 0.715 - ca * 0.715 - sa * 0.715;
  float h2 = 0.072 - ca * 0.072 + sa * 0.928;
  float h3 = 0.213 - ca * 0.213 + sa * 0.143;
  float h4 = 0.715 + ca * 0.285 + sa * 0.14;
  float h5 = 0.072 - ca * 0.072 - sa * 0.283;
  float h6 = 0.213 - ca * 0.213 - sa * 0.787;
  float h7 = 0.715 - ca * 0.715 + sa * 0.715;
  float h8 = 0.072 + ca * 0.928 + sa * 0.072;
  vec3 hc = vec3(
    h0 * c.r + h1 * c.g + h2 * c.b,
    h3 * c.r + h4 * c.g + h5 * c.b,
    h6 * c.r + h7 * c.g + h8 * c.b
  );
  c = hc;
  c = (c - 0.5) * contrast + 0.5 + brightness;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(luma) + (c - luma) * saturation;
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / max(0.01, gamma)));
  return clamp(c, 0.0, 1.0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 src = texelFetch(uSrc, p, 0);

  if (uOp == 0) {
    if (src.a > 0.0) src.rgb = colorCorrect(src.rgb);
  } else if (uOp == 1) {
    float levels = max(2.0, uA.x);
    float strength = clamp(uA.y, 0.0, 1.0);
    vec3 q = floor(src.rgb * (levels - 1.0) + 0.5) / (levels - 1.0);
    src.rgb = mix(src.rgb, q, strength);
  } else if (uOp == 2) {
    float amount = uA.x;
    float size = max(0.5, uA.y);
    int seed = int(uA.w);
    ivec2 cell = ivec2(floor(vec2(p) / size));
    if (uA.z > 0.5) {
      float n = (hash01(cell.x, cell.y, seed) - 0.5) * amount;
      src.rgb += vec3(n);
    } else {
      src.rgb += vec3(
        (hash01(cell.x, cell.y, seed) - 0.5) * amount,
        (hash01(cell.x, cell.y, seed + 1) - 0.5) * amount,
        (hash01(cell.x, cell.y, seed + 2) - 0.5) * amount
      );
    }
    src.rgb = clamp(src.rgb, 0.0, 1.0);
  } else if (uOp == 3) {
    float spacing = max(2.0, uA.x);
    float strength = clamp(uA.y, 0.0, 1.0);
    float phase = mod(float(p.y), spacing) / spacing;
    float darken = 1.0 - strength * (0.5 + 0.5 * cos(phase * 6.28318530718));
    src.rgb *= darken;
  } else if (uOp == 4) {
    float amount = clamp(uA.x, 0.0, 1.0);
    float radius = clamp(uA.y, 0.0, 1.0);
    vec2 c = uSize * 0.5;
    float maxR = length(c);
    float r = length((vec2(p) - c) / maxR);
    float t = clamp((r - radius) / max(0.001, 1.0 - radius), 0.0, 1.0);
    src.rgb *= 1.0 - amount * t * t;
  } else if (uOp == 5) {
    float amount = max(0.0, uA.x);
    if (amount >= 0.01) {
      vec4 r = sampleBilinear(vec2(p) + vec2(-amount, 0.0));
      vec4 g = sampleBilinear(vec2(p));
      vec4 b = sampleBilinear(vec2(p) + vec2(amount, 0.0));
      src.rgb = vec3(r.r, g.g, b.b);
      src.a = max(r.a, max(g.a, b.a));
    }
  } else if (uOp == 6) {
    float thickness = max(1.0, uA.x);
    float opacity = clamp(uA.y, 0.0, 1.0);
    bool inner = uA.z > 0.5;
    float alpha = src.a;
    bool opaque = alpha > (8.0 / 255.0);
    if (!inner && !opaque) {
      bool edge = false;
      int t = int(min(thickness, 8.0));
      for (int oy = -8; oy <= 8; oy++) {
        if (abs(oy) > t) continue;
        for (int ox = -8; ox <= 8; ox++) {
          if (abs(ox) > t) continue;
          if (ox * ox + oy * oy > t * t) continue;
          ivec2 q = p + ivec2(ox, oy);
          if (q.x < 0 || q.y < 0 || q.x >= int(uSize.x) || q.y >= int(uSize.y)) continue;
          if (texelFetch(uSrc, q, 0).a > (8.0 / 255.0)) {
            edge = true;
            break;
          }
        }
        if (edge) break;
      }
      if (edge) {
        src.rgb = uColor.rgb;
        src.a = opacity;
      }
    } else if (inner && opaque) {
      bool edge = false;
      int t = int(min(thickness, 8.0));
      for (int r = 1; r <= 8; r++) {
        if (r > t) break;
        ivec2 ql = p + ivec2(-r, 0);
        ivec2 qr = p + ivec2(r, 0);
        ivec2 qu = p + ivec2(0, -r);
        ivec2 qd = p + ivec2(0, r);
        if (ql.x < 0 || qr.x >= int(uSize.x) || qu.y < 0 || qd.y >= int(uSize.y)) {
          edge = true;
          break;
        }
        if (texelFetch(uSrc, ql, 0).a <= (8.0 / 255.0) ||
            texelFetch(uSrc, qr, 0).a <= (8.0 / 255.0) ||
            texelFetch(uSrc, qu, 0).a <= (8.0 / 255.0) ||
            texelFetch(uSrc, qd, 0).a <= (8.0 / 255.0)) {
          edge = true;
          break;
        }
      }
      if (edge) src.rgb = mix(src.rgb, uColor.rgb, opacity);
    }
  }

  outColor = clamp(src, 0.0, 1.0);
}`;

interface GpuState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  buffer: WebGLBuffer;
  maxTexture: number;
}

let state: GpuState | null | undefined;
let disabled = false;

/** Small images are faster on the CPU. */
export const GPU_MIN_EFFECT_PIXELS = 40_000;

export function gpuEffectsAvailable(): boolean {
  return getState() !== null;
}

export function supportsGpuEffects(stage: EffectStage, ops: Array<{ type?: string; enabled?: boolean }>): boolean {
  const enabled = ops.filter((op) => op.enabled !== false && op.type);
  if (enabled.length === 0) return false;
  const set = stage === 'preprocess' ? PRE_SUPPORTED : POST_SUPPORTED;
  return enabled.every((op) => set.has(op.type as string));
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Effect shader compile failed: ${log ?? 'unknown error'}`);
  }
  return shader;
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
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
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
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['uSrc', 'uSize', 'uOp', 'uA', 'uB', 'uColor']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    state = {
      gl,
      program,
      uniforms,
      buffer,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    return state;
  } catch (err) {
    console.warn('PixelArtify: GPU effects unavailable, using CPU.', err);
    disabled = true;
    state = null;
    return null;
  }
}

function texture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data: ArrayBufferView | null,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return tex;
}

function opUniforms(
  op: EffectOp,
  image: PixelImage,
  ctx: EffectContext,
  stage: EffectStage,
): { op: number; a: [number, number, number, number]; b: [number, number, number, number]; color: [number, number, number, number] } {
  const p = op.params ?? {};
  const scale =
    stage === 'preprocess'
      ? Math.max(0.05, image.width / Math.max(1, ctx.artWidth))
      : 1;
  switch (op.type) {
    case 'colorCorrect':
      return {
        op: 0,
        a: [p.exposure ?? 0, p.contrast ?? 1, p.brightness ?? 0, p.saturation ?? 1],
        b: [p.gamma ?? 1, p.hueShift ?? 0, p.temperature ?? 0, p.tint ?? 0],
        color: [0, 0, 0, 0],
      };
    case 'posterize':
      return {
        op: 1,
        a: [Math.max(2, Math.min(32, Math.round(p.levels ?? 8))), clamp01(p.strength ?? 1), 0, 0],
        b: [0, 0, 0, 0],
        color: [0, 0, 0, 0],
      };
    case 'grain':
      return {
        op: 2,
        a: [
          clamp01(p.amount ?? 0.12),
          Math.max(0.5, (p.scale ?? 1) * scale),
          (p.monochrome ?? 1) > 0.5 ? 1 : 0,
          Math.round(p.seed ?? 7),
        ],
        b: [0, 0, 0, 0],
        color: [0, 0, 0, 0],
      };
    case 'scanlines':
      return {
        op: 3,
        a: [Math.max(2, Math.round((p.spacing ?? 3) * scale)), clamp01(p.strength ?? 0.25), 0, 0],
        b: [0, 0, 0, 0],
        color: [0, 0, 0, 0],
      };
    case 'vignette':
      return {
        op: 4,
        a: [clamp01(p.amount ?? 0.35), clamp01(p.radius ?? 0.65), 0, 0],
        b: [0, 0, 0, 0],
        color: [0, 0, 0, 0],
      };
    case 'chromatic':
      return {
        op: 5,
        a: [Math.max(0, (p.amount ?? 0.5) * scale), 0, 0, 0],
        b: [0, 0, 0, 0],
        color: [0, 0, 0, 0],
      };
    case 'outline': {
      const c = parseHex(op.color ?? '#101018');
      return {
        op: 6,
        a: [Math.max(1, Math.round((p.thickness ?? 1) * scale)), clamp01(p.opacity ?? 1), (p.inner ?? 0) > 0.5 ? 1 : 0, 0],
        b: [0, 0, 0, 0],
        color: [c.r / 255, c.g / 255, c.b / 255, 1],
      };
    }
    default:
      return { op: -1, a: [0, 0, 0, 0], b: [0, 0, 0, 0], color: [0, 0, 0, 0] };
  }
}

export function applyGpuEffects(
  stage: EffectStage,
  input: PixelImage,
  ops: EffectOp[],
  ctx: EffectContext,
): PixelImage | null {
  const enabled = ops.filter((op) => op.enabled !== false && op.type);
  if (enabled.length === 0 || !supportsGpuEffects(stage, ops)) return null;
  if (input.width * input.height < GPU_MIN_EFFECT_PIXELS) return null;
  const gpu = getState();
  if (!gpu) return null;
  if (input.width > gpu.maxTexture || input.height > gpu.maxTexture) return null;

  const { gl } = gpu;
  const textures: WebGLTexture[] = [];
  let framebuffer: WebGLFramebuffer | null = null;
  let readTex: WebGLTexture | null = null;

  try {
    const texA = texture(gl, input.width, input.height, input.data);
    const texB = texture(gl, input.width, input.height, null);
    textures.push(texA, texB);
    framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;

    gl.useProgram(gpu.program);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, input.width, input.height);
    gl.uniform2f(gpu.uniforms.uSize, input.width, input.height);
    gl.uniform1i(gpu.uniforms.uSrc, 0);

    let source = texA;
    let target = texB;
    for (const op of enabled) {
      const uniforms = opUniforms(op, input, ctx, stage);
      if (uniforms.op < 0) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(gpu.uniforms.uOp, uniforms.op);
      gl.uniform4f(gpu.uniforms.uA, ...uniforms.a);
      gl.uniform4f(gpu.uniforms.uB, ...uniforms.b);
      gl.uniform4f(gpu.uniforms.uColor, ...uniforms.color);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const swap = source;
      source = target;
      target = swap;
      readTex = source;
    }

    if (!readTex) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readTex, 0);
    const raw = new Uint8Array(input.width * input.height * 4);
    gl.readPixels(0, 0, input.width, input.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    return { width: input.width, height: input.height, data: new Uint8ClampedArray(raw) };
  } catch (err) {
    console.warn('PixelArtify: GPU effects failed, using CPU.', err);
    disabled = true;
    return null;
  } finally {
    for (const tex of textures) gl.deleteTexture(tex);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
