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
  deleteNodePreservingGraph,
  type GraphAsset,
  type GraphMediaItem,
} from '../core/graph';
import { loadGraph, saveGraph, loadUserPresets, saveUserPresets, loadUserPalettes, saveUserPalettes, loadActivePaletteId, saveActivePaletteId, loadUiMode, saveUiMode } from './storage';
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
import { grabVideoFrame, probeVideo, type VideoProbe } from './video';

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
  palettes: PaletteDefinition[];
  userPalettes: PaletteDefinition[];
  activePaletteId: string | null;
  activePalette: PaletteDefinition | null;
  maskEdit: MaskEditMode | null;
  videoTime: number;
  videoFrame: PixelImage | null;
  videoFrameLoading: boolean;
  paletteStudioOpen: boolean;
  toasts: Toast[];
  setMode: (mode: 'studio' | 'split' | 'graph') => void;
  selectNode: (id: string | null) => void;
  setSelectedOutput: (id: string) => void;
  setActiveAsset: (id: string) => void;
  setActivePalette: (id: string | null) => void;
  setPaletteStudioOpen: (open: boolean) => void;
  setVideoTime: (time: number) => void;
  setPreviewFullQuality: (full: boolean) => void;
  addNode: (type: GraphNodeType, x?: number, y?: number) => string;
  duplicateNode: (id: string) => string | null;
  deleteNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
  moveNode: (id: string, x: number, y: number) => void;
  addEdge: (fromNode: string, fromPort: string, toNode: string, toPort: string) => void;
  deleteEdge: (edgeId: string) => void;
  addAssets: (nodeId: string, files: File[]) => Promise<void>;
  importFiles: (nodeId: string, files: File[]) => Promise<void>;
  removeAsset: (nodeId: string, assetId: string) => void;
  clearAssets: (nodeId: string) => void;
  applyPreset: (preset: Preset) => void;
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

