import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_DEFS, type NodePortDef } from '../../core/graph';
import type { GraphEdge, GraphNode, GraphNodeType, PipelineGraph } from '../../core/types';
import { getPath, setPath } from '../../core/value';
import { DITHER_BY_ID } from '../../core/dither';
import { pixelImageToDataUrl } from '../io';
import { useStudio } from '../store';
import { nodeCpuWarning } from '../bottlenecks';
import { Icon, type IconName } from './icons';
import { IconButton } from './controls';

const NODE_WIDTH = 212;
const HEADER_H = 38;
const PORT_START = 16;
const PORT_STEP = 22;
const FOOTER_H = 38;
const PREVIEW_H = 72;
const PORT_DOT_INSET = 9;
const PORT_ROW_CENTER = 11;
const GROUP_WIDTH = 220;
const GROUP_HEIGHT = 112;
const GROUP_HEAD_H = 46;
const GROUP_BODY_H = 34;
const GROUP_PORT_START = GROUP_HEAD_H + GROUP_BODY_H;

export const TYPE_ICON: Record<GraphNodeType, IconName> = {
  input: 'image',
  crop: 'fit',
  resize: 'zoomIn',
  channels: 'layers',
  color: 'sliders',
  preprocess: 'wand',
  pixelate: 'grid',
  palette: 'palette',
  dither: 'sparkles',
  extract: 'eye',
  compose: 'layers',
  background: 'background',
  object3d: 'cube',
  animate: 'wave',
  timeline: 'clock',
  retime: 'gauge',
  group: 'layers',
  postprocess: 'settings',
  merge: 'link',
  router: 'link',
  constant: 'hash',
  math: 'func',
  text: 'text',
  transform: 'move',
  switcher: 'link',
  shape2d: 'shape',
  particles: 'sparkles',
  plugin: 'sparkles',
  vectorize: 'vector',
  rasterize: 'vector',
  output: 'download',
};

function nodeHeight(node: GraphNode, showPreview: boolean, inputCount?: number): number {
  const def = NODE_DEFS[node.type];
  const inputs = inputCount ?? def.inputs.length;
  const ports = Math.max(inputs, def.outputs.length);
  const pins = pinnedFieldRows(node);
  return HEADER_H + 16 + ports * PORT_STEP + pins * 20 + FOOTER_H + (showPreview ? PREVIEW_H : 0);
}

function pinnedFieldRows(node: GraphNode): number {
  const pins = (node.params.pins as Record<string, boolean> | undefined) ?? {};
  return Object.values(pins).filter(Boolean).length;
}

function visibleInputPorts(node: GraphNode, graph: PipelineGraph): NodePortDef[] {
  return NODE_DEFS[node.type].inputs.filter(
    (p) => p.type !== 'value' || graph.edges.some((e) => e.toNode === node.id && e.toPort === 'value'),
  );
}

function pinnedFieldList(node: GraphNode): Array<{ path: string; label: string }> {
  const pins = (node.params.pins as Record<string, boolean> | undefined) ?? {};
  return Object.keys(pins)
    .filter((p) => pins[p])
    .map((path) => ({
      path,
      label: path.split('.').pop()?.replace(/[_-]/g, ' ') ?? path,
    }));
}

interface GroupBoundaryPort {
  key: string;
  nodeId: string;
  portId: string;
  type: string;
  label: string;
}

/** Boundary ports of a collapsed group: inputs from outside, outputs to outside. */
function groupBoundaryPorts(
  graph: PipelineGraph,
  group: GraphNode,
): { inPorts: GroupBoundaryPort[]; outPorts: GroupBoundaryPort[] } {
  const ids = new Set(Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : []);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inPorts: GroupBoundaryPort[] = [];
  const outPorts: GroupBoundaryPort[] = [];
  const seenIn = new Set<string>();
  const seenOut = new Set<string>();
  for (const edge of graph.edges) {
    const fromInternal = ids.has(edge.fromNode);
    const toInternal = ids.has(edge.toNode);
    if (fromInternal && !toInternal) {
      const node = byId.get(edge.fromNode);
      const port = node ? NODE_DEFS[node.type].outputs.find((p) => p.id === edge.fromPort) : undefined;
      if (port) {
        const key = `${edge.fromNode}:${edge.fromPort}`;
        if (!seenOut.has(key)) {
          seenOut.add(key);
          outPorts.push({ key, nodeId: edge.fromNode, portId: edge.fromPort, type: port.type, label: port.label });
        }
      }
    } else if (!fromInternal && toInternal) {
      const node = byId.get(edge.toNode);
      const port = node ? NODE_DEFS[node.type].inputs.find((p) => p.id === edge.toPort) : undefined;
      if (port) {
        const key = `${edge.toNode}:${edge.toPort}`;
        if (!seenIn.has(key)) {
          seenIn.add(key);
          inPorts.push({ key, nodeId: edge.toNode, portId: edge.toPort, type: port.type, label: port.label });
        }
      }
    }
  }
  return { inPorts, outPorts };
}

