import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_DEFS } from '../../core/graph';
import type { GraphNode, GraphNodeType } from '../../core/types';
import { DITHER_BY_ID } from '../../core/dither';
import { pixelImageToDataUrl } from '../io';
import { useStudio } from '../store';
import { Icon, type IconName } from './icons';
import { IconButton } from './controls';

const NODE_WIDTH = 212;
const HEADER_H = 38;
const PORT_START = 16;
const PORT_STEP = 22;
const FOOTER_H = 38;
const PREVIEW_H = 72;

const TYPE_ICON: Record<GraphNodeType, IconName> = {
  input: 'image',
  crop: 'fit',
  resize: 'zoomIn',
  channels: 'layers',
  preprocess: 'wand',
  pixelate: 'grid',
  palette: 'palette',
  dither: 'sparkles',
  extract: 'eye',
  compose: 'layers',
  postprocess: 'settings',
  merge: 'link',
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
      return `${w || 'auto'} × ${h || 'auto'} · ${String(p.filter ?? 'lanczos3')}`;
    }
    case 'channels': {
      return `${String(p.operation ?? 'extract')} · ${String(p.channel ?? 'luma')}${p.keepAlpha ? ' · alpha' : ''}`;
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
      return `${e?.method ?? 'saliency'} · ${String(p.maskId ?? 'subject')}`;
    }
    case 'compose': {
      const layers = Array.isArray(p.layers) ? p.layers : [];
      return `${layers.length} layer${layers.length === 1 ? '' : 's'}`;
    }
    case 'postprocess': {
      const post = p.postprocess as { ops?: unknown[] } | undefined;
      return `${post?.ops?.length ?? 0} effect${(post?.ops?.length ?? 0) === 1 ? '' : 's'}`;
    }
    case 'merge':
      return 'concatenate batches';
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
}

interface LinkState {
  fromNode: string;
  fromPort: string;
  type: string;
  x: number;
  y: number;
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
    addEdge,
    deleteEdge,
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
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const userMovedRef = useRef(false);

