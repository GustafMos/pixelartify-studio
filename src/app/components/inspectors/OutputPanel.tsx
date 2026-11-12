import React, { useMemo, useRef, useState } from 'react';
import type { GraphNode, OutputSettings, PrintSettings, VideoSettings } from '../../../core/types';
import type { GraphMediaItem } from '../../../core/graph';
import {
  DEFAULT_OUTPUT,
  DEFAULT_VIDEO,
  SHEET_MAX_PIXELS,
  SHEET_MAX_SIDE,
  computeArtSize,
  defaultSettings,
  layoutPrintPages,
  packSpritesheets,
  printMetadata,
  renderPixelArt,
  renderPrintPage,
  settingsFromItem,
  spritesheetMetadata,
} from '../../../core';
import type { PixelImage } from '../../../core/types';
import { applyTrackedAlphaCuts, mediaAtPort } from '../../../core/graph';
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
    trackedMasks,
  } = useStudio();
  const output: OutputSettings = {
    ...DEFAULT_OUTPUT,
    ...((node.params.output as Partial<OutputSettings> | undefined) ?? {}),
  };
  const rawVideo = (node.params.video as Partial<VideoSettings> | undefined) ?? {};
  const video: VideoSettings = {
    ...DEFAULT_VIDEO,
    ...rawVideo,
    spritesheet: { ...DEFAULT_VIDEO.spritesheet, ...(rawVideo.spritesheet ?? {}) },
  };
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
  const setPrint = (patch: Partial<PrintSettings>): void =>
    updateNodeParams(node.id, { video: { ...video, print: { ...video.print, ...patch } } });

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

  const renderItem = (item: GraphMediaItem, image = item.source, time = 0) => {
    const settings = { ...settingsFromItem(item), output, video };
    const input =
      image === item.source ? image : applyTrackedAlphaCuts(item, image, time, trackedMasks);
    return {
      result: renderPixelArt({ image: input, masks: item.masks, settings }, { upscale: true, time }),
      settings,
    };
  };

  interface SheetOutput {
    png: Blob;
    json: string;
    name: string;
    metaName: string;
    sheet: ReturnType<typeof packSpritesheets>[number];
  }

  const buildSheetOutputs = async (
    frames: PixelImage[],
    durations: number[],
    fps: number,
    base: string,
  ): Promise<SheetOutput[]> => {
    const sheets = packSpritesheets(frames, video.spritesheet, durations);
    const outputs: SheetOutput[] = [];
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      const suffix = sheets.length > 1 ? `-sheet-${i + 1}` : '-sheet';
      const nameBase = `${base}${suffix}`;
      const png = await pixelImageToBlob(sheet.image, 'png', 1);
      const json = JSON.stringify(spritesheetMetadata(sheet, nameBase, fps), null, 2);
      outputs.push({ png, json, name: `${nameBase}.png`, metaName: `${nameBase}.json`, sheet });
    }
    return outputs;
  };

  const downloadSheetOutputs = async (outputs: SheetOutput[], base: string): Promise<void> => {
    if (outputs.length === 1) {
      const only = outputs[0];
      downloadBlob(only.png, only.name);
      downloadText(only.json, only.metaName);
      return;
    }
    await downloadZip(
      outputs.flatMap((out) => [
        { name: out.name, data: out.png },
        { name: out.metaName, data: out.json },
      ]),
      `${base}-sheets.zip`,
    );
  };

  const runSpritesheet = async (
    items: GraphMediaItem[],
    assetName: string,
    fps: number,
    isVideo: boolean,
  ): Promise<{ outputs: SheetOutput[]; frameCount: number; base: string; isVideo: boolean }> => {
    const frames: PixelImage[] = [];
    const durations: number[] = [];
    for (let i = 0; i < items.length; i++) {
      setProgress(`Rendering frame ${i + 1} / ${items.length}`);
      const { result } = renderItem(items[i]);
      frames.push(result.art);
      durations.push(1 / Math.max(0.1, fps));
    }
    if (frames.length === 0) throw new Error('No frames to pack.');
    setProgress('Packing spritesheet…');
    const base = assetName.replace(/\.[^.]+$/, '') || 'pixelart';
    const outputs = await buildSheetOutputs(frames, durations, fps, base);
    return { outputs, frameCount: frames.length, base, isVideo };
  };

  const exportSpritesheetOnly = async (): Promise<void> => {
    const sourceItems = outputItems.length > 0 ? outputItems : activeItem ? [activeItem] : [];
    if (sourceItems.length === 0) {
      notify('No assets connected to this output.', 'warn');
      return;
    }
    const fps = video.fps;
    try {
      const built = await runSpritesheet(sourceItems, activeAsset?.name ?? 'pixelart', fps, false);
      await downloadSheetOutputs(built.outputs, built.base);
      notify(
        `Spritesheet exported (${built.outputs.length} sheet${built.outputs.length === 1 ? '' : 's'}, ${built.frameCount} frames).`,
        'success',
      );
    } catch (err) {
      notify(`Spritesheet export failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
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
    const wantsVideo = settings.video.output === 'video' || settings.video.output === 'both';
    let wantsSheet = settings.video.output === 'spritesheet' || settings.video.output === 'both';

    // Pre-flight the output size before decoding every frame. Long videos at a
    // high export scale can exceed canvas or codec limits; fail clearly (or
    // skip just the sheet) instead of after minutes of work.
    if (wantsVideo || wantsSheet) {
      const est = computeArtSize(activeAsset.width, activeAsset.height, item.resolution);
      const count = Math.max(1, frameEstimate || outputItems.length || 1);
      const cellW = Math.max(1, est.exportWidth);
      const cellH = Math.max(1, est.exportHeight);
      const MAX_VIDEO_SIDE = 8192;
      if (wantsVideo && (cellW > MAX_VIDEO_SIDE || cellH > MAX_VIDEO_SIDE)) {
        notify(
          `Video output would be ${cellW}×${cellH}. Reduce the Art size or export scale to keep both sides at ${MAX_VIDEO_SIDE}px or less.`,
          'error',
        );
        return;
      }
      if (wantsSheet) {
        const split = settings.video.spritesheet.split !== false;
        const area = cellW * cellH * count;
        if (cellW > SHEET_MAX_SIDE || cellH > SHEET_MAX_SIDE) {
          const message = `Spritesheet skipped: each frame is ${cellW}×${cellH}, above the ${SHEET_MAX_SIDE}px canvas limit. Reduce the Art size or export scale, or choose Video only.`;
          if (!wantsVideo) {
            notify(message, 'error');
            return;
          }
          wantsSheet = false;
          notify(message, 'warn');
        } else if (!split && area > SHEET_MAX_PIXELS) {
          const message = `Spritesheet skipped: ${count} frames at ${cellW}×${cellH} need ${(area / 1_000_000).toFixed(1)} Mpx and sheet splitting is off. Enable Split, reduce the Art size or export scale, or choose Video only.`;
          if (!wantsVideo) {
            notify(message, 'error');
            return;
          }
          wantsSheet = false;
          notify(message, 'warn');
        }
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress('Starting video encoder…');
    try {
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
          const { result } = renderItem(item, frame, timestamp);
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
      let sheetOutputs: SheetOutput[] = [];
      let sheetError: unknown = null;

      if (wantsSheet) {
        try {
          setProgress('Packing spritesheet…');
          sheetOutputs = await buildSheetOutputs(
            frames,
            frames.map(() => 1 / settings.video.fps),
            settings.video.fps,
            base,
          );
        } catch (err) {
          sheetError = err;
        }
      }

      if (wantsVideo && resultInfo) {
        const file = formatFilename(settings.output.filenamePattern, {
          name: base,
          width: resultInfo.width,
          height: resultInfo.height,
          ext: resultInfo.extension,
        });
        if (sheetOutputs.length > 0) {
          await downloadZip(
            [
              { name: file, data: resultInfo.blob },
              ...sheetOutputs.flatMap((out) => [
                { name: out.name, data: out.png },
                { name: out.metaName, data: out.json },
              ]),
            ],
            `${base}-pixelart.zip`,
          );
          notify(
            `Video + ${sheetOutputs.length} spritesheet${sheetOutputs.length === 1 ? '' : 's'} exported (${frames.length} frames, ${resultInfo.extension.toUpperCase()}).`,
            'success',
          );
        } else {
          downloadBlob(resultInfo.blob, file);
          if (sheetError) {
            notify(
              `Video exported, but the spritesheet failed: ${sheetError instanceof Error ? sheetError.message : sheetError}`,
              'warn',
            );
          } else {
            notify(
              `Video exported: ${resultInfo.width}×${resultInfo.height}, ${resultInfo.extension.toUpperCase()} (${resultInfo.codec}).`,
              'success',
            );
          }
        }
      } else if (sheetOutputs.length > 0) {
        await downloadSheetOutputs(sheetOutputs, base);
        notify(
          `Spritesheet exported (${sheetOutputs.length} sheet${sheetOutputs.length === 1 ? '' : 's'}, ${frames.length} frames).`,
          'success',
        );
      } else if (sheetError) {
        notify(`Spritesheet failed: ${sheetError instanceof Error ? sheetError.message : sheetError}`, 'error');
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

  const exportPrint = async (): Promise<void> => {
    const isVideo = activeAsset?.kind === 'video' && !!activeAsset.file;
    const videoItem = isVideo
      ? outputItems.find((i) => i.assetId === activeAsset!.id) ?? activeItem
      : activeItem;
    const imageItems = outputItems.length > 0 ? outputItems : activeItem ? [activeItem] : [];
    if ((isVideo && !videoItem) || (!isVideo && imageItems.length === 0)) {
      notify('Add frames or a video to this output first.', 'warn');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress('Preparing print frames…');
    try {
      const frames: PixelImage[] = [];
      const printSettings = { ...settingsFromItem(videoItem ?? imageItems[0]), output, video };

      if (isVideo && activeAsset?.file) {
        await extractVideoFrames(
          activeAsset.file,
          {
            start,
            end: video.end !== null ? Math.min(duration, Math.max(start + 0.05, video.end)) : duration,
            fps: video.fps,
            signal: controller.signal,
            onProgress: (done, total) => setProgress(`Decoding print frame ${done} / ${total}`),
          },
          async (frame, i) => {
            setProgress(`Rendering print frame ${i + 1}`);
            const result = renderPixelArt(
              {
                image: videoItem
                  ? applyTrackedAlphaCuts(videoItem, frame, i / Math.max(0.1, video.fps), trackedMasks)
                  : frame,
                masks: videoItem?.masks,
                settings: printSettings,
              },
              { upscale: false },
            );
            frames.push(result.art);
          },
        );
      } else {
        for (let i = 0; i < imageItems.length; i++) {
          setProgress(`Rendering print frame ${i + 1} / ${imageItems.length}`);
          const item = imageItems[i];
          const result = renderPixelArt(
            { image: item.source, masks: item.masks, settings: { ...settingsFromItem(item), output, video } },
            { upscale: false },
          );
          frames.push(result.art);
        }
      }

      if (frames.length === 0) throw new Error('No frames to print.');
      setProgress('Laying out A4 pages…');
      const layout = layoutPrintPages(frames, video.print);
      const base = (activeAsset?.name ?? 'pixelart').replace(/\.[^.]+$/, '') || 'pixelart';
      const entries: Array<{ name: string; data: Blob | string }> = [];
      for (const page of layout.pages) {
        setProgress(`Encoding A4 page ${page.page} / ${layout.pages.length}…`);
        const png = await pixelImageToBlob(renderPrintPage(layout, frames, page.page - 1), 'png', 1);
        const suffix = layout.pages.length > 1 ? `-a4-${page.page}` : '-a4';
        entries.push({ name: `${base}-print${suffix}.png`, data: png });
      }
      entries.push({
        name: `${base}-print.json`,
        data: JSON.stringify(printMetadata(layout, base), null, 2),
      });
      await downloadZip(entries, `${base}-a4-print.zip`);
      notify(
        `A4 print exported (${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'}, ${frames.length} frames, ${layout.widthMm}×${layout.heightMm} mm).`,
        'success',
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        notify('A4 print cancelled.', 'warn');
      } else {
        notify(`A4 print failed: ${err instanceof Error ? err.message : err}`, 'error');
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
          <Toggle
            label="Split into multiple sheets"
            checked={video.spritesheet.split !== false}
            onChange={(v) => setSheet({ split: v })}
          />
        </div>

        <div className="inset-panel">
          <span className="inset-title">Print / rescan (A4)</span>
          <div className="two-col">
            <SelectField
              label="Orientation"
              value={video.print.orientation}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(v) => setPrint({ orientation: v as PrintSettings['orientation'] })}
            />
            <SelectField
              label="DPI"
              value={String(video.print.dpi)}
              options={[
                { value: '150', label: '150 DPI' },
                { value: '300', label: '300 DPI' },
                { value: '600', label: '600 DPI' },
              ]}
              onChange={(v) => setPrint({ dpi: Number(v) })}
            />
          </div>
          <div className="two-col">
            <Slider label="Margin" value={video.print.marginMm} min={2} max={30} step={1} unit="mm" onChange={(v) => setPrint({ marginMm: v })} />
            <Slider label="Gutter" value={video.print.gutterMm} min={1} max={20} step={1} unit="mm" onChange={(v) => setPrint({ gutterMm: v })} />
          </div>
          <div className="two-col">
            <Slider label="+ mark" value={video.print.markMm} min={1} max={10} step={1} unit="mm" onChange={(v) => setPrint({ markMm: v })} />
            <Segmented
              label="Size"
              value={video.print.scaleMode}
              options={[
                { value: 'actual', label: 'Actual' },
                { value: 'fit', label: 'Fit width' },
              ]}
              onChange={(v) => setPrint({ scaleMode: v as PrintSettings['scaleMode'] })}
            />
          </div>
          <button type="button" className="ghost-btn small" onClick={() => void exportPrint()} disabled={busy}>
            <Icon name="download" size={14} /> Export A4 print pages
          </button>
          <p className="micro-copy">
            A4 pages with black + registration marks in the gutters and a JSON frame map. Print at 100%; rescan and
            align to the marks.
          </p>
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
