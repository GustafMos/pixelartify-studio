import React, { useMemo, useRef, useState } from 'react';
import type { GraphNode, OutputSettings, VideoSettings } from '../../../core/types';
import type { GraphMediaItem } from '../../../core/graph';
import {
  DEFAULT_OUTPUT,
  DEFAULT_VIDEO,
  defaultSettings,
  packSpritesheet,
  renderPixelArt,
  settingsFromItem,
  spritesheetMetadata,
} from '../../../core';
import { mediaAtPort } from '../../../core/graph';
import { useStudio } from '../../store';
import {
  formatFilename,
  downloadBlob,
  downloadText,
  downloadZip,
  pixelImageToBlob,
} from '../../io';
import { VideoWriter, extractVideoFrames } from '../../video';
import {
  Badge,
  IconButton,
  Section,
  Segmented,
  SelectField,
  Slider,
  TextField,
  Toggle,
} from '../controls';
import { Icon } from '../icons';

export function OutputPanel({ node }: { node: GraphNode }): React.ReactElement {
  const {
    graph,
    activeAsset,
    activeItem,
    evaluation,
    selectedOutputId,
    updateNodeParams,
    exportCurrent,
    exportBatch,
    exportLayers,
    isExporting,
    exportProgress,
    notify,
    presets,
  } = useStudio();
  const output = (node.params.output as OutputSettings | undefined) ?? { ...DEFAULT_OUTPUT };
  const video = (node.params.video as VideoSettings | undefined) ?? { ...DEFAULT_VIDEO };
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const writerRef = useRef<VideoWriter | null>(null);

  const setOutput = (patch: Partial<OutputSettings>): void =>
    updateNodeParams(node.id, { output: { ...output, ...patch } });
  const setVideo = (patch: Partial<VideoSettings>): void =>
    updateNodeParams(node.id, { video: { ...video, ...patch } });
  const setSheet = (patch: Partial<VideoSettings['spritesheet']>): void =>
    updateNodeParams(node.id, { video: { ...video, spritesheet: { ...video.spritesheet, ...patch } } });

  const outputItems = useMemo(
    () => (selectedOutputId ? mediaAtPort(evaluation, selectedOutputId) : []),
    [evaluation, selectedOutputId],
  );

  const baseSettings = useMemo(() => {
    if (activeItem) return settingsFromItem(activeItem);
    if (outputItems[0]) return settingsFromItem(outputItems[0]);
    return defaultSettings();
  }, [activeItem, outputItems]);
  const outputSettings = useMemo(
    () => ({ ...baseSettings, output, video }),
    [baseSettings, output, video],
  );

  const duration = activeAsset?.kind === 'video' ? activeAsset.duration ?? 0 : 0;
  const start = Math.max(0, Math.min(video.start, duration));
  const end = Math.min(duration, video.end ?? duration);
  const frameEstimate = Math.max(0, Math.ceil(((end - start) || duration) * video.fps));

  const stop = async (): Promise<void> => {
    abortRef.current?.abort();
    try {
      await writerRef.current?.cancel();
    } catch {
      // Ignore cancellation errors.
    }
    writerRef.current = null;
  };

  const renderItem = (item: GraphMediaItem, image = item.source) => {
    const settings = { ...settingsFromItem(item), output, video };
    return {
      result: renderPixelArt({ image, masks: item.masks, settings }, { upscale: true }),
      settings,
    };
  };

  const runSpritesheet = async (items: GraphMediaItem[], assetName: string, fps: number, isVideo: boolean) => {
    const frames: ReturnType<typeof renderPixelArt>['art'][] = [];
    const durations: number[] = [];
    for (let i = 0; i < items.length; i++) {
      setProgress(`Rendering frame ${i + 1} / ${items.length}`);
      const { result } = renderItem(items[i]);
      frames.push(result.art);
      durations.push(1 / Math.max(0.1, fps));
    }
    if (frames.length === 0) throw new Error('No frames to pack.');
    setProgress('Packing spritesheet…');
    const sheet = packSpritesheet(frames, video.spritesheet, durations);
    const png = await pixelImageToBlob(sheet.image, 'png', 1);
    const base = assetName.replace(/\.[^.]+$/, '') || 'pixelart';
    const meta = spritesheetMetadata(sheet, `${base}-sheet`, fps);
    return {
      png,
      json: JSON.stringify(meta, null, 2),
      name: `${base}-sheet.png`,
      metaName: `${base}-sheet.json`,
      sheet,
      isVideo,
    };
  };

  const exportSpritesheetOnly = async (): Promise<{ png: Blob; json: string; name: string; metaName: string } | null> => {
    const sourceItems = outputItems.length > 0 ? outputItems : activeItem ? [activeItem] : [];
    if (sourceItems.length === 0) {
      notify('No assets connected to this output.', 'warn');
      return null;
    }
    const fps = video.fps;
    const built = await runSpritesheet(sourceItems, activeAsset?.name ?? 'pixelart', fps, false);
    downloadBlob(built.png, built.name);
    downloadText(built.json, built.metaName);
    notify(`Spritesheet exported (${built.sheet.frames.length} frames, ${built.sheet.sheetWidth}×${built.sheet.sheetHeight}).`, 'success');
    return built;
  };

  const exportVideo = async (): Promise<void> => {
    if (!activeAsset || activeAsset.kind !== 'video' || !activeAsset.file) {
      notify('Select a video asset in the Media input first.', 'warn');
      return;
    }
    const item = outputItems.find((i) => i.assetId === activeAsset.id) ?? activeItem;
    if (!item) {
      notify('Connect the video input to this output.', 'warn');
      return;
    }
    const settings = { ...settingsFromItem(item), output, video };
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress('Starting video encoder…');
    try {
      const wantsVideo = settings.video.output === 'video' || settings.video.output === 'both';
      const wantsSheet = settings.video.output === 'spritesheet' || settings.video.output === 'both';
      const frames: ReturnType<typeof renderPixelArt>['art'][] = [];
      const writerState: { writer: VideoWriter | null } = { writer: null };
      let resultInfo: Awaited<ReturnType<VideoWriter['finish']>> | null = null;
      let index = 0;
      const startTime = start;
      const endTime = video.end !== null ? Math.min(duration, Math.max(startTime + 0.05, video.end)) : duration;

      await extractVideoFrames(
        activeAsset.file,
        {
          start: startTime,
          end: endTime,
          fps: settings.video.fps,
          signal: controller.signal,
          onProgress: (done, total) => {
            setProgress(`Decoding frame ${done} / ${total}`);
          },
        },
        async (frame, i, timestamp) => {
          index = i;
          setProgress(`Pixelating frame ${i + 1}`);
          const { result } = renderItem(item, frame);
          if (wantsVideo && !writerState.writer) {
            const newWriter = new VideoWriter({
              width: result.art.width,
              height: result.art.height,
              fps: settings.video.fps,
              codec: settings.video.codec,
              bitrateMbps: settings.video.bitrateMbps,
            });
            writerState.writer = newWriter;
            writerRef.current = newWriter;
            await newWriter.start();
          }
          if (wantsVideo && writerState.writer) await writerState.writer.add(result.art, timestamp);
          if (wantsSheet) frames.push(result.art);
        },
      );

      const writer = writerState.writer;
      if (writer) {
        setProgress('Finalizing video…');
        resultInfo = await writer.finish();
        writerRef.current = null;
      }
      void index;

      const base = activeAsset.name.replace(/\.[^.]+$/, '') || 'pixelart';
      if (wantsSheet) {
        setProgress('Packing spritesheet…');
        const sheet = packSpritesheet(frames, settings.video.spritesheet, frames.map(() => 1 / settings.video.fps));
        const png = await pixelImageToBlob(sheet.image, 'png', 1);
        const json = JSON.stringify(spritesheetMetadata(sheet, `${base}-sheet`, settings.video.fps), null, 2);
        if (wantsVideo && resultInfo) {
          const file = formatFilename(settings.output.filenamePattern, {
            name: base,
            width: resultInfo.width,
            height: resultInfo.height,
            ext: resultInfo.extension,
          });
          await downloadZip(
            [
              { name: file, data: resultInfo.blob },
              { name: `${base}-sheet.png`, data: png },
              { name: `${base}-sheet.json`, data: json },
            ],
            `${base}-pixelart.zip`,
          );
          notify(`Video + spritesheet exported (${frames.length} frames, ${resultInfo.extension.toUpperCase()}).`, 'success');
        } else {
          downloadBlob(png, `${base}-sheet.png`);
          downloadText(json, `${base}-sheet.json`);
          notify(`Spritesheet exported (${frames.length} frames, ${sheet.sheetWidth}×${sheet.sheetHeight}).`, 'success');
        }
      } else if (resultInfo) {
        const file = formatFilename(settings.output.filenamePattern, {
          name: base,
          width: resultInfo.width,
          height: resultInfo.height,
          ext: resultInfo.extension,
        });
        downloadBlob(resultInfo.blob, file);
        notify(
          `Video exported: ${resultInfo.width}×${resultInfo.height}, ${resultInfo.extension.toUpperCase()} (${resultInfo.codec}).`,
          'success',
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        notify('Video export cancelled.', 'warn');
      } else {
        notify(`Video export failed: ${err instanceof Error ? err.message : err}`, 'error');
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="inspector-panel">
      <Section title="Image export">
        <TextField
          label="Filename pattern"
          value={output.filenamePattern}
          onChange={(v) => setOutput({ filenamePattern: v })}
          hint="Tokens: {name}, {width}, {height}, {index}, {date}"
        />
        <div className="two-col">
          <SelectField
            label="Format"
            value={output.format}
            options={[
              { value: 'png', label: 'PNG (alpha)' },
              { value: 'webp', label: 'WebP (alpha)' },
            ]}
            onChange={(v) => setOutput({ format: v as OutputSettings['format'] })}
          />
          <Slider label="Quality" value={output.quality} min={0.4} max={1} step={0.01} onChange={(v) => setOutput({ quality: v })} />
        </div>
        <Toggle label="Keep transparency" checked={output.transparent} onChange={(v) => setOutput({ transparent: v })} />
        <Toggle label="Include JSON manifest" checked={output.writeManifest} onChange={(v) => setOutput({ writeManifest: v })} />
        <Toggle label="Export layers" checked={output.exportLayers} onChange={(v) => setOutput({ exportLayers: v })} />
        <div className="btn-column">
          <button type="button" className="primary-btn" onClick={() => void exportCurrent()} disabled={isExporting}>
            <Icon name="download" size={15} /> {isExporting ? 'Exporting…' : 'Export current image'}
          </button>
          <div className="two-col">
            <button type="button" className="ghost-btn small" onClick={() => void exportBatch()} disabled={isExporting}>
              <Icon name="layers" size={14} /> Batch ZIP
            </button>
            <button type="button" className="ghost-btn small" onClick={() => void exportLayers()} disabled={isExporting}>
              <Icon name="layers" size={14} /> Layer ZIP
            </button>
          </div>
        </div>
        {exportProgress ? <p className="progress-line">{exportProgress}</p> : null}
      </Section>

      <Section title="Video & animation">
        <Segmented
          label="Output"
          value={video.output}
          options={[
            { value: 'video', label: 'Video' },
            { value: 'spritesheet', label: 'Sheet' },
            { value: 'both', label: 'Both' },
          ]}
          onChange={(v) => setVideo({ output: v as VideoSettings['output'] })}
        />
        <div className="two-col">
          <SelectField
            label="Codec"
            value={video.codec}
            options={[
              { value: 'avc', label: 'H.264 / MP4' },
              { value: 'vp9', label: 'VP9 / WebM' },
              { value: 'av1', label: 'AV1 / MP4' },
            ]}
            onChange={(v) => setVideo({ codec: v as VideoSettings['codec'] })}
          />
          <Slider label="FPS" value={video.fps} min={1} max={60} step={1} onChange={(v) => setVideo({ fps: v })} />
        </div>
        <Slider label="Bitrate" value={video.bitrateMbps} min={1} max={40} step={1} unit="Mbps" onChange={(v) => setVideo({ bitrateMbps: v })} />
        <div className="two-col">
          <Slider label="Start" value={video.start} min={0} max={Math.max(0.1, duration)} step={0.05} unit="s" onChange={(v) => setVideo({ start: v })} />
          <Slider label="End" value={video.end ?? duration} min={0} max={Math.max(0.1, duration)} step={0.05} unit="s" onChange={(v) => setVideo({ end: v })} />
        </div>

        <div className="inset-panel">
          <span className="inset-title">Spritesheet</span>
          <div className="two-col">
            <Slider label="Columns" value={video.spritesheet.columns} min={0} max={32} step={1} onChange={(v) => setSheet({ columns: v })} hint="0 = auto" />
            <Slider label="Padding" value={video.spritesheet.padding} min={0} max={32} step={1} unit="px" onChange={(v) => setSheet({ padding: v })} />
          </div>
          <div className="two-col">
            <Slider label="Max size" value={video.spritesheet.maxSize} min={256} max={8192} step={256} unit="px" onChange={(v) => setSheet({ maxSize: v })} />
            <Toggle label="Power of two" checked={video.spritesheet.powerOfTwo} onChange={(v) => setSheet({ powerOfTwo: v })} />
          </div>
        </div>

        <div className="stat-strip">
          <div>
            <span>Source</span>
            <strong>{activeAsset?.kind === 'video' ? `${duration.toFixed(1)} s` : 'image sequence'}</strong>
          </div>
          <div>
            <span>Est. frames</span>
            <strong>{frameEstimate || outputItems.length}</strong>
          </div>
          <div>
            <span>Art</span>
            <strong>
              {activeItem ? `${activeItem.resolution.value}` : '—'}
            </strong>
          </div>
        </div>

        {activeAsset?.kind !== 'video' ? (
          <div className="info-callout">
            <Icon name="film" size={16} />
            <span>Select a video in a Media input to enable video export. Image batches can still be packed as a spritesheet.</span>
          </div>
        ) : null}

        <div className="btn-column">
          <button type="button" className="primary-btn" onClick={() => void exportVideo()} disabled={busy || isExporting}>
            <Icon name="film" size={15} /> Render video / sheet
          </button>
          <div className="two-col">
            <button type="button" className="ghost-btn small" onClick={() => void exportSpritesheetOnly()} disabled={busy || isExporting}>
              <Icon name="sheet" size={14} /> Image sheet
            </button>
            <button type="button" className="ghost-btn small danger" onClick={() => void stop()} disabled={!busy}>
              <Icon name="close" size={14} /> Cancel
            </button>
          </div>
        </div>
        {progress ? <p className="progress-line">{progress}</p> : null}
        {busy ? <div className="progress-bar"><span /></div> : null}
        <p className="micro-copy">
          Browser video export uses WebCodecs. Audio is not re-muxed; use the CLI with ffmpeg when you need the
          original soundtrack. Transparent pixels are flattened for H.264/VP9 output.
        </p>
      </Section>

      <Section title="Preset & output info" defaultOpen={false}>
        <p className="micro-copy">
          This output node stores its own filename, format and video settings. Add another Output node to render
          a second variant (for example PNG sprites + MP4 preview) from the same graph.
        </p>
        <p className="micro-copy">
          {presets.length} presets available. Use the preset menu to load a graph, then adjust this output node.
        </p>
      </Section>
    </div>
  );
}
