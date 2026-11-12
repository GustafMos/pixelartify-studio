import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMask, featherMask, invertMask } from '../../core/image';
import { buildMagicMask, type MagicSeed } from '../../core/magic';
import type { GraphNode, MaskData, PixelImage } from '../../core/types';
import { useStudio } from '../store';
import { pixelImageToBlob, downloadBlob, pixelImageToDataUrl } from '../io';
import { renderPixelArt, settingsFromItem } from '../../core';
import { applyTrackedAlphaCuts } from '../../core/graph';
import { playbackPaletteKey, playbackSettings } from '../playback';
import { GPU_MIN_PIXELS, gpuAvailable } from '../gpuPixelate';
import { GPU_MIN_DITHER_PIXELS, gpuDitherAvailable, supportsGpuDither } from '../gpuFinish';
import { GPU_MIN_EFFECT_PIXELS, gpuEffectsAvailable, supportsGpuEffects } from '../gpuEffects';
import { GPU_MIN_LAYER_PIXELS, gpuLayersAvailable } from '../gpuLayers';
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
    animationTime,
    animationPlaying,
    hasAnimation,
    animationDuration,
    animationFps,
    animationLoop,
    setAnimationTime,
    setAnimationPlaying,
    renderAnimationFrame,
    activeItem,
    subjectSelect,
    endSubjectSelect,
    maskTracking,
    trackSubject,
    clearTrackedMask,
    trackedMasks,
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
  const artCanvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<MaskData | null>(null);
  const paintingRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackPaletteRef = useRef<{ key: string; colors: string[] } | null>(null);
  const videoTimeRef = useRef(videoTime);
  videoTimeRef.current = videoTime;
  const animationTimeRef = useRef(animationTime);
  animationTimeRef.current = animationTime;
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [compare, setCompare] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [autoFit, setAutoFit] = useState(true);
  const [panning, setPanning] = useState(false);
  const [compareDragging, setCompareDragging] = useState(false);
  const [subjectRect, setSubjectRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const subjectStartRef = useRef<{ x: number; y: number } | null>(null);
  const magicCanvasRef = useRef<HTMLCanvasElement>(null);
  const magicStrokesRef = useRef<Array<{ points: Array<{ x: number; y: number }>; positive: boolean; radiusPx: number }>>([]);
  const magicDrawingRef = useRef(false);
  const [magicMode, setMagicMode] = useState<'add' | 'erase'>('add');
  const [magicBrush, setMagicBrush] = useState(18);
  const [magicTolerance, setMagicTolerance] = useState(0.18);

  const art = preview?.art ?? null;
  const artW = art?.width ?? 1;
  const artH = art?.height ?? 1;
  const gpuSampler = useMemo(() => gpuAvailable(), []);
  const gpuActive = gpuSampler && artW * artH >= GPU_MIN_PIXELS;
  const ditherSampler = useMemo(() => gpuDitherAvailable(), []);
  const ditherActive = Boolean(
    ditherSampler &&
      activeItem &&
      artW * artH >= GPU_MIN_DITHER_PIXELS &&
      supportsGpuDither(activeItem.dither.algorithm),
  );
  const effectsSampler = useMemo(() => gpuEffectsAvailable(), []);
  const effectsActive = Boolean(
    effectsSampler &&
      activeItem &&
      artW * artH >= GPU_MIN_EFFECT_PIXELS &&
      (supportsGpuEffects('preprocess', [
        ...activeItem.preprocessOps,
        ...activeItem.latePreprocessOps,
      ]) ||
        supportsGpuEffects('postprocess', activeItem.postprocess.ops)),
  );
  const layersSampler = useMemo(() => gpuLayersAvailable(), []);
  const layersActive = Boolean(
    layersSampler &&
      activeItem &&
      artW * artH >= GPU_MIN_LAYER_PIXELS &&
      activeItem.layers.some((layer) => layer.visible && (!layer.maskId || activeItem.masks[layer.maskId])),
  );

  const paintArt = useCallback((image: PixelImage) => {
    const canvas = artCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== image.width) canvas.width = image.width;
    if (canvas.height !== image.height) canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const frame = ctx.createImageData(image.width, image.height);
    frame.data.set(image.data);
    ctx.putImageData(frame, 0, 0);
  }, []);

  useEffect(() => {
    if (art) paintArt(art);
  }, [art, paintArt]);

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
    if (!activeItem) {
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

    const baseSettings = settingsFromItem(activeItem);
    const renderSettings = playbackSettings(baseSettings, activeItem);
    const paletteKey = playbackPaletteKey(baseSettings, activeItem.assetId);
    let timer = 0;
    let lastTimeUpdate = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoElRef.current;
      if (!video || video.videoWidth === 0) {
        timer = window.setTimeout(tick, 40);
        return;
      }
      const started = performance.now();
      try {
        const maxSide = 640;
        const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const time = video.currentTime;
        const frame: PixelImage = {
          width: w,
          height: h,
          data: new Uint8ClampedArray(data.data),
        };
        const source = applyTrackedAlphaCuts(activeItem, frame, time, trackedMasks);
        const paletteOverride =
          playbackPaletteRef.current?.key === paletteKey
            ? playbackPaletteRef.current.colors
            : undefined;
        const result = renderPixelArt(
          { image: source, masks: activeItem.masks, settings: renderSettings },
          { upscale: false, seed: 0, maxWorkingSide: 384, paletteOverride, time },
        );
        if (result.palette.length > 0) {
          playbackPaletteRef.current = { key: paletteKey, colors: result.palette };
        }
        paintArt(result.art);
        if (started - lastTimeUpdate > 250) {
          lastTimeUpdate = started;
          setVideoTime(time);
        }
      } catch (err) {
        stopped = true;
        setVideoPlaying(false);
        notify(`Playback render failed: ${err instanceof Error ? err.message : err}`, 'error');
        return;
      }
      const elapsed = performance.now() - started;
      timer = window.setTimeout(tick, Math.max(0, 40 - elapsed));
    };

    el.loop = true;
    void el.play().catch(() => {
      setVideoPlaying(false);
      notify('Could not play this video in the browser.', 'warn');
    });
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      el.pause();
    };
  }, [
    activeItem,
    notify,
    paintArt,
    setVideoPlaying,
    setVideoTime,
    trackedMasks,
    videoPlaying,
  ]);

  // Animation playback for generated/still scenes. Frames are painted directly
  // to the art canvas so React does not re-render the editor at 24 fps.
  useEffect(() => {
    if (!animationPlaying) return;
    if (activeAsset?.kind === 'video') {
      setAnimationPlaying(false);
      return;
    }
    let stopped = false;
    let timer = 0;
    let lastUpdate = 0;
    const start = performance.now();
    const base = animationTimeRef.current;

    const tick = (): void => {
      if (stopped) return;
      const elapsed = (performance.now() - start) / 1000;
      let t = base + elapsed;
      if (animationLoop && animationDuration > 0) t %= animationDuration;
      const frameStart = performance.now();
      try {
        const result = renderAnimationFrame(t);
        if (result) paintArt(result.art);
        if (frameStart - lastUpdate > 250) {
          lastUpdate = frameStart;
          setAnimationTime(t);
        }
      } catch (err) {
        stopped = true;
        setAnimationPlaying(false);
        notify(
          `Animation frame failed: ${err instanceof Error ? err.message : err}`,
          'error',
        );
        return;
      }
      const budget = 1000 / Math.max(1, animationFps);
      timer = window.setTimeout(tick, Math.max(0, budget - (performance.now() - frameStart)));
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [
    animationPlaying,
    animationLoop,
    animationDuration,
    animationFps,
    activeAsset?.kind,
    notify,
    paintArt,
    renderAnimationFrame,
    setAnimationPlaying,
    setAnimationTime,
  ]);

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

  const toggleAnimation = useCallback(() => {
    if (!hasAnimation) return;
    if (animationPlaying) {
      setAnimationPlaying(false);
      return;
    }
    setAnimationPlaying(true);
  }, [hasAnimation, animationPlaying, setAnimationPlaying]);

  const normalizeSubjectPoint = useCallback((clientX: number, clientY: number) => {
    const el = wrapperRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height))),
    };
  }, []);

  const commitSubjectRect = useCallback(
    (rect: { x0: number; y0: number; x1: number; y1: number }) => {
      if (!subjectSelect) return;
      if (!activeAsset) {
        notify('Select a media asset first.', 'warn');
        return;
      }
      const source = activeItem?.source;
      if (!source || source.width < 1 || source.height < 1) {
        notify('Connect this extractor to a media input first.', 'warn');
        return;
      }
      const left = Math.min(rect.x0, rect.x1);
      const right = Math.max(rect.x0, rect.x1);
      const top = Math.min(rect.y0, rect.y1);
      const bottom = Math.max(rect.y0, rect.y1);
      if (right - left < 0.005 || bottom - top < 0.005) return;

      const mask = createMask(source.width, source.height, 0);
      const x0 = Math.max(0, Math.min(source.width, Math.round(left * source.width)));
      const x1 = Math.max(0, Math.min(source.width, Math.round(right * source.width)));
      const y0 = Math.max(0, Math.min(source.height, Math.round(top * source.height)));
      const y1 = Math.max(0, Math.min(source.height, Math.round(bottom * source.height)));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          mask.data[y * source.width + x] = 255;
        }
      }
      const key = `${subjectSelect.nodeId}:${activeAsset.id}:${subjectSelect.maskId}`;
      clearTrackedMask(key);
      setMaskOverride(key, mask);
      notify('Subject selected. Only-extracted output is now active.', 'success');
      setSubjectRect(null);
      subjectStartRef.current = null;
      endSubjectSelect();
    },
    [activeAsset, activeItem, clearTrackedMask, endSubjectSelect, notify, setMaskOverride, subjectSelect],
  );

  const finishSubjectRect = useCallback(
    (clientX: number, clientY: number) => {
      const start = subjectStartRef.current;
      const end = normalizeSubjectPoint(clientX, clientY);
      subjectStartRef.current = null;
      if (!start || !end) return;
      commitSubjectRect({ x0: start.x, y0: start.y, x1: end.x, y1: end.y });
    },
    [commitSubjectRect, normalizeSubjectPoint],
  );

  const redrawMagicStrokes = useCallback(() => {
    const canvas = magicCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of magicStrokesRef.current) {
      const color = stroke.positive ? 'rgba(6, 214, 160, 0.55)' : 'rgba(255, 92, 92, 0.55)';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, stroke.radiusPx * 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, stroke.radiusPx, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
          const x = p.x * canvas.width;
          const y = p.y * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  }, []);

  const beginMagicStroke = useCallback(
    (clientX: number, clientY: number, erase: boolean) => {
      const p = normalizeSubjectPoint(clientX, clientY);
      if (!p) return;
      magicDrawingRef.current = true;
      magicStrokesRef.current.push({
        points: [p],
        positive: !erase,
        radiusPx: magicBrush,
      });
      redrawMagicStrokes();
    },
    [magicBrush, normalizeSubjectPoint, redrawMagicStrokes],
  );

  const moveMagicStroke = useCallback(
    (clientX: number, clientY: number) => {
      if (!magicDrawingRef.current) return;
      const p = normalizeSubjectPoint(clientX, clientY);
      const stroke = magicStrokesRef.current[magicStrokesRef.current.length - 1];
      if (!p || !stroke) return;
      const last = stroke.points[stroke.points.length - 1];
      const minStep = 2 / Math.max(1, wrapperRef.current?.clientWidth ?? 1);
      if (Math.hypot(p.x - last.x, p.y - last.y) < minStep) return;
      stroke.points.push(p);
      redrawMagicStrokes();
    },
    [normalizeSubjectPoint, redrawMagicStrokes],
  );

  const clearMagicStrokes = useCallback(() => {
    magicDrawingRef.current = false;
    magicStrokesRef.current = [];
    const canvas = magicCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const buildMagicSeeds = useCallback((source: PixelImage): MagicSeed[] => {
    const displayWidth = Math.max(1, wrapperRef.current?.clientWidth ?? 1);
    const seeds: MagicSeed[] = [];
    for (const stroke of magicStrokesRef.current) {
      const radius = Math.max(1, (stroke.radiusPx / displayWidth) * source.width);
      for (const p of stroke.points) {
        seeds.push({
          x: p.x * source.width,
          y: p.y * source.height,
          radius,
          positive: stroke.positive,
        });
      }
    }
    return seeds;
  }, []);

  const applyMagicMask = useCallback(() => {
    if (!subjectSelect || !activeAsset) return;
    const source = videoFrame ?? activeItem?.source;
    if (!source) {
      notify('Select a media asset first.', 'warn');
      return;
    }
    if (!magicStrokesRef.current.some((stroke) => stroke.positive && stroke.points.length > 0)) {
      notify('Paint over the subject before applying the magic mask.', 'warn');
      return;
    }
    const seeds = buildMagicSeeds(source);
    const mask = buildMagicMask(source, seeds, {
      tolerance: magicTolerance,
      feather: 1.5,
      maxSide: 512,
    });
    let inside = 0;
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 127) inside++;
    const key = `${subjectSelect.nodeId}:${activeAsset.id}:${subjectSelect.maskId}`;
    clearTrackedMask(key);
    setMaskOverride(key, mask);
    notify(
      `Magic mask applied (${Math.round((inside / Math.max(1, mask.data.length)) * 100)}% selected).`,
      'success',
    );
    clearMagicStrokes();
    setSubjectRect(null);
    endSubjectSelect();
  }, [
    activeAsset,
    activeItem,
    buildMagicSeeds,
    clearMagicStrokes,
    clearTrackedMask,
    endSubjectSelect,
    magicTolerance,
    notify,
    setMaskOverride,
    subjectSelect,
    videoFrame,
  ]);

  const applyMagicMaskAndTrack = useCallback(() => {
    if (!subjectSelect || !activeAsset) return;
    if (activeAsset.kind !== 'video' || !activeAsset.file) {
      applyMagicMask();
      return;
    }
    const source = videoFrame ?? activeItem?.source;
    if (!source) {
      notify('Select a video asset first.', 'warn');
      return;
    }
    if (!magicStrokesRef.current.some((stroke) => stroke.positive && stroke.points.length > 0)) {
      notify('Paint over the subject before tracking the mask.', 'warn');
      return;
    }
    const seeds = buildMagicSeeds(source);
    const { nodeId, maskId } = subjectSelect;
    clearMagicStrokes();
    setSubjectRect(null);
    endSubjectSelect();
    void trackSubject(nodeId, maskId, seeds, magicTolerance);
  }, [
    activeAsset,
    activeItem,
    applyMagicMask,
    buildMagicSeeds,
    clearMagicStrokes,
    endSubjectSelect,
    magicTolerance,
    notify,
    subjectSelect,
    trackSubject,
    videoFrame,
  ]);

  useEffect(() => {
    if (subjectSelect?.mode !== 'magic') return;
    magicStrokesRef.current = [];
    redrawMagicStrokes();
  }, [subjectSelect?.maskId, subjectSelect?.mode, subjectSelect?.nodeId, redrawMagicStrokes]);

  useEffect(() => {
    if (subjectSelect?.mode === 'magic') redrawMagicStrokes();
  }, [scale, artW, artH, subjectSelect?.mode, redrawMagicStrokes]);

  useEffect(() => {
    if (!subjectSelect) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        subjectStartRef.current = null;
        setSubjectRect(null);
        clearMagicStrokes();
        endSubjectSelect();
      } else if (e.key === 'Enter' && subjectSelect.mode === 'magic') {
        e.preventDefault();
        applyMagicMask();
      } else if ((e.key === 'e' || e.key === 'E') && subjectSelect.mode === 'magic') {
        setMagicMode((prev) => (prev === 'add' ? 'erase' : 'add'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyMagicMask, clearMagicStrokes, endSubjectSelect, subjectSelect]);

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
    if (!compare) return null;
    if (videoFrame) return pixelImageToDataUrl(videoFrame);
    if (activeAsset) return pixelImageToDataUrl(activeAsset.image);
    return null;
  }, [activeAsset, compare, videoFrame]);

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
          {effectsActive ? <Badge tone="success">GPU effects</Badge> : null}
          {layersActive ? <Badge tone="success">GPU layers</Badge> : null}
          {videoPlaying ? <Badge tone="warn">Playback preview</Badge> : null}
          {animationPlaying ? <Badge tone="warn">Animation preview</Badge> : null}
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
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (!art) return;
                const name = `${(activeAsset?.name ?? 'pixelart').replace(/\.[^.]+$/, '')}-${artW}x${artH}.png`;
                void pixelImageToBlob(art, 'png', 1).then((blob) => downloadBlob(blob, name));
              }}
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
              <canvas
                ref={artCanvasRef}
                className="art-canvas"
                width={artW}
                height={artH}
                role="img"
                aria-label="Pixel art preview"
                style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
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
              {subjectSelect?.mode === 'box' && !maskEdit ? (
                <div
                  className="subject-select-surface"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    } catch {
                      // Synthetic pointers and some browsers may not support capture.
                    }
                    const p = normalizeSubjectPoint(e.clientX, e.clientY);
                    if (!p) return;
                    subjectStartRef.current = p;
                    setSubjectRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                  }}
                  onPointerMove={(e) => {
                    const start = subjectStartRef.current;
                    if (!start) return;
                    const p = normalizeSubjectPoint(e.clientX, e.clientY);
                    if (!p) return;
                    setSubjectRect({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
                  }}
                  onPointerUp={(e) => {
                    finishSubjectRect(e.clientX, e.clientY);
                  }}
                  onPointerCancel={() => {
                    subjectStartRef.current = null;
                    setSubjectRect(null);
                  }}
                >
                  <span className="subject-select-hint">Drag a box around the subject · Esc to cancel</span>
                  {subjectRect ? (
                    <div
                      className="subject-select-rect"
                      style={{
                        left: `${Math.min(subjectRect.x0, subjectRect.x1) * 100}%`,
                        top: `${Math.min(subjectRect.y0, subjectRect.y1) * 100}%`,
                        width: `${Math.abs(subjectRect.x1 - subjectRect.x0) * 100}%`,
                        height: `${Math.abs(subjectRect.y1 - subjectRect.y0) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {subjectSelect?.mode === 'magic' && !maskEdit ? (
                <div
                  className="subject-select-surface magic"
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest('.magic-toolbar')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    } catch {
                      // Synthetic pointers may not support capture.
                    }
                    beginMagicStroke(e.clientX, e.clientY, magicMode === 'erase' || e.altKey);
                  }}
                  onPointerMove={(e) => {
                    if ((e.target as HTMLElement).closest('.magic-toolbar')) return;
                    moveMagicStroke(e.clientX, e.clientY);
                  }}
                  onPointerUp={() => {
                    magicDrawingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    magicDrawingRef.current = false;
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <canvas
                    ref={magicCanvasRef}
                    className="subject-brush-canvas"
                    width={Math.max(1, Math.round(artW * scale))}
                    height={Math.max(1, Math.round(artH * scale))}
                  />
                  <div className="magic-toolbar" onPointerDown={(e) => e.stopPropagation()}>
                    <Segmented
                      label="Brush"
                      value={magicMode}
                      options={[
                        { value: 'add', label: 'Add' },
                        { value: 'erase', label: 'Erase' },
                      ]}
                      onChange={(v) => setMagicMode(v as 'add' | 'erase')}
                    />
                    <div className="magic-slider">
                      <Slider
                        label="Size"
                        value={magicBrush}
                        min={4}
                        max={80}
                        step={1}
                        unit="px"
                        onChange={setMagicBrush}
                      />
                    </div>
                    <div className="magic-slider">
                      <Slider
                        label="Tolerance"
                        value={magicTolerance}
                        min={0.05}
                        max={0.5}
                        step={0.01}
                        onChange={setMagicTolerance}
                      />
                    </div>
                    <button type="button" className="primary-btn small" onClick={applyMagicMask}>
                      Apply
                    </button>
                    {activeAsset?.kind === 'video' ? (
                      <button
                        type="button"
                        className="primary-btn small"
                        onClick={applyMagicMaskAndTrack}
                        disabled={Boolean(maskTracking)}
                      >
                        {maskTracking ? `Tracking ${maskTracking.done}/${maskTracking.total}` : 'Apply & track'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn small"
                      onClick={() => {
                        clearMagicStrokes();
                        setSubjectRect(null);
                        endSubjectSelect();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <span className="subject-select-hint">
                    Paint over the subject · Alt-drag erases · Enter applies
                  </span>
                </div>
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
      {hasAnimation && activeAsset?.kind !== 'video' ? (
        <div className="video-timeline animation-timeline">
          <IconButton
            icon={animationPlaying ? 'pause' : 'play'}
            label={animationPlaying ? 'Pause animation' : 'Play animation'}
            size={16}
            onClick={toggleAnimation}
          />
          <Icon name="wave" size={15} />
          <input
            type="range"
            min={0}
            max={animationLoop ? animationDuration : Math.max(animationDuration, animationTime)}
            step={1 / Math.max(1, animationFps)}
            value={animationLoop ? Math.min(animationTime, animationDuration) : animationTime}
            onChange={(e) => {
              setAnimationPlaying(false);
              setAnimationTime(Number(e.target.value));
            }}
            aria-label="Animation time"
          />
          <span className="time-readout">
            {animationTime.toFixed(2)} / {animationLoop ? animationDuration.toFixed(2) : '∞'} s
          </span>
          <Badge tone="neutral">{animationFps} fps</Badge>
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
