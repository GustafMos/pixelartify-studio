/**
 * WebGL2 finisher for palette matching and matrix-based dithering.
 *
 * Ordered, clustered-dot, line, checker, crosshatch, blue-noise, white-noise and
 * threshold algorithms are evaluated per pixel on the GPU. Error-diffusion
 * algorithms (Floyd–Steinberg, Atkinson, …) are sequential and stay on the CPU.
 *
 * The source is uploaded top-row first and read back top-row first, so no row
 * flip is needed (unlike the pixelation sampler, which flips its sampling).
 */

import type { DitherSettings, PixelImage } from '../core/types';
import { parseHex, rgbToOklab } from '../core/color';
import { ditherMatrixFor, orderedDitherAmplitude } from '../core/dither';

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
uniform sampler2D uMatrix;
uniform sampler2D uPaletteLab;
uniform sampler2D uPaletteRgb;
uniform int uCount;
uniform int uMatrixSize;
uniform float uAmplitude;
uniform float uBias;
uniform float uScale;

out vec4 outColor;

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  float l_ = pow(max(l, 0.0), 1.0 / 3.0);
  float m_ = pow(max(m, 0.0), 1.0 / 3.0);
  float s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 src = texelFetch(uSrc, p, 0);
  if (src.a <= 0.0) {
    outColor = src;
    return;
  }

  int mx = int(floor(float(p.x) / uScale)) % uMatrixSize;
  int my = int(floor(float(p.y) / uScale)) % uMatrixSize;
  float t = texelFetch(uMatrix, ivec2(mx, my), 0).r - 0.5 + uBias;
  vec3 biased = clamp(src.rgb + vec3(t * 2.0 * uAmplitude), 0.0, 1.0);
  vec3 target = linearToOklab(srgbToLinear(biased));

  int best = 0;
  float bestD = 1e20;
  for (int i = 0; i < 256; i++) {
    if (i >= uCount) break;
    vec3 lab = texelFetch(uPaletteLab, ivec2(i, 0), 0).rgb;
    vec3 d = target - lab;
    float dist = d.x * d.x + d.y * d.y * 1.6 + d.z * d.z * 1.6;
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }

  vec4 rgb = texelFetch(uPaletteRgb, ivec2(best, 0), 0);
  outColor = vec4(rgb.rgb, src.a);
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

/**
 * Below this art-pixel count the CPU matcher is usually faster than uploading,
 * drawing and reading back.
 */
export const GPU_MIN_DITHER_PIXELS = 24000;

export function supportsGpuDither(algorithm: string): boolean {
  if (algorithm === 'none') return false;
  return ditherMatrixFor(algorithm) !== null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Dither shader compile failed: ${log ?? 'unknown error'}`);
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

    const names = [
      'uSrc',
      'uMatrix',
      'uPaletteLab',
      'uPaletteRgb',
      'uCount',
      'uMatrixSize',
      'uAmplitude',
      'uBias',
      'uScale',
    ];
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
    state = {
      gl,
      program,
      uniforms,
      buffer,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    return state;
  } catch (err) {
    console.warn('PixelArtify: GPU dither unavailable, using CPU.', err);
    disabled = true;
    state = null;
    return null;
  }
}

export function gpuDitherAvailable(): boolean {
  return getState() !== null;
}

function makeTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  data: ArrayBufferView | null,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  return texture;
}

export function gpuDither(
  image: PixelImage,
  palette: string[],
  settings: DitherSettings,
  seed: number,
): PixelImage | null {
  void seed;
  const gpu = getState();
  if (!gpu) return null;
  if (image.width * image.height < GPU_MIN_DITHER_PIXELS) return null;
  if (palette.length === 0 || palette.length > 256) return null;
  const matrix = ditherMatrixFor(settings.algorithm);
  if (!matrix) return null;
  const matrixSize = Math.round(Math.sqrt(matrix.length));
  if (
    image.width > gpu.maxTexture ||
    image.height > gpu.maxTexture ||
    matrixSize > gpu.maxTexture
  ) {
    return null;
  }

  const { gl } = gpu;
  const textures: WebGLTexture[] = [];
  let framebuffer: WebGLFramebuffer | null = null;

  try {
    const paletteLab = new Float32Array(256 * 4);
    const paletteRgb = new Uint8Array(256 * 4);
    const colors = palette.map(parseHex);
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      const lab = rgbToOklab(c.r, c.g, c.b);
      paletteLab[i * 4] = lab.L;
      paletteLab[i * 4 + 1] = lab.a;
      paletteLab[i * 4 + 2] = lab.b;
      paletteLab[i * 4 + 3] = 1;
      paletteRgb[i * 4] = c.r;
      paletteRgb[i * 4 + 1] = c.g;
      paletteRgb[i * 4 + 2] = c.b;
      paletteRgb[i * 4 + 3] = 255;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const srcTex = makeTexture(
      gl,
      image.width,
      image.height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image.data,
    );
    textures.push(srcTex);
    const matrixTex = makeTexture(
      gl,
      matrixSize,
      matrixSize,
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      matrix,
    );
    textures.push(matrixTex);
    const labTex = makeTexture(
      gl,
      256,
      1,
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      paletteLab,
    );
    textures.push(labTex);
    const rgbTex = makeTexture(
      gl,
      256,
      1,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      paletteRgb,
    );
    textures.push(rgbTex);

    const outputTex = makeTexture(
      gl,
      image.width,
      image.height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    textures.push(outputTex);
    framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      outputTex,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

    gl.useProgram(gpu.program);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, image.width, image.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gpu.uniforms.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, matrixTex);
    gl.uniform1i(gpu.uniforms.uMatrix, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, labTex);
    gl.uniform1i(gpu.uniforms.uPaletteLab, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, rgbTex);
    gl.uniform1i(gpu.uniforms.uPaletteRgb, 3);

    gl.uniform1i(gpu.uniforms.uCount, palette.length);
    gl.uniform1i(gpu.uniforms.uMatrixSize, matrixSize);
    const strength = Math.max(0, Math.min(1, settings.strength));
    gl.uniform1f(
      gpu.uniforms.uAmplitude,
      orderedDitherAmplitude(palette, strength) / 255,
    );
    gl.uniform1f(gpu.uniforms.uBias, Math.max(-1, Math.min(1, settings.threshold ?? 0)));
    gl.uniform1f(gpu.uniforms.uScale, Math.max(0.25, settings.scale || 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const raw = new Uint8Array(image.width * image.height * 4);
    gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(raw) };
  } catch (err) {
    console.warn('PixelArtify: GPU dither failed, using CPU.', err);
    disabled = true;
    return null;
  } finally {
    for (const texture of textures) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
