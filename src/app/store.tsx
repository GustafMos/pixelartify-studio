import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  GraphNode,
  GraphNodeType,
  MaskData,
  PaletteDefinition,
  PixelImage,
  PipelineGraph,
  Preset,
  RenderResult,
} from '../core/types';
import {
  BUILTIN_PALETTES,
  BUILTIN_PRESETS,
  createNode,
  deepClone,
  defaultSettings,
  evaluateGraph,
  mediaAtPort,
  nodeParams,
  outputNodes,
  settingsFromGraph,
  settingsFromItem,
  stopStageForNode,
  validateGraph,
  createPreset,
  serializePreset,
  downloadPresetName,
  parsePreset,
  renderPixelArt,
} from '../core';
import {
  NODE_DEFS,
  createDefaultGraph,
  createCleanSlateGraph,
  deleteNodePreservingGraph,
  applyTrackedAlphaCuts,
  type GraphAsset,
  type GraphMediaItem,
} from '../core/graph';
import { loadGraph, saveGraph, loadUserPresets, saveUserPresets, loadUserPalettes, saveUserPalettes, loadActivePaletteId, saveActivePaletteId, loadUiMode, saveUiMode, loadRecentNodes, saveRecentNodes, loadColorSpace, saveColorSpace, loadFitPadding, saveFitPadding, loadSubgraphs, saveSubgraphs, type ColorSpaceOption, type Subgraph } from './storage';
import {
  decodeImageFile,
  downloadText,
  fileKind,
  makeThumbnail,
  formatFilename,
  pixelImageToBlob,
  downloadBlob,
  downloadZip,
} from './io';
import { buildMagicMask, trackMagicMaskFrame, type MagicSeed } from '../core/magic';
import { resizeMask } from '../core/image';
import type { TrackedMaskSequence } from '../core/graph';
import { grabVideoFrame, probeVideo, extractVideoFrames, type VideoProbe } from './video';
import { animationSettings, playbackPaletteKey, playbackSettings } from './playback';
import { renderTextLayer } from './textRender';

export interface AssetRecord {
  id: string;
  name: string;
  kind: 'image' | 'video';
  image: PixelImage;
  width: number;
  height: number;
  thumb: string;
  file?: File;
  videoInfo?: VideoProbe;
  duration?: number;
  fps?: number;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error' | 'warn';
}

export interface MaskEditMode {
  nodeId: string;
  maskId: string;
  brushSize: number;
  feather: number;
  action: 'add' | 'erase';
}

