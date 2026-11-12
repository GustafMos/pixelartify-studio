/**
 * Video I/O powered by Mediabunny (MPL-2.0, © Vanilagy and contributors).
 * Frame-accurate decoding through WebCodecs, and MP4/WebM encoding without a
 * server or ffmpeg. Audio is intentionally not re-muxed in the browser; the
 * CLI preserves audio via ffmpeg.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny';
import type { PixelImage, VideoInfo } from '../core/types';
import { canvasToPixelImage, createCanvas, pixelImageToCanvas } from './canvas';

export interface VideoProbe extends VideoInfo {
  displayWidth: number;
  displayHeight: number;
}

export async function probeVideo(file: File): Promise<VideoProbe> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) throw new Error('Unsupported or unreadable video file.');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found.');
    const duration = await input.computeDuration();
    const displayWidth = await track.getDisplayWidth();
    const displayHeight = await track.getDisplayHeight();
    let fps = 24;
    try {
      const metrics = await track.computeFrameRateMetrics();
      fps = metrics.bestGuessFrameRate || 24;
    } catch {
      // Keep the fallback.
    }
    const codec = await track.getCodec();
    const audio = await input.getPrimaryAudioTrack();
    return {
      duration,
      width: displayWidth,
      height: displayHeight,
      displayWidth,
      displayHeight,
      fps,
      frameCount: Math.max(1, Math.round(duration * fps)),
      codec: codec ?? null,
      hasAudio: Boolean(audio),
    };
  } finally {
    input.dispose();
  }
}

/** Decode the frame visible at a given time (used for thumbnails/scrubbing). */
export async function grabVideoFrame(
  file: File,
  time: number,
  maxSide = 1600,
): Promise<{ image: PixelImage; timestamp: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found.');
    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(Math.max(0, time));
    if (!sample) throw new Error('No frame at this timestamp.');
    try {
      const dw = sample.displayWidth;
      const dh = sample.displayHeight;
      const scale = Math.min(1, maxSide / Math.max(dw, dh));
      const canvas = createCanvas(dw * scale, dh * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D is unavailable.');
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      return { image: canvasToPixelImage(canvas), timestamp: sample.timestamp };
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}

export interface VideoExtractOptions {
  start: number;
  end: number | null;
  fps: number;
  maxSide?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Stream frames at a target fps. The callback receives art-ready RGBA images;
 * callers can run the full pipeline and feed the result into a VideoWriter.
 */
export async function extractVideoFrames(
  file: File,
  options: VideoExtractOptions,
  onFrame: (image: PixelImage, index: number, timestamp: number) => void | Promise<void>,
): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found.');
    const duration = await input.computeDuration();
    const start = Math.max(0, Math.min(options.start, duration));
    const end = Math.min(duration, options.end ?? duration);
    const fps = Math.max(0.1, options.fps);
    const total = Math.max(1, Math.round((end - start) * fps));
    const sink = new VideoSampleSink(track);
    const maxSide = options.maxSide ?? 1920;
    const totalSteps = total;
    let index = 0;
    let nextTime = start;

    for await (const sample of sink.samples(start, end)) {
      if (options.signal?.aborted) {
        sample.close();
        throw new DOMException('Video processing cancelled.', 'AbortError');
      }
      const mid = sample.timestamp + sample.duration * 0.5;
      if (mid + 1e-4 < nextTime) {
        sample.close();
        continue;
      }

      const dw = sample.displayWidth;
      const dh = sample.displayHeight;
      const scale = Math.min(1, maxSide / Math.max(dw, dh));
      const canvas = createCanvas(dw * scale, dh * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        sample.close();
        throw new Error('Canvas 2D is unavailable.');
      }
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      const image = canvasToPixelImage(canvas);
      sample.close();

      await onFrame(image, index, index / fps);
      index++;
      nextTime = start + index / fps;
      options.onProgress?.(index, totalSteps);
      if (index >= total) break;
    }
    return index;
  } finally {
    input.dispose();
  }
}

export type WriterCodec = 'avc' | 'vp9' | 'av1';

export interface VideoWriterOptions {
  width: number;
  height: number;
  fps: number;
  codec: WriterCodec;
  bitrateMbps: number;
  onProgress?: (done: number) => void;
}

export interface VideoWriterResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  codec: WriterCodec;
  width: number;
  height: number;
}

/**
 * A streaming video writer. Frames are drawn to a fixed canvas and encoded with
 * WebCodecs via Mediabunny. Even dimensions are enforced for AVC compatibility.
 */
export class VideoWriter {
  private readonly options: VideoWriterOptions;
  private output: Output | null = null;
  private source: CanvasSource | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resolvedCodec: VideoCodec = 'avc';
  private resolvedFormat: 'mp4' | 'webm' = 'mp4';
  private started = false;
  private finished = false;
  private frames = 0;
  width: number;
  height: number;

  constructor(options: VideoWriterOptions) {
    this.options = options;
    this.width = Math.max(2, Math.round(options.width / 2) * 2);
    this.height = Math.max(2, Math.round(options.height / 2) * 2);
    this.canvas = createCanvas(this.width, this.height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const { fps, bitrateMbps } = this.options;
    const quality = new Quality({ bitrate: bitrateMbps * 1_000_000 });
    const candidates: WriterCodec[] = [this.options.codec, 'avc', 'vp9'];
    let chosen: WriterCodec | null = null;
    for (const codec of candidates) {
      if (await canEncodeVideo(codec, { width: this.width, height: this.height, frameRate: fps, quality })) {
        chosen = codec;
        break;
      }
    }
    if (!chosen) throw new Error('This browser cannot encode H.264, VP9 or AV1 video.');
    this.resolvedCodec = chosen;
    this.resolvedFormat = chosen === 'vp9' ? 'webm' : 'mp4';

    const output = new Output({
      format: this.resolvedFormat === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const source = new CanvasSource(this.canvas, { codec: chosen, quality });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    this.output = output;
    this.source = source;
    this.started = true;
  }

  async add(image: PixelImage, timestamp: number): Promise<void> {
    if (!this.source) throw new Error('VideoWriter not started.');
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.imageSmoothingEnabled = false;
    const canvas = pixelImageToCanvas(image);
    this.ctx.drawImage(canvas, 0, 0, this.width, this.height);
    await this.source.add(timestamp, 1 / this.options.fps);
    this.frames++;
    this.options.onProgress?.(this.frames);
  }

  async finish(): Promise<VideoWriterResult> {
    if (!this.output || !this.started) throw new Error('VideoWriter not started.');
    if (this.finished) throw new Error('VideoWriter already finished.');
    this.finished = true;
    await this.output.finalize();
    const buffer = (this.output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Video encoding produced no data.');
    const mimeType = this.resolvedFormat === 'webm' ? 'video/webm' : 'video/mp4';
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      extension: this.resolvedFormat,
      codec: this.resolvedCodec as WriterCodec,
      width: this.width,
      height: this.height,
    };
  }

  async cancel(): Promise<void> {
    if (this.output && !this.finished) {
      this.finished = true;
      await this.output.cancel();
    }
  }
}

export async function supportedVideoCodecs(): Promise<WriterCodec[]> {
  const out: WriterCodec[] = [];
  for (const codec of ['avc', 'vp9', 'av1'] as const) {
    if (await canEncodeVideo(codec, { width: 640, height: 360 })) out.push(codec);
  }
  return out;
}
