import React from 'react';
import type { GraphNode } from '../../core/types';
import { getPath, setPath } from '../../core/value';
import { useStudio } from '../store';
import { NumberField, Slider } from './controls';

/**
 * Wires a single numeric field (identified by a dotted `path` into node.params)
 * to its value, pin state and drive state. Returns everything a control needs
 * to render with an editable input, a reset button, a pinhead and a "drive
 * from another node" toggle.
 */
export function useField(node: GraphNode, path: string, defaultValue?: number) {
  const { updateNodeParams, togglePin, toggleDrive } = useStudio();
  const raw = getPath(node.params, path);
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  const pins = (node.params.pins as Record<string, boolean> | undefined) ?? {};
  const drivers = (node.params.drivers as Record<string, string> | undefined) ?? {};
  const pinned = Boolean(pins[path]);
  const driven = Boolean(drivers[path]);
  const set = (v: number): void =>
    updateNodeParams(node.id, setPath(node.params, path, v) as Record<string, unknown>);
  return {
    value,
    pinned,
    driven,
    set,
    defaultValue,
    reset: defaultValue !== undefined ? (): void => set(defaultValue) : undefined,
    togglePin: (): void => togglePin(node.id, path),
    toggleDrive: (): void => toggleDrive(node.id, path, value),
  };
}

export function Field({
  node,
  path,
  label,
  min,
  max,
  step = 1,
  unit,
  hint,
  defaultValue,
  kind = 'slider',
  format,
}: {
  node: GraphNode;
  path: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  defaultValue?: number;
  kind?: 'slider' | 'number';
  format?: (value: number) => string;
}): React.ReactElement {
  const f = useField(node, path, defaultValue);
  const shared = {
    label,
    value: f.value,
    min,
    max,
    step,
    onChange: f.set,
    unit,
    hint,
    defaultValue,
    pinned: f.pinned,
    driven: f.driven,
    onTogglePin: f.togglePin,
    onToggleDrive: f.toggleDrive,
    format,
  };
  return kind === 'number' ? <NumberField {...shared} /> : <Slider {...shared} />;
}