  const effectivePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of graph.nodes) {
      if (drag && drag.id === node.id) {
        map.set(node.id, { x: drag.origX + drag.dx, y: drag.origY + drag.dy });
      } else {
        map.set(node.id, { x: node.x, y: node.y });
      }
    }
    return map;
  }, [graph.nodes, drag]);

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
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              dx: (e.clientX - prev.startClientX) / view.zoom,
              dy: (e.clientY - prev.startClientY) / view.zoom,
              moved: prev.moved || Math.abs(e.clientX - prev.startClientX) + Math.abs(e.clientY - prev.startClientY) > 3,
            }
          : prev,
      );
    };
    const onUp = (): void => {
      setDrag((prev) => {
        if (prev && prev.moved) moveNode(prev.id, prev.origX + prev.dx, prev.origY + prev.dy);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, moveNode, view.zoom]);

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

  useEffect(() => {
    if (!link) return;
    const onMove = (e: PointerEvent): void => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setLink((prev) =>
        prev
          ? {
              ...prev,
              x: (e.clientX - rect.left - view.x) / view.zoom,
              y: (e.clientY - rect.top - view.y) / view.zoom,
            }
          : prev,
      );
    };
    const onUp = (): void => setLink(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [link, view]);

  const startLink = (node: GraphNode, port: string, type: string, e: React.PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    const pos = effectivePositions.get(node.id)!;
    const def = NODE_DEFS[node.type];
    const idx = def.outputs.findIndex((p) => p.id === port);
    setLink({
      fromNode: node.id,
      fromPort: port,
      type,
      x: pos.x + NODE_WIDTH,
      y: pos.y + HEADER_H + PORT_START + idx * PORT_STEP + 7,
    });
  };

  const completeLink = (node: GraphNode, port: string): void => {
    if (!link) return;
    addEdge(link.fromNode, link.fromPort, node.id, port);
    setLink(null);
  };

  const worldCenter = (): { x: number; y: number } => {
    const el = viewportRef.current;
    if (!el) return { x: 200, y: 200 };
    return {
      x: (el.clientWidth / 2 - view.x) / view.zoom - NODE_WIDTH / 2,
      y: (el.clientHeight / 2 - view.y) / view.zoom - 60,
    };
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
                      const c = worldCenter();
                      addNode(type, c.x, c.y);
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
              const fp = effectivePositions.get(from.id)!;
              const tp = effectivePositions.get(to.id)!;
              const fromDef = NODE_DEFS[from.type];
              const outIdx = fromDef.outputs.findIndex((p) => p.id === edge.fromPort);
              if (outIdx < 0) return null;
              const inIdx = NODE_DEFS[to.type].inputs.findIndex((p) => p.id === edge.toPort);
              if (inIdx < 0) return null;
              const outPort = fromDef.outputs[outIdx];
              const x1 = fp.x + NODE_WIDTH;
              const y1 = fp.y + HEADER_H + PORT_START + outIdx * PORT_STEP + 7;
              const x2 = tp.x;
              const y2 = tp.y + HEADER_H + PORT_START + inIdx * PORT_STEP + 7;
              const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const color = edgeColor(outPort.type);
              return (
                <g key={edge.id} className="graph-edge">
                  <path d={d} className="edge-hit" onDoubleClick={() => deleteEdge(edge.id)}>
                    <title>Double-click to disconnect</title>
                  </path>
                  <path d={d} stroke={color} className="edge-line" />
                  <circle cx={x2} cy={y2} r="3.5" fill={color} />
                </g>
              );
            })}
            {link ? (
              <path
                d={`M ${effectivePositions.get(link.fromNode)!.x + NODE_WIDTH} ${
                  effectivePositions.get(link.fromNode)!.y + HEADER_H + PORT_START + 7 +
                  Math.max(0, NODE_DEFS[graph.nodes.find((n) => n.id === link.fromNode)!.type].outputs.findIndex((p) => p.id === link.fromPort)) * PORT_STEP
                } C ${link.x} ${link.y}, ${link.x} ${link.y}, ${link.x} ${link.y}`}
                stroke={edgeColor(link.type)}
                className="edge-line edge-temp"
              />
            ) : null}
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
                className={`graph-node ${selected ? 'is-selected' : ''} ${node.bypassed ? 'is-bypassed' : ''}`}
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
                    setDrag({
                      id: node.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                      dx: 0,
                      dy: 0,
                      moved: false,
                    });
                  }}
                >
                  <span className="node-icon" style={{ color: def.accent }}>
                    <Icon name={TYPE_ICON[node.type]} size={15} />
                  </span>
                  <span className="node-title">{node.title}</span>
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
                  {def.inputs.map((port, i) => (
                    <div
                      key={port.id}
                      className="node-port node-port-in"
                      style={{ top: PORT_START + i * PORT_STEP }}
                    >
                      <button
                        type="button"
                        className={`port-dot port-${port.type}`}
                        title={`${port.label} (${port.type})`}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          completeLink(node, port.id);
                        }}
                        data-port-type={port.type}
                      />
                      <span>{port.label}</span>
                      {port.multiple ? <em>multi</em> : null}
                    </div>
                  ))}
                  {def.outputs.map((port, i) => (
                    <div
                      key={port.id}
                      className="node-port node-port-out"
                      style={{ top: PORT_START + i * PORT_STEP }}
                    >
                      <span>{port.label}</span>
                      <button
                        type="button"
                        className={`port-dot port-${port.type}`}
                        title={`${port.label} (${port.type})`}
                        onPointerDown={(e) => startLink(node, port.id, port.type, e)}
                      />
                    </div>
                  ))}
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
          Drag nodes · drag ports to connect · wheel to zoom · double-click a wire to cut
          {mode === 'graph' ? ' · click nodes to preview that stage' : ''}
        </div>
      </div>
    </div>
  );
}
