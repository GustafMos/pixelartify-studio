import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_DEFS } from '../../core/graph';
import type { GraphEdge, GraphNode, GraphNodeType } from '../../core/types';
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
  postprocess: 'settings',
  merge: 'link',
  router: 'link',
  output: 'download',
};

function nodeHeight(node: GraphNode, showPreview: boolean): number {
  const def = NODE_DEFS[node.type];
  const ports = Math.max(def.inputs.length, def.outputs.length);
  return HEADER_H + 16 + ports * PORT_STEP + FOOTER_H + (showPreview ? PREVIEW_H : 0);
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
    case 'postprocess': {
      const post = p.postprocess as { ops?: unknown[] } | undefined;
      return `${post?.ops?.length ?? 0} effect${(post?.ops?.length ?? 0) === 1 ? '' : 's'}`;
    }
    case 'merge':
      return 'concatenate batches';
    case 'router':
      return 'pass-through reroute';
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
    duplicateNode,
    deleteNode,
    updateNode,
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

  const effectivePositions = useMemo(() => {    const map = new Map<string, { x: number; y: number }>();
    for (const node of graph.nodes) {
      if (drag && drag.id === node.id) {
        map.set(node.id, { x: drag.origX + drag.dx, y: drag.origY + drag.dy });
      } else {
        map.set(node.id, { x: node.x, y: node.y });
      }
    }
    return map;
  }, [graph.nodes, drag]);

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
          if (prev.detach) {
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
  }, [drag, findInsertEdge, insertNodeOnEdge, moveNode, moveNodeDetached, detachNodeWithBridge, view.zoom]);

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
  ): void => {
    e.stopPropagation();
    e.preventDefault();
    if (linkRef.current) return;
    const pos = effectivePositions.get(node.id)!;
    const def = NODE_DEFS[node.type];
    const ports = side === 'out' ? def.outputs : def.inputs;
    const idx = ports.findIndex((p) => p.id === port);
    setLinkState({
      fromNode: node.id,
      fromPort: port,
      fromSide: side,
      type,
      x: side === 'out' ? pos.x + NODE_WIDTH - PORT_DOT_INSET : pos.x + PORT_DOT_INSET,
      y: pos.y + HEADER_H + PORT_START + Math.max(0, idx) * PORT_STEP + PORT_ROW_CENTER,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pending: false,
    });
  };

  const filteredTypes = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return (Object.keys(NODE_DEFS) as GraphNodeType[]).filter((t) => {
      const d = NODE_DEFS[t];
      return !q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || t.includes(q);
    });
  }, [addSearch]);

  const edgeColor = (type: string): string =>
    type === 'mask' ? '#06d6a0' : type === 'palette' ? '#e879f9' : '#4cc9f0';

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
          <IconButton icon="fit" label="Fit graph" onClick={fitView} />
          <div className="zoom-readout">{Math.round(view.zoom * 100)}%</div>
        </div>
        {addOpen ? (
          <div className="add-node-popover" onMouseLeave={() => setAddOpen(false)}>
            <div className="add-node-search">
              <Icon name="search" size={14} />
              <input
                autoFocus
                placeholder="Search nodes…"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
              />
            </div>
            <div className="add-node-list">
              {filteredTypes.map((type) => {
                const def = NODE_DEFS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="add-node-item"
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
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className={`graph-viewport ${pan ? 'is-panning' : ''} ${link ? 'is-linking' : ''}`}
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
              const fp = effectivePositions.get(from.id)!;
              const tp = effectivePositions.get(to.id)!;
              const fromDef = NODE_DEFS[from.type];
              const outIdx = fromDef.outputs.findIndex((p) => p.id === edge.fromPort);
              if (outIdx < 0) return null;
              const inIdx = NODE_DEFS[to.type].inputs.findIndex((p) => p.id === edge.toPort);
              if (inIdx < 0) return null;
              const outPort = fromDef.outputs[outIdx];
              const x1 = fp.x + NODE_WIDTH - PORT_DOT_INSET;
              const y1 = fp.y + HEADER_H + PORT_START + outIdx * PORT_STEP + PORT_ROW_CENTER;
              const x2 = tp.x + PORT_DOT_INSET;
              const y2 = tp.y + HEADER_H + PORT_START + inIdx * PORT_STEP + PORT_ROW_CENTER;
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
                  const linkNode = graph.nodes.find((n) => n.id === link.fromNode);
                  if (!linkNode) return null;
                  const linkDef = NODE_DEFS[linkNode.type];
                  const ports = link.fromSide === 'out' ? linkDef.outputs : linkDef.inputs;
                  const idx = Math.max(0, ports.findIndex((p) => p.id === link.fromPort));
                  const pos = effectivePositions.get(link.fromNode)!;
                  const sx = link.fromSide === 'out' ? pos.x + NODE_WIDTH - PORT_DOT_INSET : pos.x + PORT_DOT_INSET;
                  const sy = pos.y + HEADER_H + PORT_START + PORT_ROW_CENTER + idx * PORT_STEP;
                  return (
                    <path
                      d={`M ${sx} ${sy} C ${link.x} ${link.y}, ${link.x} ${link.y}, ${link.x} ${link.y}`}
                      stroke={edgeColor(link.type)}
                      className="edge-line edge-temp"
                    />
                  );
                })()
              : null}
          </svg>

          {graph.nodes.map((node) => {
            const def = NODE_DEFS[node.type];
            const pos = effectivePositions.get(node.id)!;
            const showPreview = node.id === previewNodeId;
            const height = nodeHeight(node, showPreview);
            const selected = node.id === selectedNodeId;
            const portCount = Math.max(def.inputs.length, def.outputs.length);
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
                  selectNode(node.id);
                }}
              >
                <div
                  className="node-head"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if ((e.target as HTMLElement).closest('button')) return;
                    selectNode(node.id);
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
                  {def.inputs.map((port, i) => {
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
          Drag nodes · drop a node on a wire to insert it · drag an output to any input row (or click
          output, then input) · wheel to zoom · hover a wire to cut it · Shift-drag detaches · Shift+Space node search ·{' '}
          <span className="hint-warning">!</span> marks CPU-bound nodes
          {mode === 'graph' ? ' · click nodes to preview that stage' : ''}
        </div>
      </div>
    </div>
  );
}
