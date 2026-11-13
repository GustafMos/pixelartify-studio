import React from 'react';
import type { GraphNode } from '../../core/types';
import { DEFAULT_REGION } from '../../core/region';
import { useStudio } from '../store';
import { Field } from './Field';
import { Section, SelectField, Toggle } from './controls';

/**
 * Fusion-style region/bounds editor. Restricts a node's effect to a rectangle
 * or ellipse (optionally feathered/inverted). Connect a Mask input to refine it.
 */
export function RegionEditor({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const region = { ...DEFAULT_REGION, ...((node.params.region as Record<string, unknown>) ?? {}) };
  const set = (patch: Record<string, unknown>): void =>
    updateNodeParams(node.id, { region: { ...region, ...patch } });
  return (
    <Section
      title="Region (bounds)"
      subtitle="Restrict the effect to part of the image. Connect a Mask input to refine it further."
    >
      <Toggle label="Restrict to region" checked={region.enabled} onChange={(enabled) => set({ enabled })} />
      {region.enabled ? (
        <>
          <div className="two-col">
            <Field node={node} path="region.x" label="X" min={0} max={1} step={0.01} defaultValue={0} />
            <Field node={node} path="region.y" label="Y" min={0} max={1} step={0.01} defaultValue={0} />
          </div>
          <div className="two-col">
            <Field node={node} path="region.width" label="Width" min={0.01} max={1} step={0.01} defaultValue={1} />
            <Field node={node} path="region.height" label="Height" min={0.01} max={1} step={0.01} defaultValue={1} />
          </div>
          <div className="two-col">
            <SelectField
              label="Shape"
              value={region.shape}
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'ellipse', label: 'Ellipse' },
              ]}
              onChange={(shape) => set({ shape })}
            />
            <Field node={node} path="region.feather" label="Feather" min={0} max={1} step={0.01} defaultValue={0} />
          </div>
          <Toggle label="Invert region" checked={region.invert} onChange={(invert) => set({ invert })} />
        </>
      ) : null}
    </Section>
  );
}
