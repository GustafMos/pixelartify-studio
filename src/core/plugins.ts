/**
 * Plugin registry for user-defined nodes.
 *
 * A plugin is a self-contained pixel filter: it receives an RGBA image plus a
 * set of numeric parameters and returns a new RGBA image. Plugins are loaded at
 * runtime from `.js` modules (default export) and expose a generated inspector
 * from their parameter metadata.
 */

import type { PixelImage } from './types';

export interface PluginParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface PluginNodeDef {
  id: string;
  name: string;
  description: string;
  params: PluginParamDef[];
  apply: (image: PixelImage, params: Record<string, number>) => PixelImage;
}

const registry = new Map<string, PluginNodeDef>();

export function registerPluginNode(def: PluginNodeDef): void {
  if (def && def.id && typeof def.apply === 'function') {
    registry.set(def.id, def);
  }
}

export function unregisterPluginNode(id: string): void {
  registry.delete(id);
}

export function getPluginNode(id: string): PluginNodeDef | undefined {
  return registry.get(id);
}

export function listPluginNodes(): PluginNodeDef[] {
  return [...registry.values()];
}

/** Default parameter values for a plugin's param metadata. */
export function pluginDefaults(def: PluginNodeDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}