export function StudioProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [graph, setGraph] = useState<PipelineGraph>(() => {
    const stored = loadGraph();
    if (stored && stored.nodes.length > 0) return stored;
    return createDefaultGraph(defaultSettings());
  });
  const [assetsByNode, setAssetsByNode] = useState<Record<string, AssetRecord[]>>({});
  const [activeAssetId, setActiveAssetIdState] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [mode, setModeState] = useState<'studio' | 'split' | 'graph'>(() => loadUiMode());
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewFullQuality, setPreviewFullQuality] = useState(false);
  const [userPresets, setUserPresets] = useState<Preset[]>(() => loadUserPresets());
  const [userPalettes, setUserPalettes] = useState<PaletteDefinition[]>(() => loadUserPalettes());
  const [activePaletteId, setActivePaletteIdState] = useState<string | null>(() => loadActivePaletteId());
  const [maskOverrides, setMaskOverrides] = useState<Record<string, MaskData>>({});
  const [maskEdit, setMaskEditState] = useState<MaskEditMode | null>(null);
  const [videoTime, setVideoTimeState] = useState(0);
  const [videoFrame, setVideoFrame] = useState<PixelImage | null>(null);
  const [videoFrameLoading, setVideoFrameLoading] = useState(false);
  const [paletteStudioOpen, setPaletteStudioOpen] = useState(false);
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
      }),
    [graph, assetsByNode, maskOverrides],
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
    const gen = ++renderGenRef.current;
    setIsRendering(true);
    setPreviewError(null);

    const timer = window.setTimeout(() => {
      try {
        const settings = settingsFromItem(activeItem);
        let source = activeItem.source;
        let masks = activeItem.masks;
        if (activeAsset?.kind === 'video' && videoFrame) {
          source = videoFrame;
          masks = { ...masks };
        }
        const result = renderPixelArt(
          { image: source, masks, settings },
          {
            stopAfter: stopStageForNode(previewNode.type),
            upscale: false,
            seed: 0,
            maxWorkingSide: previewFullQuality ? 2048 : 1200,
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
  }, [previewNode, activeItem, activeAsset, videoFrame, previewFullQuality]);

  // Persist the graph and libraries.
  useEffect(() => {
    saveGraph(graph);
  }, [graph]);
  useEffect(() => {
    saveUserPresets(userPresets);
  }, [userPresets]);
  useEffect(() => {
    saveUserPalettes(userPalettes);
  }, [userPalettes]);
  useEffect(() => {
    saveActivePaletteId(activePaletteId);
  }, [activePaletteId]);
  useEffect(() => {
    saveUiMode(mode);
  }, [mode]);

  // Video preview frame extraction.
  useEffect(() => {
    if (!activeAsset || activeAsset.kind !== 'video' || !activeAsset.file) {
      setVideoFrame(null);
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
  }, [activeAsset, videoTime, notify]);

  const setMode = useCallback((next: 'studio' | 'split' | 'graph') => {
    setModeState(next);
    if (next === 'studio' && selectedOutputId) setSelectedNodeId(selectedOutputId);
  }, [selectedOutputId]);

  const selectNode = useCallback((id: string | null) => setSelectedNodeId(id), []);
  const setSelectedOutput = useCallback((id: string) => {
    setSelectedOutputId(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node) setSelectedNodeId(id);
  }, [graph.nodes]);
  const setActiveAsset = useCallback((id: string) => setActiveAssetIdState(id), []);
  const setActivePalette = useCallback((id: string | null) => setActivePaletteIdState(id), []);
  const setPaletteStudioOpenCb = useCallback((open: boolean) => setPaletteStudioOpen(open), []);
  const setVideoTime = useCallback((time: number) => setVideoTimeState(Math.max(0, time)), []);

  const addNode = useCallback((type: GraphNodeType, x?: number, y?: number): string => {
    const settings = settingsFromGraph(graph);
    let px = x;
    let py = y;
    let connectFrom: GraphNode | null = null;
    if (px === undefined || py === undefined) {
      const anchor = selectedNode ?? graph.nodes[0];
      if (anchor) {
        px = anchor.x + 260;
        py = anchor.y;
        const out = NODE_DEFS[anchor.type].outputs.find((p) => p.type === 'media');
        const inp = NODE_DEFS[type].inputs.find((p) => p.type === 'media');
        if (out && inp) connectFrom = anchor;
      } else {
        px = 80;
        py = 200;
      }
    }
    const node = createNode(type, px, py, nodeParams(type, settings), settings);
    mutateGraph((g) => {
      let next: PipelineGraph = { ...g, nodes: [...g.nodes, node] };
      if (connectFrom) {
        next = {
          ...next,
          edges: [
            ...next.edges,
            {
              id: uid('edge'),
              fromNode: connectFrom.id,
              fromPort: 'media',
              toNode: node.id,
              toPort: 'media',
            },
          ],
        };
      }
      return next;
    });
    setSelectedNodeId(node.id);
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

  const moveNode = useCallback((id: string, x: number, y: number) => {
    mutateGraph(
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
      }),
      true,
    );
  }, [mutateGraph]);

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
    setModeState('studio');
    notify(`Preset “${preset.name}” applied.`, 'success');
  }, [allAssets, graph, notify]);

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
  const clearMaskOverride = useCallback((key: string) => {
    setMaskOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const clearAllMaskOverrides = useCallback(() => setMaskOverrides({}), []);
  const refreshMasks = useCallback(() => {
    maskCacheRef.current.clear();
    setMaskOverrides({});
    setGraph((g) => ({ ...g }));
    setHistoryTick((v) => v + 1);
  }, []);
  const beginMaskEdit = useCallback((nodeId: string, maskId: string) => {
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
        { image: activeAsset?.kind === 'video' && videoFrame ? videoFrame : activeItem.source, masks: activeItem.masks, settings },
        { upscale: true },
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
              app: 'PixelArtify Studio',
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
          `${name.replace(/\.[^.]+$/, '')}.pixelartify.json`,
        );
      }
      notify('Image exported.', 'success');
    } catch (err) {
      notify(`Export failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [activeAsset, activeItem, notify, previewNode, videoFrame, applyOutputSettings]);

  const exportLayers = useCallback(async () => {
    if (!activeItem) {
      notify('Nothing to export.', 'warn');
      return;
    }
    setIsExporting(true);
    setExportProgress('Rendering layers…');
    try {
      const settings = applyOutputSettings(activeItem);
      const result = renderPixelArt({ image: activeItem.source, masks: activeItem.masks, settings }, { upscale: false });
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
            app: 'PixelArtify Studio',
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
  }, [activeAsset, activeItem, notify, applyOutputSettings]);

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
        const result = renderPixelArt({ image: item.source, masks: item.masks, settings }, { upscale: true });
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
            name: `${item.name.replace(/\.[^.]+$/, '')}.pixelartify.json`,
            data: JSON.stringify(
              {
                app: 'PixelArtify Studio',
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
  }, [evaluation, notify, selectedOutputId, applyOutputSettings]);

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
    palettes,
    userPalettes,
    activePaletteId: activePalette?.id ?? null,
    activePalette,
    maskEdit,
    videoTime,
    videoFrame,
    videoFrameLoading,
    paletteStudioOpen,
    toasts,
    setMode,
    selectNode,
    setSelectedOutput,
    setActiveAsset,
    setActivePalette,
    setPaletteStudioOpen: setPaletteStudioOpenCb,
    setVideoTime,
    setPreviewFullQuality,
    addNode,
    duplicateNode,
    deleteNode,
    updateNode,
    updateNodeParams,
    moveNode,
    addEdge,
    deleteEdge,
    addAssets: addAssetsInternal,
    importFiles,
    removeAsset,
    clearAssets,
    applyPreset,
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