interface StudioContextValue {
  graph: PipelineGraph;
  assetsByNode: Record<string, AssetRecord[]>;
  allAssets: AssetRecord[];
  activeAsset: AssetRecord | null;
  activeAssetId: string | null;
  activeItem: GraphMediaItem | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedNode: GraphNode | null;
  selectedOutputId: string | null;
  previewNodeId: string | null;
  preview: RenderResult | null;
  previewError: string | null;
  isRendering: boolean;
  isImporting: boolean;
  previewFullQuality: boolean;
  mode: 'studio' | 'split' | 'graph';
  evaluation: ReturnType<typeof evaluateGraph>;
  graphErrors: ReturnType<typeof validateGraph>;
  presets: Preset[];
  userPresets: Preset[];
  recentNodeTypes: GraphNodeType[];
  palettes: PaletteDefinition[];
  userPalettes: PaletteDefinition[];
  activePaletteId: string | null;
  activePalette: PaletteDefinition | null;
  maskEdit: MaskEditMode | null;
  videoTime: number;
  videoFrame: PixelImage | null;
  videoFrameLoading: boolean;
  videoPlaying: boolean;
  animationTime: number;
  animationPlaying: boolean;
  hasAnimation: boolean;
  animationDuration: number;
  animationFps: number;
  animationLoop: boolean;
  setAnimationTime: (time: number) => void;
  setAnimationPlaying: (playing: boolean) => void;
  renderAnimationFrame: (time: number, fullQuality?: boolean) => RenderResult | null;
  subjectSelect: { nodeId: string; maskId: string; mode: 'magic' | 'box' } | null;
  maskTracking: { key: string; done: number; total: number } | null;
  trackedMasks: Record<string, TrackedMaskSequence>;
  clearTrackedMask: (key: string) => void;
  trackSubject: (
    nodeId: string,
    maskId: string,
    seeds: MagicSeed[],
    tolerance: number,
  ) => Promise<void>;
  paletteStudioOpen: boolean;
  toasts: Toast[];
  colorSpace: ColorSpaceOption;
  setColorSpace: (cs: ColorSpaceOption) => void;
  fitPadding: number;
  setFitPadding: (v: number) => void;
  subgraphs: Subgraph[];
  saveGroupAsSubgraph: (groupId: string, name: string) => void;
  deleteSubgraph: (id: string) => void;
  insertSubgraph: (id: string) => void;
  setMode: (mode: 'studio' | 'split' | 'graph') => void;
  selectNode: (id: string | null, additive?: boolean) => void;
  setSelectedOutput: (id: string) => void;
  setActiveAsset: (id: string) => void;
  setActivePalette: (id: string | null) => void;
  setPaletteStudioOpen: (open: boolean) => void;
  setVideoTime: (time: number) => void;
  setVideoPlaying: (playing: boolean) => void;
  beginSubjectSelect: (nodeId: string, maskId: string, mode?: 'magic' | 'box') => void;
  endSubjectSelect: () => void;
  setPreviewFullQuality: (full: boolean) => void;
  addNode: (type: GraphNodeType, x?: number, y?: number, paramsOverride?: Record<string, unknown>) => string;
  createGroup: () => string | null;
  duplicateGroup: (id: string) => string | null;
  ungroup: (id: string) => void;
  setGroupExpanded: (id: string, expanded: boolean) => void;
  moveGroup: (id: string, x: number, y: number) => void;
  duplicateNode: (id: string) => string | null;
  deleteNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
  togglePin: (nodeId: string, path: string) => void;
  toggleDrive: (nodeId: string, path: string, currentValue: number) => void;
  moveNode: (id: string, x: number, y: number) => void;
  setGraphCursor: (x: number, y: number) => void;
  addEdge: (fromNode: string, fromPort: string, toNode: string, toPort: string) => void;
  deleteEdge: (edgeId: string) => void;
  insertNodeOnEdge: (nodeId: string, edgeId: string) => boolean;
  moveNodeDetached: (nodeId: string, x: number, y: number, edgeId: string | null) => boolean;
  detachNodeWithBridge: (nodeId: string) => void;
  addAssets: (nodeId: string, files: File[]) => Promise<void>;
  importFiles: (nodeId: string, files: File[]) => Promise<void>;
  removeAsset: (nodeId: string, assetId: string) => void;
  clearAssets: (nodeId: string) => void;
  applyPreset: (preset: Preset) => void;
  newCleanSlate: () => void;
  savePreset: (name: string, description?: string) => Preset | null;
  deletePreset: (id: string) => void;
  importPresetFile: (file: File) => Promise<void>;
  exportPresetFile: (preset: Preset) => void;
  savePalette: (palette: PaletteDefinition) => void;
  deletePalette: (id: string) => void;
  applyPaletteToNode: (nodeId: string, colors: string[], name?: string) => void;
  setMaskOverride: (key: string, mask: MaskData) => void;
  clearMaskOverride: (key: string) => void;
  clearAllMaskOverrides: () => void;
  refreshMasks: () => void;
  beginMaskEdit: (nodeId: string, maskId: string) => void;
  endMaskEdit: () => void;
  setMaskEdit: (patch: Partial<MaskEditMode>) => void;
  notify: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportCurrent: () => Promise<void>;
  exportBatch: () => Promise<void>;
  exportLayers: () => Promise<void>;
  exportSpritesheet: (assetOverride?: AssetRecord) => Promise<void>;
  exportVideo: (assetOverride?: AssetRecord) => Promise<void>;
  exportVideoBoth: (assetOverride?: AssetRecord) => Promise<void>;
  isExporting: boolean;
  exportProgress: string | null;
  maskOverrides: Record<string, MaskData>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const uid = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36).slice(-4)}`;

function subMinX(sub: Subgraph): number {
  return sub.nodes.length ? Math.min(...sub.nodes.map((n) => n.x)) : 0;
}
function subMinY(sub: Subgraph): number {
  return sub.nodes.length ? Math.min(...sub.nodes.map((n) => n.y)) : 0;
}

export function StudioProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [graph, setGraph] = useState<PipelineGraph>(() => {
    const stored = loadGraph();
    if (stored && stored.nodes.length > 0) return stored;
    return createDefaultGraph(defaultSettings());
  });
  const [assetsByNode, setAssetsByNode] = useState<Record<string, AssetRecord[]>>({});
  const [activeAssetId, setActiveAssetIdState] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [mode, setModeState] = useState<'studio' | 'split' | 'graph'>(() => loadUiMode());
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewFullQuality, setPreviewFullQuality] = useState(false);
  const [userPresets, setUserPresets] = useState<Preset[]>(() => loadUserPresets());
  const [recentNodeTypes, setRecentNodeTypes] = useState<GraphNodeType[]>(() => loadRecentNodes());
  const [userPalettes, setUserPalettes] = useState<PaletteDefinition[]>(() => loadUserPalettes());
  const [activePaletteId, setActivePaletteIdState] = useState<string | null>(() => loadActivePaletteId());
  const [maskOverrides, setMaskOverrides] = useState<Record<string, MaskData>>({});
  const [maskEdit, setMaskEditState] = useState<MaskEditMode | null>(null);
  const [videoTime, setVideoTimeState] = useState(0);
  const [videoFrame, setVideoFrame] = useState<PixelImage | null>(null);
  const [videoFrameLoading, setVideoFrameLoading] = useState(false);
  const [videoPlaying, setVideoPlayingState] = useState(false);
  const [animationTime, setAnimationTimeState] = useState(0);
  const [animationPlaying, setAnimationPlayingState] = useState(false);
  const [subjectSelect, setSubjectSelect] = useState<{
    nodeId: string;
    maskId: string;
    mode: 'magic' | 'box';
  } | null>(null);
  const [maskTracking, setMaskTracking] = useState<{ key: string; done: number; total: number } | null>(null);
  const [trackedMasks, setTrackedMasks] = useState<Record<string, TrackedMaskSequence>>({});
  const [paletteStudioOpen, setPaletteStudioOpen] = useState(false);
  const [colorSpace, setColorSpaceState] = useState<ColorSpaceOption>(() => loadColorSpace());
  const [fitPadding, setFitPaddingState] = useState<number>(() => loadFitPadding());
  const [subgraphs, setSubgraphs] = useState<Subgraph[]>(() => loadSubgraphs());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const historyRef = useRef<PipelineGraph[]>([]);
  const futureRef = useRef<PipelineGraph[]>([]);
  const lastHistoryRef = useRef(0);
  const maskCacheRef = useRef<Map<string, MaskData>>(new Map());
  const toastIdRef = useRef(1);
  const renderGenRef = useRef(0);
  const videoLoadRef = useRef(0);
  const animationPaletteRef = useRef<{ key: string; colors: string[] } | null>(null);
  const graphCursorRef = useRef<{ x: number; y: number } | null>(null);

  const notify = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev.slice(-4), { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const mutateGraph = useCallback((fn: (g: PipelineGraph) => PipelineGraph, coalesce = false) => {
    setGraph((prev) => {
      const next = fn(prev);
      if (next === prev) return prev;
      const now = Date.now();
      if (!coalesce || now - lastHistoryRef.current > 450) {
        historyRef.current.push(prev);
        if (historyRef.current.length > 80) historyRef.current.shift();
        lastHistoryRef.current = now;
      }
      futureRef.current = [];
      return next;
    });
    setHistoryTick((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    setGraph((prev) => {
      const h = historyRef.current;
      if (h.length === 0) return prev;
      const restored = h.pop()!;
      futureRef.current.push(prev);
      return restored;
    });
    setHistoryTick((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    setGraph((prev) => {
      const f = futureRef.current;
      if (f.length === 0) return prev;
      const restored = f.pop()!;
      historyRef.current.push(prev);
      return restored;
    });
    setHistoryTick((v) => v + 1);
  }, []);

  const allAssets = useMemo(
    () => Object.values(assetsByNode).flat().filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i),
    [assetsByNode],
  );
  const activeAsset = useMemo(() => {
    if (activeAssetId) {
      const found = allAssets.find((a) => a.id === activeAssetId);
      if (found) return found;
    }
    return allAssets[0] ?? null;
  }, [allAssets, activeAssetId]);

  useEffect(() => {
    if (activeAsset && activeAsset.id !== activeAssetId) setActiveAssetIdState(activeAsset.id);
  }, [activeAsset, activeAssetId]);

  const outputs = useMemo(() => outputNodes(graph), [graph]);
  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );

  useEffect(() => {
    setSelectedNodeIds((prev) => {
      if (!selectedNodeId) return [];
      if (prev.includes(selectedNodeId)) return prev;
      return [selectedNodeId];
    });
  }, [selectedNodeId]);
  const animationNode = useMemo(
    () => graph.nodes.find((n) => n.type === 'animate') ?? null,
    [graph.nodes],
  );
  const timelineNode = useMemo(
    () => graph.nodes.find((n) => n.type === 'timeline') ?? null,
    [graph.nodes],
  );
  const hasAnimation = Boolean(animationNode || timelineNode);
  const animationDuration = Math.max(
    0.1,
    Number(timelineNode?.params.duration ?? animationNode?.params.duration ?? 4) || 4,
  );
  const animationFps = Math.max(
    1,
    Math.round(Number(timelineNode?.params.fps ?? animationNode?.params.fps ?? 24) || 24),
  );
  const animationLoop = Boolean(timelineNode?.params.loop ?? animationNode?.params.loop);

  useEffect(() => {
    if (outputs.length === 0) {
      setSelectedOutputId(null);
      return;
    }
    if (!selectedOutputId || !outputs.some((o) => o.id === selectedOutputId)) {
      setSelectedOutputId(outputs[0].id);
    }
  }, [outputs, selectedOutputId]);

  useEffect(() => {
    if (!selectedNodeId && outputs.length > 0) setSelectedNodeId(outputs[0].id);
  }, [selectedNodeId, outputs]);

  const evaluation = useMemo(
    () =>
      evaluateGraph(graph, {
        assetsByNode: assetsByNode as unknown as Record<string, GraphAsset[]>,
        maskCache: maskCacheRef.current,
        maskOverrides,
        time: videoTime + animationTime,
        textRenderer: renderTextLayer,
      }),
    [graph, assetsByNode, maskOverrides, videoTime, animationTime],
  );

  const graphErrors = useMemo(() => validateGraph(graph), [graph]);

  const previewNodeId = useMemo(() => {
    if (mode === 'graph') return selectedNodeId;
    // Studio and Split both preview the selected Output node.
    return selectedOutputId;
  }, [mode, selectedNodeId, selectedOutputId]);

  const previewNode = useMemo(
    () => graph.nodes.find((n) => n.id === previewNodeId) ?? null,
    [graph.nodes, previewNodeId],
  );

  const activeItem = useMemo(() => {
    if (!previewNode) return null;
    const items = mediaAtPort(evaluation, previewNode.id);
    if (items.length === 0) return null;
    return items.find((i) => i.assetId === activeAsset?.id) ?? items[0];
  }, [evaluation, previewNode, activeAsset]);

  // Debounced preview render. The output/selected node defines how far to render.
  useEffect(() => {
    if (!previewNode || !activeItem) {
      setPreview(null);
      setPreviewError(null);
      setIsRendering(false);
      return;
    }
    // Playback frames are painted directly by the viewer; don't re-render the
    // whole React tree for every video or animation frame.
    if ((videoPlaying && activeAsset?.kind === 'video') || animationPlaying) {
      setIsRendering(false);
      return;
    }
    const gen = ++renderGenRef.current;
    setIsRendering(true);
    setPreviewError(null);

    const timer = window.setTimeout(() => {
      try {
        const settings = settingsFromItem(activeItem);
        let source = activeItem.source;
        let masks = activeItem.masks;
        if (activeAsset?.kind === 'video' && videoFrame) {
          source = applyTrackedAlphaCuts(activeItem, videoFrame, videoTime, trackedMasks);
          masks = { ...masks };
        }
        const result = renderPixelArt(
          {
            image: source,
            masks,
            settings,
            underlay: activeItem.underlay,
            overlay: activeItem.overlay,
          },
          {
            stopAfter: stopStageForNode(previewNode.type),
            upscale: false,
            seed: 0,
            maxWorkingSide: previewFullQuality ? 2048 : 1200,
            time: animationTime + videoTime,
          },
        );
        if (gen === renderGenRef.current) {
          setPreview(result);
          setIsRendering(false);
        }
      } catch (err) {
        if (gen === renderGenRef.current) {
          setPreviewError(err instanceof Error ? err.message : String(err));
          setIsRendering(false);
        }
      }
    }, 110);

    return () => window.clearTimeout(timer);
  }, [
    previewNode,
    activeItem,
    activeAsset,
    videoFrame,
    videoPlaying,
    animationPlaying,
    previewFullQuality,
    videoTime,
    animationTime,
    trackedMasks,
  ]);

  /**
   * Render one animation frame at `time` without touching React state. The
   * viewer's animation loop paints the result directly to the preview canvas.
   */
  const renderAnimationFrame = useCallback(
    (time: number, fullQuality = false): RenderResult | null => {
      if (!previewNode) return null;
      const ev = evaluateGraph(graph, {
        assetsByNode: assetsByNode as unknown as Record<string, GraphAsset[]>,
        maskCache: maskCacheRef.current,
        maskOverrides,
        time,
        maxGeneratedSide: fullQuality ? undefined : 256,
        textRenderer: renderTextLayer,
      });
      const items = mediaAtPort(ev, previewNode.id);
      if (items.length === 0) return null;
      const item = items.find((i) => i.assetId === activeAsset?.id) ?? items[0];
      const base = settingsFromItem(item);
      const settings = fullQuality ? base : animationSettings(base, item);
      const paletteKey = playbackPaletteKey(
        base,
        `${activeAsset?.id ?? 'animation'}:${previewNode.id}:${fullQuality ? 'full' : 'fast'}`,
      );
      const paletteOverride =
        animationPaletteRef.current?.key === paletteKey
          ? animationPaletteRef.current.colors
          : undefined;
      const result = renderPixelArt(
        {
          image: item.source,
          masks: item.masks,
          settings,
          underlay: item.underlay,
          overlay: item.overlay,
        },
        {
          stopAfter: stopStageForNode(previewNode.type),
          upscale: fullQuality,
          seed: 0,
          maxWorkingSide: fullQuality ? 2048 : 192,
          paletteOverride,
          time,
        },
      );
      if (result.palette.length > 0) {
        animationPaletteRef.current = { key: paletteKey, colors: result.palette };
      }
      return result;
    },
    [graph, assetsByNode, maskOverrides, previewNode, activeAsset?.id],
  );

  // Persist the graph and libraries.
  useEffect(() => {
    saveGraph(graph);
  }, [graph]);
  useEffect(() => {
    saveUserPresets(userPresets);
  }, [userPresets]);
  useEffect(() => {
    saveRecentNodes(recentNodeTypes);
  }, [recentNodeTypes]);
  useEffect(() => {
    saveUserPalettes(userPalettes);
  }, [userPalettes]);
  useEffect(() => {
    saveActivePaletteId(activePaletteId);
  }, [activePaletteId]);
  useEffect(() => {
    saveUiMode(mode);
  }, [mode]);
  useEffect(() => {
    saveColorSpace(colorSpace);
  }, [colorSpace]);
  useEffect(() => {
    saveFitPadding(fitPadding);
  }, [fitPadding]);
  useEffect(() => {
    saveSubgraphs(subgraphs);
  }, [subgraphs]);

  // Video preview frame extraction.
  useEffect(() => {
    if (!activeAsset || activeAsset.kind !== 'video' || !activeAsset.file) {
      setVideoFrame(null);
      setVideoFrameLoading(false);
      return;
    }
    if (videoPlaying) {
      // Playback publishes frames directly from the hidden <video> element.
      setVideoFrameLoading(false);
      return;
    }
    const gen = ++videoLoadRef.current;
    setVideoFrameLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const { image } = await grabVideoFrame(activeAsset.file!, videoTime, 1600);
        if (gen === videoLoadRef.current) setVideoFrame(image);
      } catch (err) {
        if (gen === videoLoadRef.current) notify(`Video frame: ${err instanceof Error ? err.message : err}`, 'error');
      } finally {
        if (gen === videoLoadRef.current) setVideoFrameLoading(false);
      }
    }, 140);
    return () => window.clearTimeout(timer);
  }, [activeAsset, videoTime, videoPlaying, notify]);

  useEffect(() => {
    setVideoPlayingState(false);
  }, [activeAsset?.id]);

  useEffect(() => {
    if (!hasAnimation) setAnimationPlayingState(false);
  }, [hasAnimation]);

  useEffect(() => {
    setSubjectSelect(null);
  }, [activeAsset?.id]);

  const setMode = useCallback((next: 'studio' | 'split' | 'graph') => {
    setModeState(next);
    if (next === 'studio' && selectedOutputId) setSelectedNodeId(selectedOutputId);
  }, [selectedOutputId]);

  const selectNode = useCallback((id: string | null, additive = false) => {
    if (!id) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      return;
    }
    if (!additive) {
      setSelectedNodeId(id);
      setSelectedNodeIds([id]);
      return;
    }
    setSelectedNodeIds((prev) => {
      const next = prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id];
      setSelectedNodeId(next.length > 0 ? (next.includes(id) ? id : next[next.length - 1]) : null);
      return next;
    });
  }, []);
  const setSelectedOutput = useCallback((id: string) => {
    setSelectedOutputId(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node) setSelectedNodeId(id);
  }, [graph.nodes]);
  const setActiveAsset = useCallback((id: string) => setActiveAssetIdState(id), []);
  const setActivePalette = useCallback((id: string | null) => setActivePaletteIdState(id), []);
  const setPaletteStudioOpenCb = useCallback((open: boolean) => setPaletteStudioOpen(open), []);
  const setColorSpace = useCallback((cs: ColorSpaceOption) => setColorSpaceState(cs), []);
  const setFitPadding = useCallback((v: number) => setFitPaddingState(Math.max(0, Math.min(200, v))), []);
  const setVideoTime = useCallback((time: number) => setVideoTimeState(Math.max(0, time)), []);
  const setVideoPlaying = useCallback((playing: boolean) => {
    setVideoPlayingState(playing);
    if (!playing) setVideoFrameLoading(false);
  }, []);
  const setAnimationTime = useCallback((time: number) => {
    setAnimationTimeState(Math.max(0, Number.isFinite(time) ? time : 0));
  }, []);
  const setAnimationPlaying = useCallback((playing: boolean) => {
    setAnimationPlayingState(playing);
  }, []);
  const beginSubjectSelect = useCallback(
    (nodeId: string, maskId: string, mode: 'magic' | 'box' = 'magic') => {
      setMaskEditState(null);
      setSubjectSelect({ nodeId, maskId, mode });
      setSelectedNodeId(nodeId);
      setModeState((prev) => (prev === 'graph' ? 'split' : prev));
    },
    [],
  );
  const endSubjectSelect = useCallback(() => setSubjectSelect(null), []);

  const addNode = useCallback((type: GraphNodeType, x?: number, y?: number, paramsOverride?: Record<string, unknown>): string => {
    const settings = settingsFromGraph(graph);
    const def = NODE_DEFS[type];
    const anchor = selectedNode ?? null;
    let px = x;
    let py = y;
    let plans: Array<{
      fromPort: string;
      inPort: string;
      outPort: string;
      edges: Array<{ id: string; toNode: string; toPort: string }>;
    }> = [];
    let connect: { fromNode: string; fromPort: string; toPort: string } | null = null;
    let motionLink: {
      fromNode: string;
      fromPort: string;
      toNode: string;
      toPort: string;
    } | null = null;

    if (anchor) {
      px = anchor.x + 260;
      py = anchor.y;
      // Generators added after an Output are usually meant to start a new
      // scene, not to consume the output's (often empty) passthrough.
      const startsScene =
        (type === 'background' || type === 'object3d') && anchor.type === 'output';
      let firstCompatible: { fromPort: string; inPort: string } | null = null;
      for (const outPort of NODE_DEFS[anchor.type].outputs) {
        const inPort = def.inputs.find((input) => input.type === outPort.type);
        const newOutPort = def.outputs.find((output) => output.type === outPort.type);
        if (!inPort || !newOutPort) continue;
        if (!firstCompatible) firstCompatible = { fromPort: outPort.id, inPort: inPort.id };

        // Reroute every outgoing wire of this socket type through the new node.
        const outgoing = graph.edges
          .filter((edge) => {
            if (edge.fromNode !== anchor.id || edge.fromPort !== outPort.id) return false;
            const target = graph.nodes.find((n) => n.id === edge.toNode);
            if (!target) return false;
            return NODE_DEFS[target.type].inputs.some(
              (input) => input.id === edge.toPort && input.type === newOutPort.type,
            );
          })
          .map((edge) => ({ id: edge.id, toNode: edge.toNode, toPort: edge.toPort }));

        if (outgoing.length > 0) {
          plans.push({
            fromPort: outPort.id,
            inPort: inPort.id,
            outPort: newOutPort.id,
            edges: outgoing,
          });
        }
      }

      if (plans.length > 0) {
        const targets = plans
          .flatMap((plan) => plan.edges.map((edge) => graph.nodes.find((n) => n.id === edge.toNode)))
          .filter((node): node is GraphNode => Boolean(node));
        if (targets.length > 0) {
          const avgX = targets.reduce((sum, node) => sum + node.x, 0) / targets.length;
          const avgY = targets.reduce((sum, node) => sum + node.y, 0) / targets.length;
          px = Math.max(anchor.x + 260, Math.round(avgX) - 106);
          py = Math.round(avgY);
        }
      } else if (firstCompatible && !startsScene) {
        connect = {
          fromNode: anchor.id,
          fromPort: firstCompatible.fromPort,
          toPort: firstCompatible.inPort,
        };
      }
    } else if (px === undefined || py === undefined) {
      const cursor = graphCursorRef.current;
      if (cursor) {
        px = cursor.x;
        py = cursor.y;
      } else {
        px = 80;
        py = 200;
      }
    }

    const node = createNode(type, px ?? 80, py ?? 200, paramsOverride ?? nodeParams(type, settings), settings);
    if (anchor) {
      const anchorMotionIn = NODE_DEFS[anchor.type].inputs.find((p) => p.type === 'motion');
      const newMotionOut = def.outputs.find((p) => p.type === 'motion');
      const anchorMotionOut = NODE_DEFS[anchor.type].outputs.find((p) => p.type === 'motion');
      const newMotionIn = def.inputs.find((p) => p.type === 'motion');
      if (newMotionOut && anchorMotionIn) {
        motionLink = {
          fromNode: node.id,
          fromPort: newMotionOut.id,
          toNode: anchor.id,
          toPort: anchorMotionIn.id,
        };
      } else if (anchorMotionOut && newMotionIn) {
        motionLink = {
          fromNode: anchor.id,
          fromPort: anchorMotionOut.id,
          toNode: node.id,
          toPort: newMotionIn.id,
        };
      }
    }
    mutateGraph((g) => {
      let next: PipelineGraph = { ...g, nodes: [...g.nodes, node] };
      if (plans.length > 0) {
        const removed = new Set(plans.flatMap((plan) => plan.edges.map((edge) => edge.id)));
        const edges = g.edges.filter((edge) => !removed.has(edge.id));
        const seen = new Set<string>();
        for (const plan of plans) {
          const inputKey = `in:${plan.fromPort}:${plan.inPort}`;
          if (!seen.has(inputKey)) {
            seen.add(inputKey);
            edges.push({
              id: uid('edge'),
              fromNode: anchor!.id,
              fromPort: plan.fromPort,
              toNode: node.id,
              toPort: plan.inPort,
            });
          }
          for (const edge of plan.edges) {
            const outputKey = `out:${plan.outPort}:${edge.toNode}:${edge.toPort}`;
            if (seen.has(outputKey)) continue;
            seen.add(outputKey);
            edges.push({
              id: uid('edge'),
              fromNode: node.id,
              fromPort: plan.outPort,
              toNode: edge.toNode,
              toPort: edge.toPort,
            });
          }
        }
        next = { ...next, edges };
      } else if (connect) {
        next = {
          ...next,
          edges: [
            ...next.edges,
            {
              id: uid('edge'),
              fromNode: connect!.fromNode,
              fromPort: connect!.fromPort,
              toNode: node.id,
              toPort: connect!.toPort,
            },
          ],
        };
      }
      if (motionLink) {
        const exists = next.edges.some(
          (edge) =>
            edge.fromNode === motionLink!.fromNode &&
            edge.fromPort === motionLink!.fromPort &&
            edge.toNode === motionLink!.toNode &&
            edge.toPort === motionLink!.toPort,
        );
        if (!exists) {
          next = {
            ...next,
            edges: [...next.edges, { id: uid('edge'), ...motionLink }],
          };
        }
      }
      return next;
    });
    setSelectedNodeId(node.id);
    // Adding an Output should preview that output instead of leaving the
    // previous output selected.
    if (type === 'output') setSelectedOutputId(node.id);
    setRecentNodeTypes((prev) => [type, ...prev.filter((t) => t !== type)].slice(0, 8));
    return node.id;
  }, [graph, mutateGraph, selectedNode]);

  const duplicateNode = useCallback((id: string): string | null => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return null;
    const copy: GraphNode = {
      ...deepClone(node),
      id: uid(node.type),
      x: node.x + 36,
      y: node.y + 36,
      title: `${node.title} copy`,
    };
    mutateGraph((g) => ({ ...g, nodes: [...g.nodes, copy] }));
    setSelectedNodeId(copy.id);
    return copy.id;
  }, [graph.nodes, mutateGraph]);

  const createGroup = useCallback((): string | null => {
    const ids = selectedNodeIds.filter((id) => {
      const node = graph.nodes.find((n) => n.id === id);
      return node && node.type !== 'group';
    });
    if (ids.length < 2) {
      notify('Select two or more nodes with Ctrl/Cmd-click before grouping.', 'warn');
      return null;
    }
    const members = graph.nodes.filter((node) => ids.includes(node.id));
    const minX = Math.min(...members.map((node) => node.x)) - 20;
    const minY = Math.min(...members.map((node) => node.y)) - 20;
    const settings = settingsFromGraph(graph);
    const count = graph.nodes.filter((n) => n.type === 'group').length + 1;
    const group = createNode('group', minX, minY, { nodeIds: ids, expanded: false }, settings);
    group.title = `Group ${count}`;
    mutateGraph((g) => ({ ...g, nodes: [...g.nodes, group] }));
    setSelectedNodeId(group.id);
    setSelectedNodeIds([group.id]);
    notify(`Grouped ${ids.length} nodes. Click the group to expand or duplicate it.`, 'success');
    return group.id;
  }, [graph, mutateGraph, notify, selectedNodeIds]);

  const duplicateGroup = useCallback((id: string): string | null => {
    const group = graph.nodes.find((n) => n.id === id && n.type === 'group');
    if (!group) return null;
    const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
    const members = graph.nodes.filter((n) => ids.includes(n.id) && n.type !== 'group');
    if (members.length === 0) return null;
    const idMap = new Map<string, string>();
    const clones = members.map((member) => {
      const clone = { ...deepClone(member), id: uid(member.type), x: member.x + 44, y: member.y + 44 };
      idMap.set(member.id, clone.id);
      return clone;
    });
    const clonedEdges = graph.edges
      .filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
      .map((edge) => ({
        ...deepClone(edge),
        id: uid('edge'),
        fromNode: idMap.get(edge.fromNode)!,
        toNode: idMap.get(edge.toNode)!,
      }));
    const clonedAssets: Record<string, AssetRecord[]> = {};
    for (const member of members) {
      if (member.type !== 'input') continue;
      const targetId = idMap.get(member.id);
      const assets = assetsByNode[member.id] ?? [];
      if (!targetId || assets.length === 0) continue;
      clonedAssets[targetId] = assets.map((asset) => ({ ...asset, id: uid('asset') }));
    }
    const copy = {
      ...deepClone(group),
      id: uid('group'),
      title: `${group.title} copy`,
      x: group.x + 44,
      y: group.y + 44,
      params: {
        ...deepClone(group.params),
        nodeIds: clones.map((node) => node.id),
        expanded: false,
      },
    };
    mutateGraph((g) => ({
      ...g,
      nodes: [...g.nodes, ...clones, copy],
      edges: [...g.edges, ...clonedEdges],
    }));
    if (Object.keys(clonedAssets).length > 0) {
      setAssetsByNode((prev) => ({ ...prev, ...clonedAssets }));
    }
    setSelectedNodeId(copy.id);
    setSelectedNodeIds([copy.id]);
    notify(`Duplicated “${group.title}” with ${clones.length} nodes.`, 'success');
    return copy.id;
  }, [assetsByNode, graph, mutateGraph, notify]);

  const ungroup = useCallback((id: string) => {
    mutateGraph((g) => ({ ...g, nodes: g.nodes.filter((node) => node.id !== id) }));
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
  }, [mutateGraph]);

  /** Save a group (and its internal wiring) as a reusable subgraph. */
  const saveGroupAsSubgraph = useCallback((groupId: string, name: string) => {
    const group = graph.nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) return;
    const trimmed = name.trim();
    if (!trimmed) {
      notify('Subgraph needs a name.', 'warn');
      return;
    }
    const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
    const members = graph.nodes.filter((n) => ids.includes(n.id) && n.type !== 'group');
    if (members.length === 0) {
      notify('This group has no members to save.', 'warn');
      return;
    }
    const idSet = new Set(ids);
    const internalEdges = graph.edges.filter((e) => idSet.has(e.fromNode) && idSet.has(e.toNode));
    const subgraph: Subgraph = {
      id: `subgraph-${Math.random().toString(36).slice(2, 9)}`,
      name: trimmed,
      nodes: deepClone(members),
      edges: deepClone(internalEdges),
    };
    setSubgraphs((prev) => [...prev.filter((s) => s.name !== trimmed), subgraph]);
    notify(`Saved subgraph “${trimmed}” (${members.length} nodes).`, 'success');
  }, [graph, notify]);

  const deleteSubgraph = useCallback((id: string) => {
    setSubgraphs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /** Insert a saved subgraph at the cursor (or the graph origin). */
  const insertSubgraph = useCallback((id: string) => {
    const sub = subgraphs.find((s) => s.id === id);
    if (!sub) return;
    const cursor = graphCursorRef.current ?? { x: 120, y: 120 };
    const idMap = new Map<string, string>();
    const nodes = sub.nodes.map((n) => {
      const clone = { ...deepClone(n), id: uid(n.type), x: n.x + cursor.x - subMinX(sub), y: n.y + cursor.y - subMinY(sub) };
      idMap.set(n.id, clone.id);
      return clone;
    });
    const edges = sub.edges
      .filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode))
      .map((e) => ({ ...deepClone(e), id: uid('edge'), fromNode: idMap.get(e.fromNode)!, toNode: idMap.get(e.toNode)! }));
    mutateGraph((g) => ({ ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges] }));
    if (nodes.length > 0) setSelectedNodeId(nodes[0].id);
    notify(`Inserted subgraph “${sub.name}”.`, 'success');
  }, [subgraphs, mutateGraph, notify]);

  const setGroupExpanded = useCallback((id: string, expanded: boolean) => {
    mutateGraph((g) => {
      const group = g.nodes.find((node) => node.id === id && node.type === 'group');
      if (!group) return g;
      const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
      const members = g.nodes.filter((node) => ids.includes(node.id) && node.type !== 'group');
      const minX = members.length > 0 ? Math.min(...members.map((node) => node.x)) : group.x;
      const minY = members.length > 0 ? Math.min(...members.map((node) => node.y)) : group.y;
      return {
        ...g,
        nodes: g.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                x: expanded ? node.x : minX,
                y: expanded ? node.y : minY,
                params: { ...node.params, expanded },
              }
            : node,
        ),
      };
    });
  }, [mutateGraph]);

  const moveGroup = useCallback((id: string, x: number, y: number) => {
    mutateGraph((g) => {
      const group = g.nodes.find((node) => node.id === id && node.type === 'group');
      if (!group) return g;
      const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
      const dx = x - group.x;
      const dy = y - group.y;
      return {
        ...g,
        nodes: g.nodes.map((node) => {
          if (node.id === id) return { ...node, x, y };
          if (ids.includes(node.id)) return { ...node, x: node.x + dx, y: node.y + dy };
          return node;
        }),
      };
    });
  }, [mutateGraph]);

  const deleteNode = useCallback((id: string) => {
    const result = deleteNodePreservingGraph(graph, id);
    mutateGraph(() => result.graph);
    if (result.routerAdded) {
      notify('Node deleted. A Router was inserted to preserve the branches.', 'info');
    } else if (result.bridged > 0) {
      notify('Node deleted. Connections were bridged automatically.', 'info');
    }
    setSelectedNodeId((current) => (current === id ? null : current));
    setMaskOverrides((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (k.startsWith(`${id}:`)) delete next[k];
      return next;
    });
    setMaskEditState((current) => (current?.nodeId === id ? null : current));
  }, [graph, mutateGraph, notify]);

  const updateNode = useCallback((id: string, patch: Partial<GraphNode>) => {
    mutateGraph(
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      }),
      true,
    );
  }, [mutateGraph]);

  const updateNodeParams = useCallback((id: string, patch: Record<string, unknown>) => {
    mutateGraph(
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === id ? { ...n, params: { ...n.params, ...patch } } : n,
        ),
      }),
      true,
    );
  }, [mutateGraph]);

  /** Pin/unpin a field so its value shows (and is editable) on the node body. */
  const togglePin = useCallback((nodeId: string, path: string) => {
    mutateGraph((g) => {
      const node = g.nodes.find((n) => n.id === nodeId);
      if (!node) return g;
      const pins = (node.params.pins as Record<string, boolean> | undefined) ?? {};
      const next = { ...pins };
      if (next[path]) delete next[path];
      else next[path] = true;
      return {
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === nodeId ? { ...n, params: { ...n.params, pins: next } } : n,
        ),
      };
    });
  }, [mutateGraph]);

  /**
   * Toggle whether a field is driven by a Constant/Math value node. Driving
   * creates a Constant node (wired into the node's `value` input) and records
   * `fieldPath -> nodeId` in `params.drivers`; un-driving removes the wire and
   * the auto-created constant if it becomes orphaned.
   */
  const toggleDrive = useCallback((nodeId: string, path: string, currentValue: number) => {
    mutateGraph((g) => {
      const node = g.nodes.find((n) => n.id === nodeId);
      if (!node) return g;
      const drivers = (node.params.drivers as Record<string, string> | undefined) ?? {};
      const existing = drivers[path];

      if (existing) {
        const edges = g.edges.filter(
          (e) => !(e.fromNode === existing && e.toNode === nodeId && e.toPort === 'value'),
        );
        const nextDrivers = { ...drivers };
        delete nextDrivers[path];
        const stillUsed =
          edges.some((e) => e.fromNode === existing) || Object.values(nextDrivers).includes(existing);
        const nodes = (stillUsed
          ? g.nodes
          : g.nodes.filter((n) => n.id !== existing)
        ).map((n) =>
          n.id === nodeId ? { ...n, params: { ...n.params, drivers: nextDrivers } } : n,
        );
        return { ...g, nodes, edges };
      }

      const settings = settingsFromGraph(g);
      const constant = createNode('constant', node.x - 230, node.y, { value: currentValue }, settings);
      const edges = [
        ...g.edges,
        { id: uid('edge'), fromNode: constant.id, fromPort: 'value', toNode: nodeId, toPort: 'value' },
      ];
      const nodes = [
        ...g.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, params: { ...n.params, drivers: { ...drivers, [path]: constant.id } } }
            : n,
        ),
        constant,
      ];
      return { ...g, nodes, edges };
    });
  }, [mutateGraph]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    mutateGraph(
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
      }),
      true,
    );
  }, [mutateGraph]);

  const setGraphCursor = useCallback((x: number, y: number) => {
    graphCursorRef.current = { x, y };
  }, []);

  const addEdge = useCallback((fromNode: string, fromPort: string, toNode: string, toPort: string) => {
    const from = graph.nodes.find((n) => n.id === fromNode);
    const to = graph.nodes.find((n) => n.id === toNode);
    if (!from || !to) return;
    const out = NODE_DEFS[from.type].outputs.find((p) => p.id === fromPort);
    const inp = NODE_DEFS[to.type].inputs.find((p) => p.id === toPort);
    if (!out || !inp) return;
    if (out.type !== inp.type) {
      notify(`Cannot connect ${out.type} to ${inp.type}.`, 'error');
      return;
    }

    // Reconnecting into an occupied single media input inserts a Switcher so
    // both branches stay available and the active one can be chosen.
    if (out.type === 'media' && !inp.multiple) {
      const existing = graph.edges.find(
        (e) => e.toNode === toNode && e.toPort === toPort && e.fromNode !== fromNode,
      );
      if (existing) {
        const settings = settingsFromGraph(graph);
        const switcher = createNode('switcher', to.x - 220, to.y, { activeIndex: 1 }, settings);
        const edges = graph.edges.filter((e) => e.id !== existing.id);
        edges.push(
          { id: uid('edge'), fromNode: existing.fromNode, fromPort: existing.fromPort, toNode: switcher.id, toPort: 'media' },
          { id: uid('edge'), fromNode, fromPort, toNode: switcher.id, toPort: 'media' },
          { id: uid('edge'), fromNode: switcher.id, fromPort: 'media', toNode, toPort },
        );
        const candidate: PipelineGraph = { ...graph, nodes: [...graph.nodes, switcher], edges };
        if (validateGraph(candidate).some((error) => /cycle/i.test(error.message))) {
          notify('That connection would create a cycle.', 'error');
          return;
        }
        const existingTitle = graph.nodes.find((n) => n.id === existing.fromNode)?.title ?? 'another node';
        mutateGraph(() => candidate);
        notify(`Switcher added to route between “${existingTitle}” and “${from.title}”.`, 'info');
        return;
      }
    }

    const filtered = inp.multiple
      ? graph.edges
      : graph.edges.filter((e) => !(e.toNode === toNode && e.toPort === toPort));
    const edges = [
      ...filtered,
      { id: uid('edge'), fromNode, fromPort, toNode, toPort },
    ];
    const candidate: PipelineGraph = { ...graph, edges };
    if (validateGraph(candidate).some((error) => /cycle/i.test(error.message))) {
      notify('That connection would create a cycle.', 'error');
      return;
    }
    mutateGraph(() => candidate);
  }, [graph, mutateGraph, notify]);

  const deleteEdge = useCallback((edgeId: string) => {
    mutateGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) }));
  }, [mutateGraph]);

  const insertNodeOnEdge = useCallback(
    (nodeId: string, edgeId: string): boolean => {      const edge = graph.edges.find((e) => e.id === edgeId);
      if (!edge) return false;
      if (edge.fromNode === nodeId || edge.toNode === nodeId) return false;
      const source = graph.nodes.find((n) => n.id === edge.fromNode);
      const target = graph.nodes.find((n) => n.id === edge.toNode);
      const moving = graph.nodes.find((n) => n.id === nodeId);
      if (!source || !target || !moving) return false;

      const edgeType = NODE_DEFS[source.type].outputs.find((p) => p.id === edge.fromPort)?.type;
      if (!edgeType) return false;
      const def = NODE_DEFS[moving.type];
      const input = def.inputs.find((p) => p.type === edgeType);
      const output = def.outputs.find((p) => p.type === edgeType);
      if (!input || !output) return false;

      const existingInput = graph.edges.some(
        (e) => e.toNode === nodeId && e.toPort === input.id,
      );
      if (existingInput && !input.multiple) return false;

      const newEdges = graph.edges.filter((e) => e.id !== edgeId);
      newEdges.push(
        {
          id: uid('edge'),
          fromNode: source.id,
          fromPort: edge.fromPort,
          toNode: nodeId,
          toPort: input.id,
        },
        {
          id: uid('edge'),
          fromNode: nodeId,
          fromPort: output.id,
          toNode: target.id,
          toPort: edge.toPort,
        },
      );
      const candidate: PipelineGraph = { ...graph, edges: newEdges };
      if (validateGraph(candidate).some((error) => /cycle/i.test(error.message))) {
        notify('Inserting there would create a cycle.', 'error');
        return false;
      }
      mutateGraph(() => candidate);
      notify(`Inserted “${moving.title}” into the connection.`, 'success');
      return true;
    },
    [graph, mutateGraph, notify],
  );

  const moveNodeDetached = useCallback(
    (nodeId: string, x: number, y: number, edgeId: string | null): boolean => {
      const moving = graph.nodes.find((n) => n.id === nodeId);
      if (!moving) return false;
      const def = NODE_DEFS[moving.type];
      let edges = graph.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId);

      if (edgeId) {
        const edge = graph.edges.find(
          (e) => e.id === edgeId && e.fromNode !== nodeId && e.toNode !== nodeId,
        );
        const source = edge ? graph.nodes.find((n) => n.id === edge.fromNode) : null;
        const target = edge ? graph.nodes.find((n) => n.id === edge.toNode) : null;
        if (edge && source && target) {
          const edgeType = NODE_DEFS[source.type].outputs.find((p) => p.id === edge.fromPort)?.type;
          const input = edgeType ? def.inputs.find((p) => p.type === edgeType) : undefined;
          const output = edgeType ? def.outputs.find((p) => p.type === edgeType) : undefined;
          const targetAccepts =
            edgeType &&
            NODE_DEFS[target.type].inputs.some(
              (p) => p.id === edge.toPort && p.type === edgeType,
            );
          if (edgeType && input && output && targetAccepts) {
            edges = [
              ...edges.filter((e) => e.id !== edge.id),
              {
                id: uid('edge'),
                fromNode: source.id,
                fromPort: edge.fromPort,
                toNode: nodeId,
                toPort: input.id,
              },
              {
                id: uid('edge'),
                fromNode: nodeId,
                fromPort: output.id,
                toNode: target.id,
                toPort: edge.toPort,
              },
            ];
          }
        }
      }

      const candidate: PipelineGraph = {
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
        edges,
      };
      if (validateGraph(candidate).some((error) => /cycle/i.test(error.message))) {
        notify('That reattachment would create a cycle.', 'error');
        return false;
      }
      mutateGraph(() => candidate, true);
      return true;
    },
    [graph, mutateGraph, notify],
  );

  const detachNodeWithBridge = useCallback((nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const result = deleteNodePreservingGraph(graph, nodeId);
    const next: PipelineGraph = {
      ...result.graph,
      nodes: [...result.graph.nodes.filter((n) => n.id !== nodeId), node],
    };
    mutateGraph(() => next, true);
  }, [graph, mutateGraph]);

  const addAssetsInternal = useCallback(async (nodeId: string, files: File[]) => {
    const supported = files.filter((f) => fileKind(f) !== null);
    if (supported.length === 0) {
      notify('No supported images or videos selected.', 'warn');
      return;
    }
    setIsImporting(true);
    const added: AssetRecord[] = [];
    for (const file of supported) {
      const kind = fileKind(file)!;
      try {
        if (kind === 'image') {
          const decoded = await decodeImageFile(file);
          added.push({
            id: uid('asset'),
            name: file.name,
            kind,
            image: decoded.image,
            width: decoded.image.width,
            height: decoded.image.height,
            thumb: decoded.thumb,
            file,
          });
        } else {
          const info = await probeVideo(file);
          const frame = await grabVideoFrame(file, Math.min(0.05, info.duration / 2), 960);
          added.push({
            id: uid('asset'),
            name: file.name,
            kind,
            image: frame.image,
            width: frame.image.width,
            height: frame.image.height,
            thumb: makeThumbnail(frame.image, 360),
            file,
            videoInfo: info,
            duration: info.duration,
            fps: info.fps,
          });
        }
      } catch (err) {
        notify(`${file.name}: ${err instanceof Error ? err.message : err}`, 'error');
      }
    }
    if (added.length > 0) {
      setAssetsByNode((prev) => ({
        ...prev,
        [nodeId]: [...(prev[nodeId] ?? []), ...added],
      }));
      setActiveAssetIdState((current) => current ?? added[0].id);
      setVideoTimeState(0);
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node) setSelectedNodeId(node.id);
      notify(`Added ${added.length} asset${added.length === 1 ? '' : 's'}.`, 'success');
    }
    setIsImporting(false);
  }, [graph.nodes, notify]);

  const importFiles = useCallback(async (nodeId: string, files: File[]) => {
    await addAssetsInternal(nodeId, files);
  }, [addAssetsInternal]);

  const removeAsset = useCallback((nodeId: string, assetId: string) => {
    setAssetsByNode((prev) => ({
      ...prev,
      [nodeId]: (prev[nodeId] ?? []).filter((a) => a.id !== assetId),
    }));
    setActiveAssetIdState((current) => (current === assetId ? null : current));
    setMaskOverrides((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (k.includes(`:${assetId}:`)) delete next[k];
      return next;
    });
  }, []);

  const clearAssets = useCallback((nodeId: string) => {
    setAssetsByNode((prev) => ({ ...prev, [nodeId]: [] }));
    setActiveAssetIdState(null);
  }, []);

  const presets = useMemo(() => {
    const ids = new Set(BUILTIN_PRESETS.map((p) => p.id));
    return [...BUILTIN_PRESETS, ...userPresets.filter((p) => !ids.has(p.id))];
  }, [userPresets]);

  const palettes = useMemo(() => {
    const ids = new Set(BUILTIN_PALETTES.map((p) => p.id));
    return [...BUILTIN_PALETTES, ...userPalettes.filter((p) => !ids.has(p.id))];
  }, [userPalettes]);

  const activePalette = useMemo(
    () => palettes.find((p) => p.id === activePaletteId) ?? palettes[0] ?? null,
    [palettes, activePaletteId],
  );

  const applyPreset = useCallback((preset: Preset) => {
    const nextGraph = deepClone(preset.graph);
    setGraph(nextGraph);
    historyRef.current.push(graph);
    futureRef.current = [];
    const inputNodes = nextGraph.nodes.filter((n) => n.type === 'input');
    if (inputNodes.length > 0) {
      const current = allAssets;
      setAssetsByNode((prev) => {
        const next = { ...prev };
        for (const n of inputNodes) {
          if (!next[n.id]) next[n.id] = [];
        }
        const hasAny = inputNodes.some((n) => (next[n.id] ?? []).length > 0);
        if (!hasAny && current.length > 0) next[inputNodes[0].id] = current;
        return next;
      });
    }
    const out = nextGraph.nodes.find((n) => n.type === 'output');
    if (out) {
      setSelectedOutputId(out.id);
      setSelectedNodeId(out.id);
    } else {
      setSelectedOutputId(null);
    }
    setMaskOverrides({});
    maskCacheRef.current.clear();
    notify(`Preset “${preset.name}” applied.`, 'success');
  }, [allAssets, graph, notify]);

  const newCleanSlate = useCallback(() => {
    const nextGraph = createCleanSlateGraph(defaultSettings());
    setGraph(nextGraph);
    historyRef.current.push(graph);
    futureRef.current = [];
    // Preserve imported media: the new graph has a fresh input node id, so move
    // the existing assets onto it instead of clearing them.
    const inputNode = nextGraph.nodes.find((n) => n.type === 'input');
    setAssetsByNode((prev) => {
      const all = Object.values(prev).flat();
      const unique = all.filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
      return unique.length > 0 && inputNode ? { [inputNode.id]: unique } : {};
    });
    setMaskOverrides({});
    maskCacheRef.current.clear();
    const out = nextGraph.nodes.find((n) => n.type === 'output');
    if (out) {
      setSelectedOutputId(out.id);
      setSelectedNodeId(out.id);
    }
    notify('Clean slate: Media input → Output, lossless pass-through.', 'success');
  }, [graph, notify]);

  const savePreset = useCallback((name: string, description = ''): Preset | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify('Preset needs a name.', 'warn');
      return null;
    }
    const preset = createPreset(trimmed, graph, description);
    preset.settings = settingsFromGraph(graph);
    if (preview) {
      try {
        preset.thumbnail = makeThumbnail(preview.art, 220);
      } catch {
        // Thumbnail is optional.
      }
    }
    setUserPresets((prev) => [...prev.filter((p) => p.id !== preset.id), preset]);
    notify(`Preset “${trimmed}” saved.`, 'success');
    return preset;
  }, [graph, notify, preview]);

  const deletePreset = useCallback((id: string) => {
    if (BUILTIN_PRESETS.some((p) => p.id === id)) {
      notify('Built-in presets cannot be deleted.', 'warn');
      return;
    }
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
  }, [notify]);

  const importPresetFile = useCallback(async (file: File) => {
    try {
      const preset = parsePreset(await file.text());
      setUserPresets((prev) => [...prev.filter((p) => p.id !== preset.id), preset]);
      notify(`Imported “${preset.name}”.`, 'success');
    } catch (err) {
      notify(`Preset import failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }, [notify]);

  const exportPresetFile = useCallback((preset: Preset) => {
    downloadText(serializePreset(preset), downloadPresetName(preset));
  }, []);

  const savePalette = useCallback((palette: PaletteDefinition) => {
    const normalized: PaletteDefinition = { ...palette, source: 'custom' };
    setUserPalettes((prev) => [...prev.filter((p) => p.id !== normalized.id), normalized]);
    setActivePaletteIdState(normalized.id);
    notify(`Palette “${normalized.name}” saved.`, 'success');
  }, [notify]);

  const deletePalette = useCallback((id: string) => {
    if (BUILTIN_PALETTES.some((p) => p.id === id)) {
      notify('Built-in palettes cannot be deleted.', 'warn');
      return;
    }
    setUserPalettes((prev) => prev.filter((p) => p.id !== id));
    setActivePaletteIdState((prev) => (prev === id ? null : prev));
  }, [notify]);

  const applyPaletteToNode = useCallback((nodeId: string, colors: string[], name = 'Custom') => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'palette') {
      notify('Select a Palette node first.', 'warn');
      return;
    }
    const palette = { ...(node.params.palette as Record<string, unknown>), mode: 'custom', colors };
    updateNodeParams(node.id, { palette });
    notify(`Applied “${name}” (${colors.length} colours).`, 'success');
  }, [graph.nodes, notify, updateNodeParams]);

  const setMaskOverride = useCallback((key: string, mask: MaskData) => {
    setMaskOverrides((prev) => ({ ...prev, [key]: mask }));
  }, []);
  const clearTrackedMask = useCallback((key: string) => {
    setTrackedMasks((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const clearMaskOverride = useCallback((key: string) => {
    setMaskOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setTrackedMasks((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const clearAllMaskOverrides = useCallback(() => setMaskOverrides({}), []);
  const refreshMasks = useCallback(() => {
    maskCacheRef.current.clear();
    setMaskOverrides({});
    setTrackedMasks({});
    setGraph((g) => ({ ...g }));
    setHistoryTick((v) => v + 1);
  }, []);

  const trackSubject = useCallback(
    async (nodeId: string, maskId: string, seeds: MagicSeed[], tolerance: number): Promise<void> => {
      if (!activeAsset || activeAsset.kind !== 'video' || !activeAsset.file) {
        notify('Tracking needs a video asset selected in a Media input.', 'warn');
        return;
      }
      if (maskTracking) {
        notify('A mask is already being tracked.', 'warn');
        return;
      }
      const key = `${nodeId}:${activeAsset.id}:${maskId}`;
      const duration = activeAsset.duration ?? 0;
      const trackingFps = Math.max(1, Math.min(12, 900 / Math.max(1, duration)));
      const total = Math.max(1, Math.ceil(duration * trackingFps));
      const sourceWidth = activeItem?.assetId === activeAsset.id ? activeItem.source.width : activeAsset.width;
      const sourceHeight = activeItem?.assetId === activeAsset.id ? activeItem.source.height : activeAsset.height;
      setMaskTracking({ key, done: 0, total });
      const masks: MaskData[] = [];
      let previousFrame: PixelImage | null = null;
      let previousMask: MaskData | null = null;
      try {
        await extractVideoFrames(
          activeAsset.file,
          {
            start: 0,
            end: null,
            fps: trackingFps,
            maxSide: 512,
            onProgress: (done, count) => setMaskTracking({ key, done, total: count }),
          },
          async (frame) => {
            let mask: MaskData;
            if (!previousMask) {
              const scale = frame.width / Math.max(1, sourceWidth);
              const scaledSeeds = seeds.map((seed) => ({
                ...seed,
                x: seed.x * scale,
                y: seed.y * scale,
                radius: Math.max(1, seed.radius * scale),
              }));
              mask = buildMagicMask(frame, scaledSeeds, {
                tolerance,
                feather: 1.2,
                maxSide: 512,
              });
            } else {
              mask = trackMagicMaskFrame(frame, previousFrame ?? frame, previousMask, {
                tolerance,
                feather: 1.2,
                edgeBarrier: 0.4,
              });
            }
            masks.push(mask);
            previousMask = mask;
            previousFrame = frame;
          },
        );
        if (masks.length === 0) throw new Error('No frames were decoded.');
        setTrackedMasks((prev) => ({ ...prev, [key]: { fps: trackingFps, masks } }));
        const base = resizeMask(masks[0], sourceWidth, sourceHeight);
        setMaskOverride(key, base);
        notify(`Mask tracked and cached across ${masks.length} frames.`, 'success');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          notify('Mask tracking cancelled.', 'warn');
        } else {
          notify(`Mask tracking failed: ${err instanceof Error ? err.message : err}`, 'error');
        }
      } finally {
        setMaskTracking(null);
      }
    },
    [activeAsset, activeItem, maskTracking, notify, setMaskOverride],
  );
  const beginMaskEdit = useCallback((nodeId: string, maskId: string) => {
    setSubjectSelect(null);
    setMaskEditState({ nodeId, maskId, brushSize: 14, feather: 2, action: 'add' });
    setSelectedNodeId(nodeId);
    setModeState('studio');
  }, []);
  const endMaskEdit = useCallback(() => setMaskEditState(null), []);
  const setMaskEdit = useCallback((patch: Partial<MaskEditMode>) => {
    setMaskEditState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const applyOutputSettings = useCallback((item: Parameters<typeof settingsFromItem>[0]) => {
    const base = settingsFromItem(item);
    const outNode = graph.nodes.find((n) => n.id === selectedOutputId);
    const output = outNode?.params.output as typeof base.output | undefined;
    const video = outNode?.params.video as typeof base.video | undefined;
    return { ...base, output: output ?? base.output, video: video ?? base.video };
  }, [graph.nodes, selectedOutputId]);

  const exportCurrent = useCallback(async () => {
    if (!activeItem || !previewNode) {
      notify('Nothing to export.', 'warn');
      return;
    }
    setIsExporting(true);
    setExportProgress('Rendering…');
    try {
      const settings = applyOutputSettings(activeItem);
      const result = renderPixelArt(
        {
          image: activeAsset?.kind === 'video' && videoFrame ? videoFrame : activeItem.source,
          masks: activeItem.masks,
          settings,
          underlay: activeItem.underlay,
          overlay: activeItem.overlay,
        },
        { upscale: true, time: animationTime + videoTime },
      );
      const blob = await pixelImageToBlob(result.art, settings.output.format, settings.output.quality);
      const name = activeAsset?.name ?? 'pixelart';
      const ext = settings.output.format;
      downloadBlob(blob, formatFilename(settings.output.filenamePattern, {
        name,
        width: result.size.width,
        height: result.size.height,
        ext,
      }));
      if (settings.output.writeManifest) {
        downloadText(
          JSON.stringify(
            {
              app: 'RipScorpy Media Processing Suite',
              source: name,
              artWidth: result.size.width,
              artHeight: result.size.height,
              exportScale: result.size.pixelScale,
              palette: result.palette,
              stats: result.stats,
            },
            null,
            2,
          ),
          `${name.replace(/\.[^.]+$/, '')}.rsmps.json`,
        );
      }
      notify('Image exported.', 'success');
    } catch (err) {
      notify(`Export failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [
    activeAsset,
    activeItem,
    notify,
    previewNode,
    videoFrame,
    animationTime,
    videoTime,
    applyOutputSettings,
  ]);

  const exportLayers = useCallback(async () => {
    if (!activeItem) {
      notify('Nothing to export.', 'warn');
      return;
    }
    setIsExporting(true);
    setExportProgress('Rendering layers…');
    try {
      const settings = applyOutputSettings(activeItem);
      const result = renderPixelArt(
        {
          image: activeItem.source,
          masks: activeItem.masks,
          settings,
          underlay: activeItem.underlay,
          overlay: activeItem.overlay,
        },
        { upscale: false, time: animationTime + videoTime },
      );
      const entries: Array<{ name: string; data: Blob | string }> = [];
      const base = (activeAsset?.name ?? 'pixelart').replace(/\.[^.]+$/, '');
      for (const layer of result.layers) {
        const blob = await pixelImageToBlob(layer.image, settings.output.format, settings.output.quality);
        entries.push({ name: `${base}/${layer.name.replace(/[^\w.-]+/g, '-')}.${settings.output.format}`, data: blob });
      }
      entries.push({
        name: `${base}/layers.json`,
        data: JSON.stringify(
          {
            app: 'RipScorpy Media Processing Suite',
            source: activeAsset?.name,
            width: result.size.width,
            height: result.size.height,
            layers: result.layers.map((l) => ({
              id: l.id,
              name: l.name,
              role: l.role,
              z: l.z,
              opacity: l.opacity,
              blend: l.blend,
              file: `${base}/${l.name.replace(/[^\w.-]+/g, '-')}.${settings.output.format}`,
            })),
          },
          null,
          2,
        ),
      });
      await downloadZip(entries, `${base}-layers.zip`);
      notify('Layers exported.', 'success');
    } catch (err) {
      notify(`Layer export failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [activeAsset, activeItem, notify, animationTime, videoTime, applyOutputSettings]);

  const exportBatch = useCallback(async () => {
    const outputId = selectedOutputId;
    if (!outputId) {
      notify('Select an Output node.', 'warn');
      return;
    }
    const items = mediaAtPort(evaluation, outputId);
    if (items.length === 0) {
      notify('No assets connected to this output.', 'warn');
      return;
    }
    setIsExporting(true);
    const files: Array<{ name: string; data: Blob | string }> = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setExportProgress(`Rendering ${i + 1} / ${items.length}: ${item.name}`);
        const settings = applyOutputSettings(item);
        const result = renderPixelArt(
          {
            image: item.source,
            masks: item.masks,
            settings,
            underlay: item.underlay,
            overlay: item.overlay,
          },
          { upscale: true, time: animationTime + videoTime },
        );
        const blob = await pixelImageToBlob(result.art, settings.output.format, settings.output.quality);
        files.push({
          name: formatFilename(settings.output.filenamePattern, {
            name: item.name,
            width: result.size.width,
            height: result.size.height,
            index: i,
            ext: settings.output.format,
          }),
          data: blob,
        });
        if (settings.output.writeManifest) {
          files.push({
            name: `${item.name.replace(/\.[^.]+$/, '')}.rsmps.json`,
            data: JSON.stringify(
              {
                app: 'RipScorpy Media Processing Suite',
                source: item.name,
                artWidth: result.size.width,
                artHeight: result.size.height,
                exportScale: result.size.pixelScale,
                palette: result.palette,
              },
              null,
              2,
            ),
          });
        }
      }
      await downloadZip(files, `pixelartify-batch-${new Date().toISOString().slice(0, 10)}.zip`);
      notify(`Batch exported (${items.length} item${items.length === 1 ? '' : 's'}).`, 'success');
    } catch (err) {
      notify(`Batch failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [evaluation, notify, selectedOutputId, animationTime, videoTime, applyOutputSettings]);

  const exportSpritesheet = useCallback(async (assetOverride?: AssetRecord) => {
    const asset = assetOverride ?? activeAsset;
    if (!asset) {
      notify('Select a video or image sequence first.', 'warn');
      return;
    }
    // Implemented in the panel to share the frame extraction UI.
    notify('Use the Output panel to export a spritesheet.', 'info');
  }, [activeAsset, notify]);

  const exportVideo = useCallback(async (assetOverride?: AssetRecord) => {
    void assetOverride;
    notify('Use the Output panel to export video.', 'info');
  }, [notify]);

  const exportVideoBoth = useCallback(async (assetOverride?: AssetRecord) => {
    void assetOverride;
    notify('Use the Output panel to export video + spritesheet.', 'info');
  }, [notify]);

  const value: StudioContextValue = {
    graph,
    assetsByNode,
    allAssets,
    activeAsset,
    activeAssetId: activeAsset?.id ?? null,
    activeItem,
    selectedNodeId,
    selectedNodeIds,
    selectedNode,
    selectedOutputId,
    previewNodeId,
    preview,
    previewError,
    isRendering,
    isImporting,
    previewFullQuality,
    mode,
    evaluation,
    graphErrors,
    presets,
    userPresets,
    recentNodeTypes,
    palettes,
    userPalettes,
    activePaletteId: activePalette?.id ?? null,
    activePalette,
    maskEdit,
    videoTime,
    videoFrame,
    videoFrameLoading,
    videoPlaying,
    animationTime,
    animationPlaying,
    hasAnimation,
    animationDuration,
    animationFps,
    animationLoop,
    setAnimationTime,
    setAnimationPlaying,
    renderAnimationFrame,
    subjectSelect,
    maskTracking,
    trackedMasks,
    clearTrackedMask,
    trackSubject,
    paletteStudioOpen,
    toasts,
    colorSpace,
    setColorSpace,
    fitPadding,
    setFitPadding,
    subgraphs,
    saveGroupAsSubgraph,
    deleteSubgraph,
    insertSubgraph,
    setMode,
    selectNode,
    setSelectedOutput,
    setActiveAsset,
    setActivePalette,
    setPaletteStudioOpen: setPaletteStudioOpenCb,
    setVideoTime,
    setVideoPlaying,
    beginSubjectSelect,
    endSubjectSelect,
    setPreviewFullQuality,
    addNode,
    createGroup,
    duplicateGroup,
    ungroup,
    setGroupExpanded,
    moveGroup,
    duplicateNode,
    deleteNode,
    updateNode,
    updateNodeParams,
    togglePin,
    toggleDrive,
    moveNode,
    setGraphCursor,
    addEdge,
    deleteEdge,
    insertNodeOnEdge,
    moveNodeDetached,
    detachNodeWithBridge,
    addAssets: addAssetsInternal,
    importFiles,
    removeAsset,
    clearAssets,
    applyPreset,
    newCleanSlate,
    savePreset,
    deletePreset,
    importPresetFile,
    exportPresetFile,
    savePalette,
    deletePalette,
    applyPaletteToNode,
    setMaskOverride,
    clearMaskOverride,
    clearAllMaskOverrides,
    refreshMasks,
    beginMaskEdit,
    endMaskEdit,
    setMaskEdit,
    notify,
    dismissToast,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    exportCurrent,
    exportBatch,
    exportLayers,
    exportSpritesheet,
    exportVideo,
    exportVideoBoth,
    isExporting,
    exportProgress,
    maskOverrides,
  };

  void historyTick;
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider.');
  return ctx;
}


