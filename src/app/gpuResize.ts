/**
 * WebGL2 nearest/bilinear resizer.
 *
 * The CPU implementation premultiplies alpha before interpolation; the shader
 * does the same per tap. Output rows are uploaded and read back top-first, so no
 * flip is needed.
 */

import type { PixelImage } from '../core/types';
import type { ResizeFilter } from '../core/image';

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
uniform vec2 uSrcSize;
uniform vec2 uDstSize;
uniform int uMethod;

out vec4 outColor;

vec4 pre(vec4 s) {
  return vec4(s.rgb * s.a, s.a);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uSrcSize) - ivec2(1);
  if (uMethod == 0) {
    vec2 s = floor(vec2(p) * uSrcSize / uDstSize);
    outColor = texelFetch(uSrc, clamp(ivec2(s), ivec2(0), hi), 0);
    return;
  }

  vec2 pos = (vec2(p) + 0.5) * uSrcSize / uDstSize - 0.5;
  pos = max(pos, vec2(0.0));
  vec2 base = floor(pos);
  vec2 t = pos - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = min(i0 + ivec2(1), hi);
  vec4 s00 = pre(texelFetch(uSrc, i0, 0));
  vec4 s10 = pre(texelFetch(uSrc, ivec2(i1.x, i0.y), 0));
  vec4 s01 = pre(texelFetch(uSrc, ivec2(i0.x, i1.y), 0));
  vec4 s11 = pre(texelFetch(uSrc, i1, 0));
  vec4 s = mix(mix(s00, s10, t.x), mix(s01, s11, t.x), t.y);
  if (s.a <= 1e-6) {
    outColor = vec4(0.0);
    return;
  }
  outColor = vec4(s.rgb / s.a, s.a);
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

/** Small images are faster on the CPU; this is a rough area break-even. */
export const GPU_MIN_RESIZE_PIXELS = 400_000;

function shouldUseGpu(
  method: ResizeFilter,
  width: number,
  height: number,
  src: PixelImage,
): boolean {
  if (method !== 'nearest' && method !== 'bilinear') return false;
  const target = width * height;
  // Nearest CPU is extremely cheap; only use the GPU for large upscales.
  if (method === 'nearest' && (target < 1_500_000 || src.width * src.height < 250_000)) {
    return false;
  }
  if (method === 'bilinear' && target < GPU_MIN_RESIZE_PIXELS) return false;
  return true;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Resize shader compile failed: ${log ?? 'unknown error'}`);
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
    for (const name of ['uSrc', 'uSrcSize', 'uDstSize', 'uMethod']) {
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
    console.warn('PixelArtify: GPU resize unavailable, using CPU.', err);
    disabled = true;
    state = null;
    return null;
  }
}

export function gpuResizeAvailable(): boolean {
  return getState() !== null;
}

export function gpuResize(
  src: PixelImage,
  width: number,
  height: number,
  method: ResizeFilter,
): PixelImage | null {
  if (width < 1 || height < 1) return null;
  if (!shouldUseGpu(method, width, height, src)) return null;
  const gpu = getState();
  if (!gpu) return null;
  if (
    src.width > gpu.maxTexture ||
    src.height > gpu.maxTexture ||
    width > gpu.maxTexture ||
    height > gpu.maxTexture
  ) {
    return null;
  }

  const { gl } = gpu;
  const textures: WebGLTexture[] = [];
  let framebuffer: WebGLFramebuffer | null = null;

  try {
    const srcTex = gl.createTexture();
    const outTex = gl.createTexture();
    if (!srcTex || !outTex) return null;
    textures.push(srcTex, outTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      src.width,
      src.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      src.data,
    );
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

    gl.useProgram(gpu.program);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gpu.uniforms.uSrc, 0);
    gl.uniform2f(gpu.uniforms.uSrcSize, src.width, src.height);
    gl.uniform2f(gpu.uniforms.uDstSize, width, height);
    gl.uniform1i(gpu.uniforms.uMethod, method === 'nearest' ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    return { width, height, data: new Uint8ClampedArray(raw) };
  } catch (err) {
    console.warn('PixelArtify: GPU resize failed, using CPU.', err);
    disabled = true;
    return null;
  } finally {
    for (const texture of textures) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