function summaryFor(node: GraphNode, assetCount: number): string {
  const p = node.params as Record<string, unknown>;
  switch (node.type) {
    case 'input': {
      const label = String(p.label ?? 'Media');
      return assetCount === 0 ? `${label} · empty` : `${label} · ${assetCount} asset${assetCount === 1 ? '' : 's'}`;
    }
    case 'crop': {
      const unit = String(p.unit ?? 'normalized');
      return `${unit} · ${Number(p.x ?? 0).toFixed(unit === 'pixels' ? 0 : 2)}, ${Number(p.y ?? 0).toFixed(unit === 'pixels' ? 0 : 2)}`;
    }
    case 'resize': {
      const w = Number(p.width ?? 0);
      const h = Number(p.height ?? 0);
      const unit = String(p.unit ?? 'pixels');
      const filter = String(p.filter ?? 'nearest');
      if (unit === 'times') {
        return `${Number(p.factor ?? 2)}× · ${filter}`;
      }
      return `${w || 'auto'} × ${h || 'auto'} · ${filter}`;
    }
    case 'channels': {
      return `${String(p.operation ?? 'extract')} · ${String(p.channel ?? 'luma')}${p.keepAlpha ? ' · alpha' : ''}`;
    }
    case 'color': {
      const c = p.color as { contrast?: number; saturation?: number; temperature?: number } | undefined;
      return `contrast ${Number(c?.contrast ?? 1).toFixed(2)} · sat ${Number(c?.saturation ?? 1).toFixed(2)}`;
    }
    case 'preprocess': {
      const ops = Array.isArray(p.ops) ? p.ops : [];
      return ops.length === 0 ? 'no effects' : `${ops.length} effect${ops.length === 1 ? '' : 's'}`;
    }
    case 'pixelate': {
      const res = p.resolution as { mode?: string; value?: number } | undefined;
      const pixelate = p.pixelate as { edgeAware?: boolean } | undefined;
      const mode = res?.mode === 'fixed-height' ? 'h' : res?.mode === 'fixed-width' ? 'w' : res?.mode === 'short-side' ? 'short' : 'block';
      return `${res?.value ?? 270}${mode === 'block' ? 'px blocks' : mode} · ${pixelate?.edgeAware === false ? 'naive' : 'edge-aware'}`;
    }
    case 'palette': {
      const pal = p.palette as { mode?: string; autoCount?: number; colors?: string[] } | undefined;
      return pal?.mode === 'custom'
        ? `custom · ${pal.colors?.length ?? 0} colours`
        : pal?.mode === 'auto'
          ? `auto · ${pal.autoCount ?? 24} colours`
          : 'no palette';
    }
    case 'dither': {
      const d = p.dither as { algorithm?: string } | undefined;
      const def = DITHER_BY_ID[d?.algorithm ?? ''] ?? DITHER_BY_ID.none;
      return def?.name ?? 'None';
    }
    case 'extract': {
      const e = p.extraction as { method?: string } | undefined;
      return `${e?.method ?? 'saliency'} · ${String(p.maskId ?? 'subject')}${p.onlyExtracted ? ' · isolated' : ''}`;
    }
    case 'compose': {
      const layers = Array.isArray(p.layers) ? p.layers : [];
      return `${layers.length} layer${layers.length === 1 ? '' : 's'}`;
    }
    case 'background': {
      const mode = String(p.mode ?? 'linear');
      return mode === 'solid' || mode === 'transparent'
        ? mode
        : `${mode} · ${Number(p.scale ?? 32)}px`;
    }
    case 'object3d': {
      return `${String(p.primitive ?? 'cube')} · ${Number(p.rotationY ?? 0)}°`;
    }
    case 'animate': {
      const wrap = String(p.wrap ?? 'horizontal');
      return `${Number(p.duration ?? 4).toFixed(1)}s · ${Number(p.fps ?? 24)} fps · ${wrap}`;
    }
    case 'timeline': {
      return `${Number(p.duration ?? 4).toFixed(1)}s · ${Number(p.fps ?? 24)} fps`;
    }
    case 'retime': {
      return `${String(p.mode ?? 'stop-motion')} · ${Number(p.targetFps ?? 12)} fps`;
    }
    case 'group': {
      const ids = Array.isArray(p.nodeIds) ? p.nodeIds : [];
      return `${ids.length} node${ids.length === 1 ? '' : 's'} · ${p.expanded ? 'expanded' : 'collapsed'}`;
    }
    case 'postprocess': {
      const post = p.postprocess as { ops?: unknown[] } | undefined;
      return `${post?.ops?.length ?? 0} effect${(post?.ops?.length ?? 0) === 1 ? '' : 's'}`;
    }
    case 'merge':
      return 'concatenate batches';
    case 'router':
      return 'pass-through reroute';
    case 'switcher':
      return `input ${Number(p.activeIndex ?? 0) + 1}`;
    case 'shape2d':
      return `${String(p.shape ?? 'circle')} · ${String(p.fill ?? 'solid')}`;
    case 'particles':
      return `${String(p.preset ?? 'dust')} · ${Number(p.count ?? 0)} particles`;
    case 'plugin':
      return String(p.pluginId ?? 'no plugin');
    case 'vectorize':
      return `${p.merge ? 'merged rects' : 'per-pixel rects'}`;
    case 'rasterize':
      return 'rects → pixels';
    case 'output': {
      const output = p.output as { format?: string } | undefined;
      const video = p.video as { output?: string } | undefined;
      return `${output?.format ?? 'png'} · ${video?.output ?? 'video'}`;
    }
    default:
      return '';
  }
}

interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

interface DragState {
  id: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  dx: number;
  dy: number;
  moved: boolean;
  /** Shift-drag detaches the node from its wires and reattaches on drop. */
  detach?: boolean;
  detached?: boolean;
}

interface LinkState {
  fromNode: string;
  fromPort: string;
  fromSide: 'out' | 'in';
  type: string;
  x: number;
  y: number;
  /** Visual origin (graph space) for the temp wire; defaults to the node port. */
  originX: number;
  originY: number;
  startX: number;
  startY: number;
  moved: boolean;
  pending: boolean;
}

interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  control: number;
}

function edgeGeometry(
  edge: GraphEdge,
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
): EdgeGeometry | null {
  const from = nodes.find((n) => n.id === edge.fromNode);
  const to = nodes.find((n) => n.id === edge.toNode);
  if (!from || !to) return null;
  const fp = positions.get(from.id);
  const tp = positions.get(to.id);
  if (!fp || !tp) return null;
  const fromDef = NODE_DEFS[from.type];
  const outIdx = fromDef.outputs.findIndex((p) => p.id === edge.fromPort);
  const inIdx = NODE_DEFS[to.type].inputs.findIndex((p) => p.id === edge.toPort);
  if (outIdx < 0 || inIdx < 0) return null;
  return {
    x1: fp.x + NODE_WIDTH - PORT_DOT_INSET,
    y1: fp.y + HEADER_H + PORT_START + outIdx * PORT_STEP + PORT_ROW_CENTER,
    x2: tp.x + PORT_DOT_INSET,
    y2: tp.y + HEADER_H + PORT_START + inIdx * PORT_STEP + PORT_ROW_CENTER,
    control: Math.max(50, Math.abs(tp.x - fp.x) * 0.45),
  };
}

