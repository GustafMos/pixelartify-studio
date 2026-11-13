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
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeVideo,
  type InputVideoTrack,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import type { PixelImage, VideoInfo } from '../core/types';
import { canvasToPixelImage, createCanvas, pixelImageToCanvas } from './canvas';

export interface VideoProbe extends VideoInfo {
  displayWidth: number;
  displayHeight: number;
}

/**
 * Mediabunny's most permissive input format list: MP4, MOV/QTFF, Matroska,
 * WebM, MPEG-TS, HLS, OGG, WAVE, FLAC, MP3 and ADTS. Decoding always uses the
 * full list so files assembled from multiple sources (mixed containers or
 * codecs, variable frame rate) still probe and decode. Output containers are
 * selected explicitly in `VideoWriter.start()`.
 */
const INPUT_FORMATS = ALL_FORMATS;

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264/AVC',
  hevc: 'H.265/HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'Apple ProRes',
};

function codecLabel(codec: string | null): string {
  if (!codec) return 'unknown codec';
  return CODEC_LABELS[codec] ?? codec;
}

function createInput(file: File): Input {
  return new Input({ formats: INPUT_FORMATS, source: new BlobSource(file) });
}

/** Human-readable description of the file, container and codec for errors. */
async function describeMedia(
  file: File,
  input: Input,
  track: InputVideoTrack | null,
): Promise<string> {
  const parts: string[] = [`"${file.name}"`];
  try {
    const format = await input.getFormat();
    if (format?.name) parts.push(format.name);
  } catch {
    // Container name is optional context.
  }
  if (track) {
    try {
      const codec = await track.getCodec();
      let codecText = codecLabel(codec);
      try {
        const codecString = await track.getCodecParameterString();
        if (codecString) codecText += ` (${codecString})`;
      } catch {
        // Codec parameter string is optional context.
      }
      parts.push(codecText);
    } catch {
      // Codec is optional context.
    }
  }
  return parts.join(', ');
}

/**
 * Prefer the primary video track this browser can decode. Files assembled from
 * multiple sources can expose several video tracks with different codecs;
 * falling back to the plain primary track lets probing still report metadata
 * (with `codec: null`) instead of failing outright.
 */
async function getVideoTrack(input: Input): Promise<InputVideoTrack | null> {
  try {
    const decodable = await input.getPrimaryVideoTrack({
      filter: (track) => track.canDecode().catch(() => false),
    });
    if (decodable) return decodable;
  } catch {
    // Fall through to the unfiltered lookup.
  }
  return input.getPrimaryVideoTrack();
}

/** Duration lookup that tolerates VFR/mixed-source files with broken indexes. */
async function computeVideoDuration(input: Input, track: InputVideoTrack): Promise<number> {
  const strategies: Array<() => Promise<number | null>> = [
    () => input.computeDuration(),
    () => track.computeDuration(),
    () => input.getDurationFromMetadata([track]),
  ];
  for (const getDuration of strategies) {
    try {
      const duration = await getDuration();
      if (duration !== null && Number.isFinite(duration) && duration > 0) return duration;
    } catch {
      // Mixed/VFR files may fail one strategy; try the next.
    }
  }
  return 0;
}

async function assertDecodable(
  file: File,
  input: Input,
  track: InputVideoTrack,
): Promise<void> {
  let decodable = true;
  try {
    decodable = await track.canDecode();
  } catch {
    // Let the decoder surface its own error if support cannot be determined.
    decodable = true;
  }
  if (!decodable) {
    const media = await describeMedia(file, input, track);
    throw new Error(
      `This browser cannot decode video (${media}). Try re-encoding it to H.264/AVC or VP9 first.`,
    );
  }
}

/** Wrap read/decode failures with container, codec and file context. */
async function mediaFailure(
  action: 'read' | 'decode',
  file: File,
  input: Input,
  track: InputVideoTrack | null,
  error: unknown,
): Promise<Error> {
  if (error instanceof DOMException && error.name === 'AbortError') return error;
  if (error instanceof Error && error.message.startsWith('Could not ')) return error;
  const media = await describeMedia(file, input, track);
  const reason = error instanceof Error ? error.message : String(error);
  const hint =
    action === 'read'
      ? 'The container may be unsupported, or the file may be truncated or damaged.'
      : 'The file may mix codecs across cuts, use a codec this browser cannot decode, or have an unsupported container. Try re-encoding it to H.264/AVC or VP9 first.';
  return new Error(
    `Could not ${action} video (${media}). ${hint}${reason ? ` Details: ${reason}` : ''}`,
  );
}

