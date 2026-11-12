/**
 * WebGL2 layer compositor.
 *
 * The expensive parts of the Compose layers node stay where they are: masks,
 * detail high-pass and inpainting are CPU work before each layer reaches the
 * pixelator. This module accelerates the final blend, where every layer is
 * already an art-resolution image and only offset/scale/opacity/blend and
 * source-over compositing remain.
 *
 * It mirrors `compositeLayers()` exactly (nearest inverse transform, five blend
 * modes, alpha-aware source-over) and falls back to the CPU if WebGL2 is
 * unavailable or a framebuffer cannot be completed.
 */

import type { BlendMode, CompositeLayer } from '../core/image';
import type { PixelImage } from '../core/types';

const VERTEX = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uDst;
uniform sampler2D uLayer;
uniform ivec2 uSize;
uniform ivec2 uSrcSize;
uniform vec2 uOffset;
uniform float uScale;
uniform float uOpacity;
uniform int uBlend;

out vec4 outColor;

vec3 blendMode(vec3 base, vec3 top) {
  if (uBlend == 1) return base * top;
  if (uBlend == 2) return 1.0 - (1.0 - base) * (1.0 - top);
  if (uBlend == 3) return min(vec3(1.0), base + top);
  if (uBlend == 4) {
    vec3 lo = 2.0 * base * top;
    vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - top);
    return mix(lo, hi, step(vec3(0.5), base));
  }
  return top;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 dst = texelFetch(uDst, p, 0);

  float cx = float(uSize.x) * 0.5;
  float cy = float(uSize.y) * 0.5;
  float inv = 1.0 / max(1e-6, uScale);
  int sx = int(floor((float(p.x) - cx - uOffset.x) * inv + float(uSrcSize.x) * 0.5 + 0.5));
  int sy = int(floor((float(p.y) - cy - uOffset.y) * inv + float(uSrcSize.y) * 0.5 + 0.5));
  if (sx < 0 || sy < 0 || sx >= uSrcSize.x || sy >= uSrcSize.y) {
    outColor = dst;
    return;
  }

  vec4 src = texelFetch(uLayer, ivec2(sx, sy), 0);
  float alpha = src.a * uOpacity;
  if (alpha <= 1e-6) {
    outColor = dst;
    return;
  }

  vec3 blended = blendMode(dst.rgb, src.rgb);
  float outA = alpha + dst.a * (1.0 - alpha);
  if (outA <= 1e-6) {
    outColor = vec4(0.0);
    return;
  }
  vec3 rgb = (blended * alpha + dst.rgb * dst.a * (1.0 - alpha)) / outA;
  outColor = vec4(rgb, outA);
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

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create layer shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Layer compositor shader failed: ${log ?? 'unknown error'}`);
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
    if (!program) throw new Error('Could not create layer program.');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Layer program link failed.');
    }
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create layer buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['uDst', 'uLayer', 'uSize', 'uSrcSize', 'uOffset', 'uScale', 'uOpacity', 'uBlend']) {
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
    console.warn('PixelArtify: GPU layer compositor unavailable, using CPU.', err);
    disabled = true;
    state = null;
    return null;
  }
}

export function gpuLayersAvailable(): boolean {
  return getState() !== null;
}

/** Below this art-pixel count upload/readback dominates the tiny CPU loop. */
export const GPU_MIN_LAYER_PIXELS = 6000;

function makeTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data: Uint8ClampedArray | null,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not create layer texture.');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return tex;
}

function blendCode(blend: BlendMode): number {
  switch (blend) {
    case 'multiply':
      return 1;
    case 'screen':
      return 2;
    case 'add':
      return 3;
    case 'overlay':
      return 4;
    case 'normal':
    default:
      return 0;
  }
}

export function gpuCompositeLayers(
  width: number,
  height: number,
  layers: CompositeLayer[],
): PixelImage | null {
  if (layers.length === 0) return null;
  const gpu = getState();
  if (!gpu) return null;
  const { gl } = gpu;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w * h < GPU_MIN_LAYER_PIXELS) return null;
  if (w > gpu.maxTexture || h > gpu.maxTexture) return null;

  const textures: WebGLTexture[] = [];
  let framebuffer: WebGLFramebuffer | null = null;

  try {
    let srcTex = makeTexture(gl, w, h, null);
    let dstTex = makeTexture(gl, w, h, null);
    textures.push(srcTex, dstTex);
    framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not create layer framebuffer.');

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, w, h);
    gl.useProgram(gpu.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gpu.uniforms.uDst, 0);
    gl.uniform1i(gpu.uniforms.uLayer, 1);
    gl.uniform2i(gpu.uniforms.uSize, w, h);

    for (const layer of layers) {
      const src = layer.image;
      if (src.width < 1 || src.height < 1) continue;
      const layerTex = makeTexture(gl, src.width, src.height, src.data);
      textures.push(layerTex);

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Layer framebuffer incomplete.');
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, layerTex);
      gl.uniform2i(gpu.uniforms.uSrcSize, src.width, src.height);
      gl.uniform2f(gpu.uniforms.uOffset, layer.offsetX, layer.offsetY);
      gl.uniform1f(gpu.uniforms.uScale, layer.scale || 1);
      gl.uniform1f(gpu.uniforms.uOpacity, Math.max(0, Math.min(1, layer.opacity)));
      gl.uniform1i(gpu.uniforms.uBlend, blendCode(layer.blend));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const swap = srcTex;
      srcTex = dstTex;
      dstTex = swap;
    }

    // The latest pass wrote into srcTex, so read from it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, srcTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Layer readback framebuffer incomplete.');
    }
    const data = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { width: w, height: h, data };
  } catch (err) {
    console.warn('PixelArtify: GPU layer compositing failed, using CPU.', err);
    return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    for (const tex of textures) gl.deleteTexture(tex);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
  }
}
