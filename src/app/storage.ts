import type { GraphEdge, GraphNode, GraphNodeType, PaletteDefinition, PipelineGraph, Preset } from '../core/types';
import { parsePreset } from '../core/presets';

const PREFIX = 'pixelartify.studio.v1';

function key(name: string): string {
  return `${PREFIX}.${name}`;
}

export function loadJSON<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(name: string, value: unknown): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Storage may be full or disabled; the app still works in-session.
  }
}

export function loadGraph(): PipelineGraph | null {
  const graph = loadJSON<PipelineGraph | null>('graph', null);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  return graph;
}

export function saveGraph(graph: PipelineGraph): void {
  saveJSON('graph', graph);
}

export function loadRecentNodes(): GraphNodeType[] {
  const raw = loadJSON<unknown[]>('recentNodes', []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is GraphNodeType => typeof v === 'string').slice(0, 8);
}

export function saveRecentNodes(nodes: GraphNodeType[]): void {
  saveJSON('recentNodes', nodes.slice(0, 8));
}

export function loadUserPresets(): Preset[] {
  const raw = loadJSON<unknown[]>('presets', []);
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  for (const item of raw) {
    try {
      out.push(parsePreset(JSON.stringify(item)));
    } catch {
      // Skip malformed entries.
    }
  }
  return out;
}

export function saveUserPresets(presets: Preset[]): void {
  saveJSON(
    'presets',
    presets.map((p) => ({
      ...p,
      thumbnail: p.thumbnail && p.thumbnail.length < 80_000 ? p.thumbnail : undefined,
    })),
  );
}

export function loadUserPalettes(): PaletteDefinition[] {
  const raw = loadJSON<unknown[]>('palettes', []);
  if (!Array.isArray(raw)) return [];
  const out: PaletteDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<PaletteDefinition>;
    if (!Array.isArray(obj.colors)) continue;
    out.push({
      id: typeof obj.id === 'string' ? obj.id : `palette-${Math.random().toString(36).slice(2, 8)}`,
      name: typeof obj.name === 'string' ? obj.name : 'Palette',
      colors: obj.colors.filter((c): c is string => typeof c === 'string'),
      source: 'custom',
      description: typeof obj.description === 'string' ? obj.description : undefined,
      author: typeof obj.author === 'string' ? obj.author : undefined,
    });
  }
  return out;
}

export function saveUserPalettes(palettes: PaletteDefinition[]): void {
  saveJSON(
    'palettes',
    palettes.filter((p) => p.source !== 'builtin'),
  );
}

export function loadActivePaletteId(): string | null {
  return loadJSON<string | null>('activePalette', null);
}

export function saveActivePaletteId(id: string | null): void {
  saveJSON('activePalette', id);
}

export type UiMode = 'studio' | 'split' | 'graph';

export function loadUiMode(): UiMode {
  const mode = loadJSON<UiMode>('mode', 'split');
  return mode === 'graph' || mode === 'studio' || mode === 'split' ? mode : 'split';
}

export function saveUiMode(mode: UiMode): void {
  saveJSON('mode', mode);
}

export type ColorSpaceOption = 'srgb' | 'display-p3';

export function loadColorSpace(): ColorSpaceOption {
  const cs = loadJSON<ColorSpaceOption>('colorSpace', 'srgb');
  return cs === 'display-p3' ? 'display-p3' : 'srgb';
}

export function saveColorSpace(colorSpace: ColorSpaceOption): void {
  saveJSON('colorSpace', colorSpace);
}

/** A reusable group of nodes saved by the user. */
export interface Subgraph {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function loadSubgraphs(): Subgraph[] {
  const raw = loadJSON<unknown[]>('subgraphs', []);
  if (!Array.isArray(raw)) return [];
  const out: Subgraph[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<Subgraph>;
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) continue;
    out.push({
      id: typeof obj.id === 'string' ? obj.id : `subgraph-${Math.random().toString(36).slice(2, 8)}`,
      name: typeof obj.name === 'string' ? obj.name : 'Subgraph',
      nodes: obj.nodes as GraphNode[],
      edges: obj.edges as GraphEdge[],
    });
  }
  return out;
}

export function saveSubgraphs(subgraphs: Subgraph[]): void {
  saveJSON('subgraphs', subgraphs);
}