export async function probeVideo(file: File): Promise<VideoProbe> {
  const input = createInput(file);
  try {
    let readable = false;
    try {
      readable = await input.canRead();
    } catch (error) {
      throw await mediaFailure('read', file, input, null, error);
    }
    if (!readable) {
      const media = await describeMedia(file, input, null);
      throw new Error(
        `Unsupported or unreadable video file (${media}). Supported containers include MP4/MOV, ` +
          'Matroska/WebM, MPEG-TS and HLS.',
      );
    }

    let track: InputVideoTrack | null = null;
    try {
      track = await getVideoTrack(input);
    } catch (error) {
      throw await mediaFailure('read', file, input, null, error);
    }
    if (!track) throw new Error(`No video track found in "${file.name}".`);

    const duration = await computeVideoDuration(input, track);

    // An unknown codec must not prevent reporting the rest of the probe.
    let displayWidth = 0;
    let displayHeight = 0;
    try {
      displayWidth = await track.getDisplayWidth();
      displayHeight = await track.getDisplayHeight();
    } catch {
      // Fall back to coded dimensions below.
    }
    if (!displayWidth || !displayHeight) {
      try {
        displayWidth = displayWidth || (await track.getCodedWidth());
        displayHeight = displayHeight || (await track.getCodedHeight());
      } catch {
        // Leave as zero; probing should still succeed for odd/unknown codecs.
      }
    }

    let fps = 24;
    try {
      const metrics = await track.computeFrameRateMetrics();
      const candidates = [metrics.bestGuessFrameRate, metrics.averageFrameRate, 24];
      fps = candidates.find((value) => Number.isFinite(value) && value > 0) ?? 24;
    } catch {
      // VFR or partially indexed files may not produce metrics; keep 24 fps.
    }

    let codec: string | null = null;
    try {
      codec = (await track.getCodec()) ?? null;
    } catch {
      codec = null;
    }

    let hasAudio = false;
    try {
      hasAudio = Boolean(await input.getPrimaryAudioTrack());
    } catch {
      hasAudio = false;
    }

    return {
      duration,
      width: displayWidth,
      height: displayHeight,
      displayWidth,
      displayHeight,
      fps,
      frameCount: Math.max(1, Math.round(duration * fps)),
      codec,
      hasAudio,
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
  const input = createInput(file);
  try {
    let track: InputVideoTrack | null = null;
    try {
      track = await getVideoTrack(input);
    } catch (error) {
      throw await mediaFailure('read', file, input, null, error);
    }
    if (!track) throw new Error(`No video track found in "${file.name}".`);
    await assertDecodable(file, input, track);
    const sink = new VideoSampleSink(track);

    let sample: VideoSample | null = null;
    try {
      sample = await sink.getSample(Math.max(0, time));
    } catch (error) {
      throw await mediaFailure('decode', file, input, track, error);
    }
    if (!sample) {
      const media = await describeMedia(file, input, track);
      throw new Error(
        `No frame at ${Math.max(0, time).toFixed(2)}s in video (${media}). ` +
          'The video may start later or be shorter than expected.',
      );
    }

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
 *
 * Timing always comes from each sample's own `timestamp`/`duration`, so
 * variable-frame-rate sources are handled without assuming a constant rate.
 */
export async function extractVideoFrames(
  file: File,
  options: VideoExtractOptions,
  onFrame: (image: PixelImage, index: number, timestamp: number) => void | Promise<void>,
): Promise<number> {
  const input = createInput(file);
  try {
    let track: InputVideoTrack | null = null;
    try {
      track = await getVideoTrack(input);
    } catch (error) {
      throw await mediaFailure('read', file, input, null, error);
    }
    if (!track) throw new Error(`No video track found in "${file.name}".`);
    await assertDecodable(file, input, track);
    const duration = await computeVideoDuration(input, track);
    // Mixed-source files may not expose a trustworthy duration; fall back to
    // the caller's range instead of returning zero frames.
    const spanEnd = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const start = Math.max(0, Math.min(options.start, spanEnd));
    const end = Math.min(spanEnd, options.end ?? spanEnd);
    const fps = Math.max(0.1, options.fps);
    const total =
      spanEnd === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.round((end - start) * fps));
    const sink = new VideoSampleSink(track);
    const maxSide = options.maxSide ?? 1920;
    const totalSteps = total;
    let index = 0;
    let nextTime = start;

    const iterator = sink.samples(start, end)[Symbol.asyncIterator]();
    try {
      for (;;) {
        let step: IteratorResult<VideoSample>;
        try {
          step = await iterator.next();
        } catch (error) {
          throw await mediaFailure('decode', file, input, track, error);
        }
        if (step.done) break;

        const sample = step.value;
        let image: PixelImage | null = null;
        try {
          if (options.signal?.aborted) {
            throw new DOMException('Video processing cancelled.', 'AbortError');
          }
          const mid = sample.timestamp + sample.duration * 0.5;
          if (mid + 1e-4 < nextTime) continue;

          const dw = sample.displayWidth;
          const dh = sample.displayHeight;
          const scale = Math.min(1, maxSide / Math.max(dw, dh));
          const canvas = createCanvas(dw * scale, dh * scale);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Canvas 2D is unavailable.');
          sample.draw(ctx, 0, 0, canvas.width, canvas.height);
          image = canvasToPixelImage(canvas);
        } finally {
          sample.close();
        }

        if (!image) continue;
        await onFrame(image, index, index / fps);
        index++;
        nextTime = start + index / fps;
        options.onProgress?.(index, totalSteps);
        if (index >= total) break;
      }
    } finally {
      await iterator.return?.();
    }
    return index;
  } finally {
    input.dispose();
  }
}

export type WriterCodec = 'avc' | 'hevc' | 'vp9' | 'av1' | 'prores';

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
  extension: 'mp4' | 'webm' | 'mov';
  codec: WriterCodec;
  width: number;
  height: number;
}

/** HEVC/ProRes are carried in ISO-BMFF (MP4/MOV); WebM is used for VP9. */
function containerForCodec(codec: WriterCodec): 'mp4' | 'webm' | 'mov' {
  if (codec === 'vp9') return 'webm';
  if (codec === 'prores') return 'mov';
  return 'mp4';
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
  private resolvedFormat: 'mp4' | 'webm' | 'mov' = 'mp4';
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
    const candidates: WriterCodec[] = [];
    for (const codec of [this.options.codec, 'avc', 'hevc', 'vp9', 'av1', 'prores'] as const) {
      if (!candidates.includes(codec)) candidates.push(codec);
    }

    let chosen: WriterCodec | null = null;
    let chosenFormat: Mp4OutputFormat | WebMOutputFormat | MovOutputFormat | null = null;
    for (const codec of candidates) {
      if (!(await canEncodeVideo(codec, { width: this.width, height: this.height, frameRate: fps, quality }))) {
        continue;
      }
      const formatKind = containerForCodec(codec);
      const format =
        formatKind === 'webm'
          ? new WebMOutputFormat()
          : formatKind === 'mov'
            ? new MovOutputFormat()
            : new Mp4OutputFormat();
      if (!format.getSupportedVideoCodecs().includes(codec)) continue;
      chosen = codec;
      chosenFormat = format;
      this.resolvedFormat = formatKind;
      break;
    }
    if (!chosen || !chosenFormat) {
      throw new Error('This browser cannot encode H.264/AVC, H.265/HEVC, VP9, AV1 or ProRes video.');
    }
    this.resolvedCodec = chosen;

    const output = new Output({
      format: chosenFormat,
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
    const mimeType =
      this.resolvedFormat === 'webm'
        ? 'video/webm'
        : this.resolvedFormat === 'mov'
          ? 'video/quicktime'
          : 'video/mp4';
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
  for (const codec of ['avc', 'hevc', 'vp9', 'av1', 'prores'] as const) {
    if (await canEncodeVideo(codec, { width: 640, height: 360 })) out.push(codec);
  }
  return out;
}