function edgePoint(geometry: EdgeGeometry, t: number): { x: number; y: number } {
  const mt = 1 - t;
  const c1 = geometry.x1 + geometry.control;
  const c2 = geometry.x2 - geometry.control;
  return {
    x: mt * mt * mt * geometry.x1 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * geometry.x2,
    y: mt * mt * mt * geometry.y1 + 3 * mt * mt * t * geometry.y1 + 3 * mt * t * t * geometry.y2 + t * t * t * geometry.y2,
  };
}

export function GraphCanvas(): React.ReactElement {
  const {
    graph,
    assetsByNode,
    activeAsset,
    selectedNodeId,
    selectedNodeIds,
    previewNodeId,
    preview,
    selectNode,
    moveNode,
    moveNodeDetached,
    detachNodeWithBridge,
    addEdge,
    deleteEdge,
    insertNodeOnEdge,
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
    setGraphCursor,
    subgraphs,
    insertSubgraph,
    deleteSubgraph,
    mode,
  } = useStudio();

  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ x: 40, y: 40, zoom: 0.72 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [link, setLink] = useState<LinkState | null>(null);
  const linkRef = useRef<LinkState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addActive, setAddActive] = useState(0);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null);
  const userMovedRef = useRef(false);
  const detachedRef = useRef<string | null>(null);

  const setLinkState = useCallback((next: LinkState | null) => {
    linkRef.current = next;
    setLink(next);
  }, []);

  const cpuWarnings = useMemo(() => {
    const map: Record<string, NonNullable<ReturnType<typeof nodeCpuWarning>>> = {};
    for (const node of graph.nodes) {
      const warning = nodeCpuWarning(node, graph);
      if (warning) map[node.id] = warning;
    }
    return map;
  }, [graph]);

  const effectivePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const draggedGroup = drag
      ? graph.nodes.find((node) => node.id === drag.id && node.type === 'group')
      : null;
    const draggedIds = new Set(
      Array.isArray(draggedGroup?.params.nodeIds)
        ? (draggedGroup!.params.nodeIds as string[])
        : [],
    );
    for (const node of graph.nodes) {
      if (drag && drag.id === node.id) {
        map.set(node.id, { x: drag.origX + drag.dx, y: drag.origY + drag.dy });
      } else if (drag && draggedIds.has(node.id)) {
        map.set(node.id, { x: node.x + drag.dx, y: node.y + drag.dy });
      } else {
        map.set(node.id, { x: node.x, y: node.y });
      }
    }
    return map;
  }, [graph.nodes, drag]);

  const groupNodes = useMemo(
    () => graph.nodes.filter((node) => node.type === 'group'),
    [graph.nodes],
  );
  const collapsedGroups = useMemo(
    () => groupNodes.filter((group) => group.params.expanded === false),
    [groupNodes],
  );
  const collapsedGroupFor = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const group of collapsedGroups) {
      const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
      for (const id of ids) map.set(id, group);
    }
    return map;
  }, [collapsedGroups]);
  const hiddenNodeIds = useMemo(() => new Set(collapsedGroupFor.keys()), [collapsedGroupFor]);

  // Boundary ports for every collapsed group, used for both the port dots and
  // the edge line anchor positions.
  const groupPorts = useMemo(() => {
    const map = new Map<string, { inPorts: GroupBoundaryPort[]; outPorts: GroupBoundaryPort[] }>();
    for (const group of collapsedGroups) {
      map.set(group.id, groupBoundaryPorts(graph, group));
    }
    return map;
  }, [graph, collapsedGroups]);

  const groupPortY = (index: number): number => GROUP_PORT_START + index * PORT_STEP + PORT_ROW_CENTER;
  const groupBoxHeight = (group: GraphNode): number => {
    const ports = groupPorts.get(group.id);
    const rows = ports ? Math.max(ports.inPorts.length, ports.outPorts.length) : 0;
    return GROUP_HEAD_H + GROUP_BODY_H + rows * PORT_STEP + 14;
  };

  const groupBounds = useCallback(
    (group: GraphNode): { x: number; y: number; width: number; height: number } => {
      const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
      const members = graph.nodes.filter(
        (node) => ids.includes(node.id) && node.type !== 'group',
      );
      if (members.length === 0) {
        return { x: group.x, y: group.y, width: GROUP_WIDTH, height: GROUP_HEIGHT };
      }
      const positions = members.map((node) => effectivePositions.get(node.id) ?? { x: node.x, y: node.y });
      const heights = members.map((node) => nodeHeight(node, node.id === previewNodeId));
      const minX = Math.min(...positions.map((pos) => pos.x));
      const minY = Math.min(...positions.map((pos) => pos.y));
      const maxX = Math.max(...positions.map((pos) => pos.x + NODE_WIDTH));
      const maxY = Math.max(...positions.map((pos, i) => pos.y + heights[i]));
      return {
        x: minX - 18,
        y: minY - 34,
        width: maxX - minX + 36,
        height: maxY - minY + 52,
      };
    },
    [effectivePositions, graph.nodes, previewNodeId],
  );

  const findInsertEdge = useCallback(
    (nodeId: string, pos: { x: number; y: number }, detach = false): string | null => {
      const moving = graph.nodes.find((n) => n.id === nodeId);
      if (!moving) return null;
      const def = NODE_DEFS[moving.type];
      if (def.inputs.length === 0 || def.outputs.length === 0) return null;

      const positions = new Map(effectivePositions);
      positions.set(nodeId, pos);
      const height = nodeHeight(moving, false);
      const left = pos.x - 10;
      const top = pos.y - 10;
      const right = pos.x + NODE_WIDTH + 10;
      const bottom = pos.y + height + 10;
      const cx = pos.x + NODE_WIDTH / 2;
      const cy = pos.y + height / 2;

      let best: string | null = null;
      let bestDistance = Infinity;
      for (const edge of graph.edges) {
        if (edge.fromNode === nodeId || edge.toNode === nodeId) continue;
        const source = graph.nodes.find((n) => n.id === edge.fromNode);
        if (!source) continue;
        const type = NODE_DEFS[source.type].outputs.find((p) => p.id === edge.fromPort)?.type;
        if (!type) continue;
        const input = def.inputs.find((p) => p.type === type);
        const output = def.outputs.find((p) => p.type === type);
        if (!input || !output) continue;
        const occupied = graph.edges.some((e) => e.toNode === nodeId && e.toPort === input.id);
        if (occupied && !input.multiple && !detach) continue;

        const geometry = edgeGeometry(edge, graph.nodes, positions);
        if (!geometry) continue;
        let inside = false;
        let minDistance = Infinity;
        for (let i = 0; i <= 36; i++) {
          const point = edgePoint(geometry, i / 36);
          if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
            inside = true;
          }
          const d = Math.hypot(point.x - cx, point.y - cy);
          if (d < minDistance) minDistance = d;
        }
        if (!inside) continue;
        if (minDistance < bestDistance) {
          bestDistance = minDistance;
          best = edge.id;
        }
      }
      return best;
    },
    [effectivePositions, graph.edges, graph.nodes],
  );

  useEffect(() => {
    if (!drag || !drag.moved) {
      setInsertEdgeId(null);
      return;
    }
    setInsertEdgeId(
      findInsertEdge(
        drag.id,
        { x: drag.origX + drag.dx, y: drag.origY + drag.dy },
        drag.detach,
      ),
    );
  }, [drag, findInsertEdge]);

  const selectedPreview = useMemo(() => {
    if (!preview || !previewNodeId) return null;
    try {
      return pixelImageToDataUrl(preview.art);
    } catch {
      return null;
    }
  }, [preview, previewNodeId]);

  const fitView = useCallback(() => {
    const el = viewportRef.current;
    if (!el || graph.nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + nodeHeight(node, false));
    }
    const pad = 70;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    const zoom = Math.max(0.22, Math.min(1.1, Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY))));
    setView({
      x: (w - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (h - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  }, [graph.nodes]);

  useEffect(() => {
    const timer = setTimeout(fitView, 90);
    return () => clearTimeout(timer);
  }, [fitView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!userMovedRef.current) fitView();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      userMovedRef.current = true;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0014);
        const zoom = Math.max(0.18, Math.min(2.6, prev.zoom * factor));
        const wx = (mx - prev.x) / prev.zoom;
        const wy = (my - prev.y) / prev.zoom;
        return { zoom, x: mx - wx * zoom, y: my - wy * zoom };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent): void => {
      const movedDistance =
        Math.abs(e.clientX - drag.startClientX) + Math.abs(e.clientY - drag.startClientY);
      if (drag.detach && !drag.detached && movedDistance > 3 && detachedRef.current !== drag.id) {
        detachedRef.current = drag.id;
        detachNodeWithBridge(drag.id);
      }
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              dx: (e.clientX - prev.startClientX) / view.zoom,
              dy: (e.clientY - prev.startClientY) / view.zoom,
              moved: prev.moved || movedDistance > 3,
              detached: prev.detached || (prev.detach === true && movedDistance > 3),
            }
          : prev,
      );
    };
    const onUp = (): void => {
      setDrag((prev) => {
        if (prev && prev.moved) {
          const pos = { x: prev.origX + prev.dx, y: prev.origY + prev.dy };
          const targetEdge = findInsertEdge(prev.id, pos, prev.detach);
          const moving = graph.nodes.find((node) => node.id === prev.id);
          if (moving?.type === 'group') {
            moveGroup(prev.id, pos.x, pos.y);
          } else if (prev.detach) {
            moveNodeDetached(prev.id, pos.x, pos.y, targetEdge);
          } else {
            if (targetEdge) insertNodeOnEdge(prev.id, targetEdge);
            moveNode(prev.id, pos.x, pos.y);
          }
        }
        return null;
      });
      detachedRef.current = null;
      setInsertEdgeId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [
    drag,
    findInsertEdge,
    graph.nodes,
    insertNodeOnEdge,
    moveGroup,
    moveNode,
    moveNodeDetached,
    detachNodeWithBridge,
    view.zoom,
  ]);

  useEffect(() => {
    if (!pan) return;
    const onMove = (e: PointerEvent): void => {
      setView((prev) => ({ ...prev, x: pan.vx + (e.clientX - pan.x), y: pan.vy + (e.clientY - pan.y) }));
    };
    const onUp = (): void => setPan(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pan]);

  const finishLink = useCallback(
    (toNode: string, toPort: string, toType: string, toSide: 'out' | 'in'): boolean => {
      const current = linkRef.current;
      if (!current) return false;
      if (current.type !== toType) return false;
      // Always connect an output to an input, regardless of which end the
      // user started dragging from.
      if (current.fromSide === toSide) return false;
      setLinkState(null);
      if (current.fromSide === 'out') {
        addEdge(current.fromNode, current.fromPort, toNode, toPort);
      } else {
        addEdge(toNode, toPort, current.fromNode, current.fromPort);
      }
      return true;
    },
    [addEdge, setLinkState],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const current = linkRef.current;
      if (!current) return;
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const moved =
        current.moved ||
        Math.abs(e.clientX - current.startX) + Math.abs(e.clientY - current.startY) > 4;
      const next: LinkState = {
        ...current,
        x: (e.clientX - rect.left - view.x) / view.zoom,
        y: (e.clientY - rect.top - view.y) / view.zoom,
        moved,
      };
      linkRef.current = next;
      setLink(next);
    };

    const onUp = (e: PointerEvent): void => {
      const current = linkRef.current;
      if (!current) return;
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(
          current.fromSide === 'out' ? '[data-port-in]' : '[data-port-out-row]',
        ) as HTMLElement | null;
      if (target) {
        const nodeId = target.dataset.nodeId;
        const portId = target.dataset.portId;
        const portType = target.dataset.portType;
        if (nodeId && portId && portType) {
          const toSide = current.fromSide === 'out' ? 'in' : 'out';
          if (finishLink(nodeId, portId, portType, toSide)) return;
        }
      }
      // A quick click on the output port enters "pending" mode: the next input
      // port click completes the connection. A click elsewhere cancels.
      if (!current.moved && !current.pending) {
        const next = { ...current, pending: true };
        linkRef.current = next;
        setLink(next);
        return;
      }
      setLinkState(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [finishLink, setLinkState, view]);

  useEffect(() => {
    if (!link) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLinkState(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link, setLinkState]);

  const startLink = (
    node: GraphNode,
    port: string,
    type: string,
    e: React.PointerEvent,
    side: 'out' | 'in',
    visual?: { x: number; y: number },
  ): void => {
    e.stopPropagation();
    e.preventDefault();
    if (linkRef.current) return;
    const pos = effectivePositions.get(node.id)!;
    const def = NODE_DEFS[node.type];
    const ports = side === 'out' ? def.outputs : def.inputs;
    const idx = ports.findIndex((p) => p.id === port);
    const ox = visual
      ? visual.x
      : side === 'out'
        ? pos.x + NODE_WIDTH - PORT_DOT_INSET
        : pos.x + PORT_DOT_INSET;
    const oy = visual
      ? visual.y
      : pos.y + HEADER_H + PORT_START + Math.max(0, idx) * PORT_STEP + PORT_ROW_CENTER;
    setLinkState({
      fromNode: node.id,
      fromPort: port,
      fromSide: side,
      type,
      x: ox,
      y: oy,
      originX: ox,
      originY: oy,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pending: false,
    });
  };

  const filteredTypes = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return (Object.keys(NODE_DEFS) as GraphNodeType[]).filter((t) => {
      if (t === 'group') return false;
      const d = NODE_DEFS[t];
      return !q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || t.includes(q);
    });
  }, [addSearch]);

  const edgeColor = (type: string): string =>
    type === 'mask'
      ? '#06d6a0'
      : type === 'palette'
        ? '#e879f9'
        : type === 'motion'
          ? '#22d3ee'
          : type === 'value'
            ? '#fbbf24'
            : type === 'vector'
              ? '#8ecae6'
              : '#4cc9f0';

  return (
    <div className="graph-shell">
      <div className="graph-toolbar">
        <div className="graph-toolbar-left">
          <span className="graph-title">Node Graph</span>
          <span className="graph-meta">
            {graph.nodes.length} nodes · {graph.edges.length} links
          </span>
          {link ? (
            <span className={`link-hint ${link.pending ? 'is-pending' : ''}`}>
              {link.pending ? 'Click an input port to connect' : 'Drop on an input port'}
              <button type="button" className="text-btn" onClick={() => setLinkState(null)}>
                cancel
              </button>
            </span>
          ) : null}
        </div>
        <div className="graph-toolbar-right">
          <button
            type="button"
            className={`ghost-btn ${addOpen ? 'is-active' : ''}`}
            onClick={() => setAddOpen((v) => !v)}
          >
            <Icon name="plus" size={15} /> Add node
          </button>
          {selectedNodeIds.filter((id) => graph.nodes.find((n) => n.id === id)?.type !== 'group')
            .length >= 2 ? (
            <button type="button" className="ghost-btn" onClick={() => createGroup()}>
              <Icon name="layers" size={15} /> Group {selectedNodeIds.length}
            </button>
          ) : null}
          <IconButton icon="fit" label="Fit graph" onClick={fitView} />
          <div className="zoom-readout">{Math.round(view.zoom * 100)}%</div>
        </div>
        {addOpen ? (
          <div className="add-node-popover" onMouseLeave={() => setAddOpen(false)}>
            <div className="add-node-search">
              <Icon name="search" size={14} />
              <input
                autoFocus
                placeholder="Search nodes… · ↑↓ · Enter"
                value={addSearch}
                onChange={(e) => {
                  setAddSearch(e.target.value);
                  setAddActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAddActive((i) => (filteredTypes.length === 0 ? 0 : (i + 1) % filteredTypes.length));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAddActive((i) =>
                      filteredTypes.length === 0 ? 0 : (i - 1 + filteredTypes.length) % filteredTypes.length,
                    );
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const type = filteredTypes[addActive];
                    if (type) {
                      addNode(type);
                      setAddOpen(false);
                      setAddSearch('');
                    }
                  } else if (e.key === 'Escape') {
                    setAddOpen(false);
                  }
                }}
              />
            </div>
            <div className="add-node-list">
              {filteredTypes.map((type, index) => {
                const def = NODE_DEFS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className={`add-node-item ${index === addActive ? 'is-active' : ''}`}
                    onMouseEnter={() => setAddActive(index)}
                    onClick={() => {
                      addNode(type);
                      setAddOpen(false);
                      setAddSearch('');
                    }}
                  >
                    <span className="add-node-icon" style={{ color: def.accent }}>
                      <Icon name={TYPE_ICON[type]} size={16} />
                    </span>
                    <span>
                      <strong>{def.title}</strong>
                      <small>{def.description}</small>
                    </span>
                  </button>
                );
              })}
              {subgraphs.length > 0 ? (
                <>
                  <div className="node-search-group">Subgraphs</div>
                  {subgraphs.map((sub) => (
                    <div key={sub.id} className="add-node-item subgraph-row">
                      <button
                        type="button"
                        className="subgraph-insert"
                        onClick={() => {
                          insertSubgraph(sub.id);
                          setAddOpen(false);
                          setAddSearch('');
                        }}
                      >
                        <span className="add-node-icon" style={{ color: '#94a3b8' }}>
                          <Icon name="layers" size={16} />
                        </span>
                        <span>
                          <strong>{sub.name}</strong>
                          <small>{sub.nodes.length} node{sub.nodes.length === 1 ? '' : 's'}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="subgraph-delete"
                        title="Delete subgraph"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSubgraph(sub.id);
                        }}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className={`graph-viewport ${pan ? 'is-panning' : ''} ${link ? 'is-linking' : ''}`}
        onPointerMove={(e) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          setGraphCursor((e.clientX - rect.left - view.x) / view.zoom, (e.clientY - rect.top - view.y) / view.zoom);
        }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('graph-grid')) return;
          if (linkRef.current) {
            setLinkState(null);
            return;
          }
          selectNode(null);
          userMovedRef.current = true;
          setPan({ x: e.clientX, y: e.clientY, vx: view.x, vy: view.y });
        }}
      >
        <div
          className="graph-grid"
          style={{
            backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />
        <div
          className="graph-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg className="graph-edges" width="6000" height="4000" aria-hidden="true">
            <defs>
              <filter id="edge-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {graph.edges.map((edge) => {
              const from = graph.nodes.find((n) => n.id === edge.fromNode);
              const to = graph.nodes.find((n) => n.id === edge.toNode);
              if (!from || !to) return null;
              if (drag?.detach && drag.moved && (edge.fromNode === drag.id || edge.toNode === drag.id)) {
                return null;
              }
              const fromGroup = collapsedGroupFor.get(from.id);
              const toGroup = collapsedGroupFor.get(to.id);
              if (fromGroup && toGroup && fromGroup.id === toGroup.id) return null;
              const fromGroupPos = fromGroup
                ? effectivePositions.get(fromGroup.id) ?? { x: fromGroup.x, y: fromGroup.y }
                : null;
              const toGroupPos = toGroup
                ? effectivePositions.get(toGroup.id) ?? { x: toGroup.x, y: toGroup.y }
                : null;
              const fp = effectivePositions.get(from.id)!;
              const tp = effectivePositions.get(to.id)!;
              const fromDef = NODE_DEFS[from.type];
              const outIdx = fromDef.outputs.findIndex((p) => p.id === edge.fromPort);
              if (outIdx < 0) return null;
              const inIdx = NODE_DEFS[to.type].inputs.findIndex((p) => p.id === edge.toPort);
              if (inIdx < 0) return null;
              const outPort = fromDef.outputs[outIdx];
              const inPort = NODE_DEFS[to.type].inputs[inIdx];
              const fromPortIndex = fromGroup
                ? (groupPorts.get(fromGroup.id)?.outPorts ?? []).findIndex(
                    (p) => p.nodeId === edge.fromNode && p.portId === edge.fromPort,
                  )
                : -1;
              const toPortIndex = toGroup
                ? (groupPorts.get(toGroup.id)?.inPorts ?? []).findIndex(
                    (p) => p.nodeId === edge.toNode && p.portId === edge.toPort,
                  )
                : -1;
              const x1 = fromGroupPos
                ? fromGroupPos.x + GROUP_WIDTH - PORT_DOT_INSET
                : fp.x + NODE_WIDTH - PORT_DOT_INSET;
              const y1 =
                fromGroupPos && fromPortIndex >= 0
                  ? fromGroupPos.y + groupPortY(fromPortIndex)
                  : fp.y + HEADER_H + PORT_START + outIdx * PORT_STEP + PORT_ROW_CENTER;
              const x2 = toGroupPos ? toGroupPos.x + PORT_DOT_INSET : tp.x + PORT_DOT_INSET;
              const y2 =
                toGroupPos && toPortIndex >= 0
                  ? toGroupPos.y + groupPortY(toPortIndex)
                  : tp.y + HEADER_H + PORT_START + inIdx * PORT_STEP + PORT_ROW_CENTER;
              const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const color = edgeColor(outPort.type);
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;
              return (
                <g
                  key={edge.id}
                  data-edge-id={edge.id}
                  className={`graph-edge ${insertEdgeId === edge.id ? 'is-insert-target' : ''}`}
                >
                  <path
                    d={d}
                    className="edge-hit"
                    onPointerEnter={() => setHoverEdgeId(edge.id)}
                    onPointerLeave={() =>
                      setHoverEdgeId((current) => (current === edge.id ? null : current))
                    }
                    onDoubleClick={() => {
                      deleteEdge(edge.id);
                      setHoverEdgeId(null);
                    }}
                  >
                    <title>Hover to cut · double-click to disconnect</title>
                  </path>
                  <path d={d} stroke={color} className="edge-line" />
                  <circle cx={x2} cy={y2} r="3.5" fill={color} />
                  {hoverEdgeId === edge.id ? (
                    <g
                      className="edge-cut"
                      transform={`translate(${midX}, ${midY})`}
                      onPointerEnter={() => setHoverEdgeId(edge.id)}
                      onPointerLeave={() =>
                        setHoverEdgeId((current) => (current === edge.id ? null : current))
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteEdge(edge.id);
                        setHoverEdgeId(null);
                      }}
                    >
                      <circle r="9" />
                      <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
                      <title>Disconnect</title>
                    </g>
                  ) : null}
                </g>
              );
            })}
            {link
              ? (() => {
                  return (
                    <path
                      d={`M ${link.originX} ${link.originY} C ${link.x} ${link.y}, ${link.x} ${link.y}, ${link.x} ${link.y}`}
                      stroke={edgeColor(link.type)}
                      className="edge-line edge-temp"
                    />
                  );
                })()
              : null}
          </svg>

          {groupNodes.map((group) => {
            const expanded = group.params.expanded !== false;
            const selected = selectedNodeId === group.id;
            if (expanded) {
              const bounds = groupBounds(group);
              return (
                <div
                  key={group.id}
                  className={`node-group-frame ${selected ? 'is-selected' : ''}`}
                  style={{
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  }}
                >
                  <div
                    className="node-group-head"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if ((e.target as HTMLElement).closest('button')) return;
                      selectNode(group.id, !(e.ctrlKey || e.metaKey));
                      setDrag({
                        id: group.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: group.x,
                        origY: group.y,
                        dx: 0,
                        dy: 0,
                        moved: false,
                      });
                    }}
                  >
                    <Icon name="layers" size={13} />
                    <strong>{group.title}</strong>
                    <span>{Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]).length : 0} nodes</span>
                    <div className="node-group-actions">
                      <button type="button" title="Collapse group" onClick={() => setGroupExpanded(group.id, false)}>
                        <Icon name="minus" size={12} />
                      </button>
                      <button type="button" title="Duplicate group" onClick={() => duplicateGroup(group.id)}>
                        <Icon name="copy" size={12} />
                      </button>
                      <button type="button" title="Ungroup" onClick={() => ungroup(group.id)}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            const ids = Array.isArray(group.params.nodeIds) ? (group.params.nodeIds as string[]) : [];
            const ports = groupPorts.get(group.id) ?? { inPorts: [], outPorts: [] };
            const inPorts = ports.inPorts;
            const outPorts = ports.outPorts;
            const boxPos = effectivePositions.get(group.id) ?? { x: group.x, y: group.y };
            const internalNode = (id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id);
            return (
              <div
                key={group.id}
                className={`node-group-box ${selected ? 'is-selected' : ''}`}
                style={{
                  left: boxPos.x,
                  top: boxPos.y,
                  width: GROUP_WIDTH,
                  height: groupBoxHeight(group),
                  ['--node-accent' as string]: NODE_DEFS.group.accent,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if ((e.target as HTMLElement).closest('button, input, .node-group-port-row')) return;
                  selectNode(group.id, !(e.ctrlKey || e.metaKey));
                  setDrag({
                    id: group.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: group.x,
                    origY: group.y,
                    dx: 0,
                    dy: 0,
                    moved: false,
                  });
                }}
              >
                <div className="node-group-head">
                  <Icon name="layers" size={13} />
                  <strong>{group.title}</strong>
                  <span>{ids.length} nodes</span>
                  <div className="node-group-actions">
                    <button type="button" title="Expand group" onClick={() => setGroupExpanded(group.id, true)}>
                      <Icon name="plus" size={12} />
                    </button>
                    <button type="button" title="Duplicate group" onClick={() => duplicateGroup(group.id)}>
                      <Icon name="copy" size={12} />
                    </button>
                    <button type="button" title="Ungroup" onClick={() => ungroup(group.id)}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                </div>
                <div className="node-group-body">
                  <span>{inPorts.length} in · {outPorts.length} out</span>
                  <small>Collapsed group</small>
                </div>
                {inPorts.map((port, i) => {
                  const node = internalNode(port.nodeId);
                  if (!node) return null;
                  return (
                    <div
                      key={`in-${port.key}`}
                      className={`node-group-port-row node-group-port-in port-${port.type}`}
                      style={{ top: groupPortY(i) }}
                      data-port-in="true"
                      data-node-id={port.nodeId}
                      data-port-id={port.portId}
                      data-port-type={port.type}
                      onPointerUp={() => finishLink(port.nodeId, port.portId, port.type, 'in')}
                    >
                      <button
                        type="button"
                        className={`port-dot port-${port.type}`}
                        title={`Drag from ${port.label} (${port.type})`}
                        onPointerDown={(e) =>
                          startLink(node, port.portId, port.type, e, 'in', {
                            x: boxPos.x + PORT_DOT_INSET,
                            y: boxPos.y + groupPortY(i),
                          })
                        }
                      />
                      <span>{port.label}</span>
                    </div>
                  );
                })}
                {outPorts.map((port, i) => {
                  const node = internalNode(port.nodeId);
                  if (!node) return null;
                  return (
                    <div
                      key={`out-${port.key}`}
                      className={`node-group-port-row node-group-port-out port-${port.type}`}
                      style={{ top: groupPortY(i) }}
                      data-port-out-row="true"
                      data-node-id={port.nodeId}
                      data-port-id={port.portId}
                      data-port-type={port.type}
                      onPointerUp={() => finishLink(port.nodeId, port.portId, port.type, 'out')}
                    >
                      <span>{port.label}</span>
                      <button
                        type="button"
                        className={`port-dot port-${port.type}`}
                        title={`Drag from ${port.label} (${port.type})`}
                        onPointerDown={(e) =>
                          startLink(node, port.portId, port.type, e, 'out', {
                            x: boxPos.x + GROUP_WIDTH - PORT_DOT_INSET,
                            y: boxPos.y + groupPortY(i),
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {graph.nodes.map((node) => {
            if (node.type === 'group' || hiddenNodeIds.has(node.id)) return null;
            const def = NODE_DEFS[node.type];
            const pos = effectivePositions.get(node.id)!;
            const showPreview = node.id === previewNodeId;
            const visibleInputs = visibleInputPorts(node, graph);
            const height = nodeHeight(node, showPreview, visibleInputs.length);
            const selected = node.id === selectedNodeId || selectedNodeIds.includes(node.id);
            const portCount = Math.max(visibleInputs.length, def.outputs.length);
            const pinned = pinnedFieldList(node);
            const assets = assetsByNode[node.id] ?? [];
            const previewSrc = node.type === 'input' ? activeAsset?.thumb : showPreview ? selectedPreview : null;
            return (
              <div
                key={node.id}
                className={`graph-node ${selected ? 'is-selected' : ''} ${node.bypassed ? 'is-bypassed' : ''} ${cpuWarnings[node.id] ? 'has-cpu-warning' : ''} ${drag?.detach && drag.moved && drag.id === node.id ? 'is-detaching' : ''}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_WIDTH,
                  height,
                  ['--node-accent' as string]: def.accent,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  selectNode(node.id, !(e.ctrlKey || e.metaKey));
                }}
              >
                <div
                  className="node-head"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if ((e.target as HTMLElement).closest('button')) return;
                    selectNode(node.id, !(e.ctrlKey || e.metaKey));
                    detachedRef.current = null;
                    setDrag({
                      id: node.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                      dx: 0,
                      dy: 0,
                      moved: false,
                      detach: e.shiftKey,
                    });
                  }}
                >
                  <span className="node-icon" style={{ color: def.accent }}>
                    <Icon name={TYPE_ICON[node.type]} size={15} />
                  </span>
                  <span className="node-title">{node.title}</span>
                  {cpuWarnings[node.id] ? (
                    <span
                      className="node-warning"
                      title={`${cpuWarnings[node.id]!.title}: ${cpuWarnings[node.id]!.detail}`}
                      aria-label={cpuWarnings[node.id]!.title}
                    >
                      !
                    </span>
                  ) : null}
                  <span className="node-actions">
                    <button
                      type="button"
                      className={`node-dot ${node.bypassed ? 'is-off' : ''}`}
                      title={node.bypassed ? 'Enable node' : 'Bypass node'}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNode(node.id, { bypassed: !node.bypassed });
                      }}
                    />
                    <button
                      type="button"
                      title="Duplicate node"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateNode(node.id);
                      }}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete node"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNode(node.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </span>
                </div>

                <div className="node-ports" style={{ height: portCount * PORT_STEP + 16 }}>
                  {visibleInputs.map((port, i) => {
                      const isSource =
                        link?.fromNode === node.id &&
                        link.fromPort === port.id &&
                        link.fromSide === 'in';
                      const compatible = Boolean(link && link.fromSide === 'out' && link.type === port.type);
                      const incompatible = Boolean(link && !compatible && !isSource);
                      return (
                        <div
                          key={port.id}
                          className={`node-port node-port-in ${
                            compatible ? 'is-compatible' : incompatible ? 'is-incompatible' : ''
                          } ${isSource ? 'is-source' : ''}`}
                          style={{ top: PORT_START + i * PORT_STEP }}
                          data-port-in="true"
                          data-node-id={node.id}
                          data-port-id={port.id}
                          data-port-type={port.type}
                          title={`${port.label} (${port.type}) — drop a connection here`}
                          onPointerUp={() => finishLink(node.id, port.id, port.type, 'in')}
                        >
                          <button
                            type="button"
                            className={`port-dot port-${port.type}`}
                            aria-label={`Start connection from ${port.label}`}
                            title={`Drag from ${port.label} (${port.type}) to an output`}
                            onPointerDown={(e) => {
                              if (linkRef.current) return;
                              startLink(node, port.id, port.type, e, 'in');
                            }}
                          />
                          <span>{port.label}</span>
                          {port.multiple ? <em>multi</em> : null}
                        </div>
                      );
                  })}
                  {def.outputs.map((port, i) => {
                    const isSource =
                      link?.fromNode === node.id &&
                      link.fromPort === port.id &&
                      link.fromSide === 'out';
                    const compatible = Boolean(link && link.fromSide === 'in' && link.type === port.type);
                    const incompatible = Boolean(link && !compatible && !isSource);
                    return (
                      <div
                        key={port.id}
                        className={`node-port node-port-out ${
                          compatible ? 'is-compatible' : incompatible ? 'is-incompatible' : ''
                        } ${isSource ? 'is-source' : ''}`}
                        style={{ top: PORT_START + i * PORT_STEP }}
                        data-port-out-row="true"
                        data-node-id={node.id}
                        data-port-id={port.id}
                        data-port-type={port.type}
                        title={`${port.label} (${port.type}) — drop a connection here`}
                        onPointerUp={() => finishLink(node.id, port.id, port.type, 'out')}
                      >
                        <span>{port.label}</span>
                        <button
                          type="button"
                          className={`port-dot port-${port.type}`}
                          title={`Drag from ${port.label} (${port.type}) to an input port`}
                          onPointerDown={(e) => {
                            if (linkRef.current) return;
                            startLink(node, port.id, port.type, e, 'out');
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {pinned.length > 0 ? (
                  <div className="node-pins">
                    {pinned.map(({ path, label }) => {
                      const raw = getPath(node.params, path);
                      return (
                        <div className="node-pin-row" key={path}>
                          <span>{label}</span>
                          <input
                            type="number"
                            value={Number.isFinite(Number(raw)) ? Number(raw) : 0}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n)) {
                                updateNodeParams(node.id, setPath(node.params, path, n) as Record<string, unknown>);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="node-footer">
                  <span>{summaryFor(node, assets.length)}</span>
                  {node.bypassed ? <em className="bypass-tag">bypassed</em> : null}
                </div>

                {showPreview && previewSrc ? (
                  <div className="node-preview">
                    <img src={previewSrc} alt={`${node.title} preview`} draggable={false} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="graph-hint">
          <Icon name="graph" size={14} />
          Click nodes to multi-select · Ctrl/Cmd-click to select one · drag a title bar to move ·
          drop a node on a wire to insert it · wheel to zoom · hover a wire to cut it · Shift-drag detaches · Shift+Space node search ·{' '}
          <span className="hint-warning">!</span> marks CPU-bound nodes
          {mode === 'graph' ? ' · click nodes to preview that stage' : ''}
        </div>
      </div>
    </div>
  );
}
