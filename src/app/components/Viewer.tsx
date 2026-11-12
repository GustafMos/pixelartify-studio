import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMask, featherMask, invertMask } from '../../core/image';
import type { GraphNode, MaskData } from '../../core/types';
import { useStudio } from '../store';
import { pixelImageToDataUrl } from '../io';
import { GPU_MIN_PIXELS, gpuAvailable } from '../gpuPixelate';
import { GPU_MIN_DITHER_PIXELS, gpuDitherAvailable, supportsGpuDither } from '../gpuFinish';
import { Icon } from './icons';
import { Badge, IconButton, Segmented, Slider, Spinner } from './controls';

export function Viewer({ resizeKey }: { resizeKey?: number | string } = {}): React.ReactElement {
  const {
    preview,
    previewError,
    isRendering,
    activeAsset,
    videoFrame,
    videoTime,
    setVideoTime,
    videoFrameLoading,
    videoPlaying,
    setVideoPlaying,
    onPlaybackFrame,
    activeItem,
    maskEdit,
    endMaskEdit,
    setMaskEdit,
    maskOverrides,
    setMaskOverride,
    notify,
    mode,
    selectedNode,
    graph,
    evaluation,
    activeAssetId,
    previewFullQuality,
    setPreviewFullQuality,
  } = useStudio();

  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<MaskData | null>(null);
  const paintingRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoTimeRef = useRef(videoTime);
  videoTimeRef.current = videoTime;
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [compare, setCompare] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [autoFit, setAutoFit] = useState(true);
  const [panning, setPanning] = useState(false);
  const [compareDragging, setCompareDragging] = useState(false);

  const art = preview?.art ?? null;
  const artW = art?.width ?? 1;
  const artH = art?.height ?? 1;
  const artUrl = useMemo(() => (art ? pixelImageToDataUrl(art) : null), [art]);
  const gpuSampler = useMemo(() => gpuAvailable(), []);
  const gpuActive = gpuSampler && artW * artH >= GPU_MIN_PIXELS;
  const ditherSampler = useMemo(() => gpuDitherAvailable(), []);
  const ditherActive = Boolean(
    ditherSampler &&
      activeItem &&
      artW * artH >= GPU_MIN_DITHER_PIXELS &&
      supportsGpuDither(activeItem.dither.algorithm),
  );

  // Set up a hidden <video> used for smooth playback. The normal preview path
  // still decodes through Mediabunny; playback bypasses it to avoid opening a
  // decoder for every displayed frame.
  useEffect(() => {
    if (activeAsset?.kind !== 'video' || !activeAsset.file) {
      setVideoPlaying(false);
      return;
    }
    const url = URL.createObjectURL(activeAsset.file);
    const el = document.createElement('video');
    el.src = url;
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = true;
    el.style.cssText =
      'position:fixed;left:-4px;top:-4px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(el);
    el.addEventListener('loadedmetadata', () => {
      el.currentTime = Math.min(Math.max(0, videoTimeRef.current), Math.max(0, el.duration || 0));
    });
    videoElRef.current = el;
    return () => {
      setVideoPlaying(false);
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      URL.revokeObjectURL(url);
      if (videoElRef.current === el) videoElRef.current = null;
    };
  }, [activeAsset?.id, setVideoPlaying]);

  // Keep the hidden element in sync while the user scrubs a paused video.
  useEffect(() => {
    if (videoPlaying) return;
    const el = videoElRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const target = Math.min(Math.max(0, videoTime), Math.max(0, el.duration || 0));
    if (Math.abs(el.currentTime - target) > 0.08) el.currentTime = target;
  }, [videoTime, videoPlaying, activeAsset?.id]);

  useEffect(() => {
    if (!videoPlaying) return;
    const el = videoElRef.current;
    if (!el) {
      setVideoPlaying(false);
      return;
    }
    const canvas = videoCanvasRef.current ?? document.createElement('canvas');
    videoCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setVideoPlaying(false);
      return;
    }
    let raf = 0;
    let lastSample = 0;
    const tick = () => {
      const video = videoElRef.current;
      if (!video) return;
      const now = performance.now();
      if (now - lastSample >= 55 && video.videoWidth > 0) {
        lastSample = now;
        const maxSide = 960;
        const s = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * s));
        const h = Math.max(1, Math.round(video.videoHeight * s));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        onPlaybackFrame(
          { width: w, height: h, data: new Uint8ClampedArray(data.data) },
          video.currentTime,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    el.loop = true;
    void el.play().catch(() => {
      setVideoPlaying(false);
      notify('Could not play this video in the browser.', 'warn');
    });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.pause();
    };
  }, [videoPlaying, onPlaybackFrame, notify, setVideoPlaying]);

  const togglePlayback = useCallback(() => {
    const el = videoElRef.current;
    if (!el) return;
    if (videoPlaying) {
      setVideoPlaying(false);
      setVideoTime(el.currentTime);
      return;
    }
    if (Number.isFinite(el.duration)) {
      const target = Math.min(Math.max(0, videoTime), Math.max(0, el.duration || 0));
      if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
    }
    setVideoPlaying(true);
  }, [videoPlaying, videoTime, setVideoPlaying, setVideoTime]);

  const fit = useCallback(
    (size?: { width: number; height: number }) => {
      const el = viewportRef.current;
      if (!el || !art) return;
      const padding = 24;
      const width = size?.width ?? el.clientWidth;
      const height = size?.height ?? el.clientHeight;
      const availableW = Math.max(24, width - padding * 2);
      const availableH = Math.max(24, height - padding * 2);
      const s = Math.min(availableW / art.width, availableH / art.height);
      setScale(Math.max(0.1, Math.min(24, s)));
      setPan({ x: 0, y: 0 });
    },
    [art],
  );

  const fitNow = useCallback(() => {
    setAutoFit(true);
    fit();
  }, [fit]);

  // Refit whenever the art changes or the viewer pane is resized (tabs, split
  // divider, window resize) while auto-fit is enabled.
  useEffect(() => {
    if (!autoFit) return;
    fit();
  }, [autoFit, fit, art?.width, art?.height, resizeKey]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (autoFit) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoFit, fit]);

  useEffect(() => {
    if (!autoFit) return;
    const onResize = (): void => fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [autoFit, fit]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (maskEdit) return;
      e.preventDefault();
      setAutoFit(false);
      setScale((prev) => Math.max(0.2, Math.min(32, prev * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [maskEdit]);

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: PointerEvent): void => {
      const p = panRef.current;
      if (!p) return;
      setPan({ x: p.x + e.clientX - p.px, y: p.y + e.clientY - p.py });
    };
    const onUp = (): void => {
      panRef.current = null;
      setPanning(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panning]);

  const originalUrl = useMemo(() => {
    if (videoFrame) return pixelImageToDataUrl(videoFrame);
    if (activeAsset) return pixelImageToDataUrl(activeAsset.image);
    return null;
  }, [activeAsset, videoFrame]);

  const setCompareFromClientX = useCallback((clientX: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setComparePos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const startCompareDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCompareDragging(true);
      setCompareFromClientX(e.clientX);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is optional; window listeners below are the fallback.
      }
      const onMove = (event: PointerEvent): void => setCompareFromClientX(event.clientX);
      const onUp = (): void => {
        setCompareDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [setCompareFromClientX],
  );

  const maskNode = maskEdit ? graph.nodes.find((n) => n.id === maskEdit.nodeId) : null;
  const maskKey = maskEdit && activeAsset ? `${maskEdit.nodeId}:${activeAsset.id}:${maskEdit.maskId}` : '';
  const override = maskKey ? maskOverrides[maskKey] : undefined;

  const autoMask = useMemo(() => {
    if (!maskEdit || !activeAsset) return null;
    const value = evaluation.values.get(maskEdit.nodeId)?.mask;
    if (!value || value.type !== 'mask') return null;
    const item = value.items.find((m) => m.assetId === activeAsset.id) ?? value.items[0];
    return item?.mask ?? null;
  }, [evaluation, maskEdit, activeAsset]);

  const [paintVersion, setPaintVersion] = useState(0);

  useEffect(() => {
    if (!maskEdit) {
      paintRef.current = null;
      return;
    }
    const base =
      override ??
      autoMask ??
      createMask(
        Math.max(16, Math.min(1024, artW * 2)),
        Math.max(16, Math.min(1024, artH * 2)),
      );
    paintRef.current = { width: base.width, height: base.height, data: new Uint8Array(base.data) };
    setPaintVersion((v) => v + 1);
  }, [maskEdit, override, autoMask, artW, artH]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    const mask = paintRef.current;
    if (!canvas || !mask) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i];
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 60;
      img.data[i * 4 + 2] = 200;
      img.data[i * 4 + 3] = v * 0.52;
    }
    ctx.putImageData(img, 0, 0);
  }, [paintVersion, maskEdit]);

  const commitMask = useCallback(() => {
    if (!maskEdit || !paintRef.current || !maskKey) return;
    setMaskOverride(maskKey, {
      width: paintRef.current.width,
      height: paintRef.current.height,
      data: new Uint8Array(paintRef.current.data),
    });
    setPaintVersion((v) => v + 1);
  }, [maskEdit, maskKey, setMaskOverride]);

  const paintAt = (clientX: number, clientY: number, erase: boolean): void => {
    const canvas = maskCanvasRef.current;
    const mask = paintRef.current;
    if (!canvas || !mask || !maskEdit || !art) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((clientX - rect.left) / rect.width) * mask.width;
    const y = ((clientY - rect.top) / rect.height) * mask.height;
    const scaleFactor = mask.width / Math.max(1, art.width);
    const radius = Math.max(0.7, (maskEdit.brushSize / 2) * scaleFactor);
    const soft = Math.min(0.98, maskEdit.feather / 10);
    const inner = radius * (1 - soft);
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(mask.width - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(mask.height - 1, Math.ceil(y + radius));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > radius) continue;
        let t = 1;
        if (d > inner) {
          t = 1 - (d - inner) / Math.max(0.001, radius - inner);
          t = t * t * (3 - 2 * t);
        }
        const value = Math.round(t * 255);
        const i = yy * mask.width + xx;
        if (erase) {
          mask.data[i] = Math.min(mask.data[i], 255 - value);
        } else {
          mask.data[i] = Math.max(mask.data[i], value);
        }
      }
    }
    setPaintVersion((v) => v + 1);
  };

  return (
    <div className="viewer-shell">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <Badge tone="accent">{mode === 'studio' ? 'Output preview' : `${selectedNode?.title ?? 'Stage'} preview`}</Badge>
          {art ? (
            <span className="viewer-meta">
              {art.width}×{art.height} art px
              {preview ? ` · ${preview.stats.durationMs.toFixed(0)} ms` : ''}
              {preview?.stats.edgeAware ? ' · edge-aware' : ''}
            </span>
          ) : null}
          <Badge tone={gpuActive ? 'success' : 'neutral'}>
            {gpuActive ? 'GPU sampler' : gpuSampler ? 'CPU sampler (small)' : 'CPU sampler'}
          </Badge>
          {ditherActive ? <Badge tone="success">GPU dither</Badge> : null}
        </div>
        <div className="viewer-toolbar-right">
          <IconButton
            icon="zoomOut"
            label="Zoom out"
            onClick={() => {
              setAutoFit(false);
              setScale((s) => Math.max(0.2, s / 1.25));
            }}
          />
          <span className="zoom-pill">{Math.round(scale * 100)}%</span>
          <IconButton
            icon="zoomIn"
            label="Zoom in"
            onClick={() => {
              setAutoFit(false);
              setScale((s) => Math.min(32, s * 1.25));
            }}
          />
          <IconButton
            icon="fit"
            label="Fit preview — keep the image fitted when the pane is resized"
            active={autoFit}
            onClick={fitNow}
          />
          <IconButton icon="grid" label="Toggle pixel grid" active={showGrid} onClick={() => setShowGrid((v) => !v)} />
          <IconButton icon="eye" label="Compare with source" active={compare} onClick={() => setCompare((v) => !v)} />
          <IconButton
            icon="wand"
            label={previewFullQuality ? 'Fast preview (lower working resolution)' : 'Full-quality preview'}
            active={!previewFullQuality}
            onClick={() => setPreviewFullQuality(!previewFullQuality)}
          />
          {preview ? (
            <a
              className="icon-btn"
              href={artUrl ?? undefined}
              download={`${(activeAsset?.name ?? 'pixelart').replace(/\.[^.]+$/, '')}-${artW}x${artH}.png`}
              title="Quick save preview PNG"
            >
              <Icon name="download" size={17} />
            </a>
          ) : null}
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`viewer-viewport ${maskEdit ? 'is-mask-editing' : ''}`}
        onPointerDown={(e) => {
          if (maskEdit || e.target !== e.currentTarget) return;
          panRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
          setPanning(true);
        }}
      >
        <div className="checkerboard" />
        {previewError ? (
          <div className="viewer-error">
            <Icon name="close" size={20} />
            <strong>Render failed</strong>
            <span>{previewError}</span>
          </div>
        ) : null}
        {!art && !previewError ? (
          <div className="viewer-empty">
            <Icon name="image" size={34} />
            <strong>No preview yet</strong>
            <span>Add media to a Media input node and connect it to an Output.</span>
          </div>
        ) : null}
        {art ? (
          <div
            className="viewer-stage"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            <div
              ref={wrapperRef}
              className="art-wrapper"
              style={{
                width: artW * scale,
                height: artH * scale,
              }}
            >
              <img
                className="art-image"
                src={artUrl ?? undefined}
                alt="Pixel art preview"
                width={artW * scale}
                height={artH * scale}
                draggable={false}
                style={{ imageRendering: 'pixelated' }}
              />
              {compare && originalUrl && !maskEdit ? (
                <>
                  <img
                    className="compare-image"
                    src={originalUrl}
                    alt="Source comparison"
                    style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)`, imageRendering: 'auto' }}
                    draggable={false}
                  />
                  <div className="compare-line" style={{ left: `${comparePos}%` }}>
                    <span />
                  </div>
                  <div
                    className={`compare-drag-surface ${compareDragging ? 'is-dragging' : ''}`}
                    role="slider"
                    tabIndex={0}
                    aria-label="Comparison position"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(comparePos)}
                    title="Drag left/right to compare with the source"
                    onPointerDown={startCompareDrag}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        setComparePos((v) => Math.max(0, v - 2));
                      } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        setComparePos((v) => Math.min(100, v + 2));
                      } else if (e.key === 'Home') {
                        e.preventDefault();
                        setComparePos(0);
                      } else if (e.key === 'End') {
                        e.preventDefault();
                        setComparePos(100);
                      }
                    }}
                  />
                </>
              ) : null}
              {showGrid && scale >= 5 ? (
                <div
                  className="pixel-grid"
                  style={{
                    backgroundSize: `${scale}px ${scale}px`,
                  }}
                />
              ) : null}
              {maskEdit ? (
                <canvas
                  ref={maskCanvasRef}
                  className="mask-canvas"
                  width={paintRef.current?.width ?? 1}
                  height={paintRef.current?.height ?? 1}
                  style={{ width: artW * scale, height: artH * scale }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    paintingRef.current = true;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    paintAt(e.clientX, e.clientY, e.shiftKey || maskEdit.action === 'erase');
                  }}
                  onPointerMove={(e) => {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                    if (paintingRef.current) paintAt(e.clientX, e.clientY, maskEdit.action === 'erase');
                  }}
                  onPointerUp={() => {
                    paintingRef.current = false;
                    commitMask();
                  }}
                  onPointerLeave={() => {
                    paintingRef.current = false;
                    setCursor(null);
                  }}
                />
              ) : null}
              {maskEdit && cursor ? (
                <div
                  className="brush-cursor"
                  style={{
                    left: cursor.x - (maskEdit.brushSize * scale) / 2,
                    top: cursor.y - (maskEdit.brushSize * scale) / 2,
                    width: maskEdit.brushSize * scale,
                    height: maskEdit.brushSize * scale,
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {isRendering ? (
          <div className="rendering-pill">
            <Spinner /> Rendering…
          </div>
        ) : null}
      </div>

      {maskEdit ? (
        <MaskToolbar
          maskEdit={maskEdit}
          setMaskEdit={setMaskEdit}
          onDone={endMaskEdit}
          paintRef={paintRef}
          commitMask={commitMask}
          setPaintVersion={setPaintVersion}
          activeAssetId={activeAssetId}
          maskNode={maskNode}
          notify={notify}
        />
      ) : null}

      {activeAsset?.kind === 'video' && activeAsset.duration ? (
        <div className="video-timeline">
          <IconButton
            icon={videoPlaying ? 'pause' : 'play'}
            label={videoPlaying ? 'Pause video' : 'Play video'}
            size={16}
            onClick={togglePlayback}
          />
          <Icon name="film" size={15} />
          <input
            type="range"
            min={0}
            max={activeAsset.duration}
            step={1 / Math.max(1, activeAsset.fps ?? 24)}
            value={Math.min(videoTime, activeAsset.duration)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setVideoTime(next);
              const video = videoElRef.current;
              if (video && Number.isFinite(video.duration)) video.currentTime = next;
            }}
            aria-label="Video time"
          />
          <span className="time-readout">
            {videoTime.toFixed(2)} / {activeAsset.duration.toFixed(2)} s
          </span>
          {videoFrameLoading && !videoPlaying ? <Spinner /> : null}
        </div>
      ) : null}
    </div>
  );
}

function MaskToolbar({
  maskEdit,
  setMaskEdit,
  onDone,
  paintRef,
  commitMask,
  setPaintVersion,
  activeAssetId,
  maskNode,
  notify,
}: {
  maskEdit: NonNullable<ReturnType<typeof useStudio>['maskEdit']>;
  setMaskEdit: (patch: Partial<NonNullable<ReturnType<typeof useStudio>['maskEdit']>>) => void;
  onDone: () => void;
  paintRef: React.MutableRefObject<MaskData | null>;
  commitMask: () => void;
  setPaintVersion: React.Dispatch<React.SetStateAction<number>>;
  activeAssetId: string | null;
  maskNode: GraphNode | null | undefined;
  notify: (message: string, kind?: 'info' | 'success' | 'error' | 'warn') => void;
}): React.ReactElement {
  return (
    <div className="mask-toolbar">
      <div className="mask-toolbar-title">
        <Icon name="brush" size={15} />
        <strong>Painting “{maskEdit.maskId}”</strong>
        <span>{maskNode ? maskNode.title : 'mask'}</span>
      </div>
      <Segmented
        value={maskEdit.action}
        options={[
          { value: 'add', label: 'Add' },
          { value: 'erase', label: 'Erase' },
        ]}
        onChange={(v) => setMaskEdit({ action: v })}
      />
      <div className="mask-slider">
        <Slider label="Brush" value={maskEdit.brushSize} min={2} max={80} step={1} unit="px" onChange={(v) => setMaskEdit({ brushSize: v })} />
      </div>
      <div className="mask-slider">
        <Slider label="Softness" value={maskEdit.feather} min={0} max={8} step={0.1} onChange={(v) => setMaskEdit({ feather: v })} />
      </div>
      <button
        type="button"
        className="ghost-btn small"
        onClick={() => {
          if (!paintRef.current) return;
          const next = invertMask(paintRef.current);
          paintRef.current.data = next.data;
          setPaintVersion((v) => v + 1);
          commitMask();
        }}
      >
        <Icon name="refresh" size={13} /> Invert
      </button>
      <button
        type="button"
        className="ghost-btn small"
        onClick={() => {
          if (!paintRef.current) return;
          paintRef.current.data.fill(0);
          setPaintVersion((v) => v + 1);
          commitMask();
        }}
      >
        Clear
      </button>
      <button
        type="button"
        className="ghost-btn small"
        onClick={() => {
          if (!paintRef.current) return;
          const feathered = featherMask(paintRef.current, Math.max(1, maskEdit.feather));
          paintRef.current.data = feathered.data;
          setPaintVersion((v) => v + 1);
          commitMask();
        }}
      >
        Feather
      </button>
      <button type="button" className="primary-btn small" onClick={onDone}>
        Done
      </button>
      {!activeAssetId ? <span className="field-warning">Select an asset to paint.</span> : null}
      <span className="mask-tip">Shift erases · mask is saved as an override</span>
    </div>
  );
}
