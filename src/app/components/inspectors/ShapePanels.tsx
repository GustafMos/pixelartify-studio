import React from 'react';
import type { GraphNode } from '../../../core/types';
import { DEFAULT_SHAPE2D, SHAPE2D_TYPES, SHAPE2D_FILLS, type Shape2DParams } from '../../../core/shape2d';
import { DEFAULT_PARTICLES, PARTICLE_PRESETS, PARTICLE_SHAPES, type ParticleParams } from '../../../core/particles';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import { Field } from '../Field';
import { ColorField, NumberField, Section, SelectField } from '../controls';

function useHasMediaInput(node: GraphNode): boolean {
  const { graph } = useStudio();
  return graph.edges.some((edge) => edge.toNode === node.id && edge.toPort === 'media');
}

export function Shape2DPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const connected = useHasMediaInput(node);
  const p: Shape2DParams = { ...DEFAULT_SHAPE2D, ...(node.params as Partial<Shape2DParams>) };
  const set = (patch: Partial<Shape2DParams>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section title="Shape" subtitle={connected ? 'Composited over the connected media.' : 'Standalone generated shape.'}>
        <SelectField label="Shape" value={p.shape} options={SHAPE2D_TYPES} onChange={(shape) => set({ shape })} />
        <SelectField label="Fill" value={p.fill} options={SHAPE2D_FILLS} onChange={(fill) => set({ fill })} />
        <ColorField label="Colour A" value={p.colorA} onChange={(colorA) => set({ colorA })} />
        {p.fill !== 'solid' ? <ColorField label="Colour B" value={p.colorB} onChange={(colorB) => set({ colorB })} /> : null}
        {p.fill === 'linear' ? (
          <Field node={node} path="gradientAngle" label="Gradient angle" min={-180} max={180} step={1} unit="°" defaultValue={DEFAULT_SHAPE2D.gradientAngle} />
        ) : null}
        {(p.shape === 'polygon' || p.shape === 'star') ? (
          <Field node={node} path="sides" label={p.shape === 'star' ? 'Points' : 'Sides'} min={3} max={24} step={1} defaultValue={DEFAULT_SHAPE2D.sides} />
        ) : null}
        {p.shape === 'star' ? (
          <Field node={node} path="innerRatio" label="Inner radius" min={0.2} max={0.95} step={0.01} defaultValue={DEFAULT_SHAPE2D.innerRatio} />
        ) : null}
        {p.shape === 'line' ? (
          <Field node={node} path="lineWidth" label="Line width" min={1} max={64} step={1} unit="px" defaultValue={DEFAULT_SHAPE2D.lineWidth} />
        ) : null}
        <Field node={node} path="strokeWidth" label="Outline width" min={0} max={32} step={1} unit="px" defaultValue={DEFAULT_SHAPE2D.strokeWidth} />
        {p.strokeWidth > 0 ? <ColorField label="Outline colour" value={p.strokeColor} onChange={(strokeColor) => set({ strokeColor })} /> : null}
        <div className="two-col">
          <Field node={node} path="positionX" label="Position X" min={-1} max={1} step={0.01} defaultValue={DEFAULT_SHAPE2D.positionX} />
          <Field node={node} path="positionY" label="Position Y" min={-1} max={1} step={0.01} defaultValue={DEFAULT_SHAPE2D.positionY} />
        </div>
        <div className="two-col">
          <Field node={node} path="rotation" label="Rotation" min={-180} max={180} step={1} unit="°" defaultValue={DEFAULT_SHAPE2D.rotation} />
          <Field node={node} path="scale" label="Scale" min={0.05} max={3} step={0.01} defaultValue={DEFAULT_SHAPE2D.scale} />
        </div>
        {!connected ? (
          <div className="two-col">
            <Field node={node} path="width" label="Width" min={16} max={2048} step={1} unit="px" kind="number" defaultValue={DEFAULT_SHAPE2D.width} />
            <Field node={node} path="height" label="Height" min={16} max={2048} step={1} unit="px" kind="number" defaultValue={DEFAULT_SHAPE2D.height} />
          </div>
        ) : null}
        <button type="button" className="ghost-btn small" onClick={() => updateNodeParams(node.id, { ...DEFAULT_SHAPE2D })}>
          <Icon name="refresh" size={14} /> Reset shape
        </button>
      </Section>
    </div>
  );
}

export function ParticlesPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const connected = useHasMediaInput(node);
  const p: ParticleParams = { ...DEFAULT_PARTICLES, ...(node.params as Partial<ParticleParams>) };
  const set = (patch: Partial<ParticleParams>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section title="Particles" subtitle={connected ? 'Composited over the connected media.' : 'Standalone particle field.'}>
        <SelectField label="Preset" value={p.preset} options={PARTICLE_PRESETS} onChange={(preset) => set({ preset })} />
        <SelectField label="Shape" value={p.shape} options={PARTICLE_SHAPES} onChange={(shape) => set({ shape })} />
        <ColorField label="Colour A" value={p.colorA} onChange={(colorA) => set({ colorA })} />
        <ColorField label="Colour B" value={p.colorB} onChange={(colorB) => set({ colorB })} />
        <div className="two-col">
          <Field node={node} path="count" label="Count" min={1} max={400} step={1} kind="number" defaultValue={DEFAULT_PARTICLES.count} />
          <Field node={node} path="size" label="Size" min={0.5} max={24} step={0.5} unit="px" defaultValue={DEFAULT_PARTICLES.size} />
        </div>
        <div className="two-col">
          <Field node={node} path="speed" label="Speed" min={0} max={120} step={1} defaultValue={DEFAULT_PARTICLES.speed} />
          <Field node={node} path="direction" label="Direction" min={-180} max={180} step={1} unit="°" defaultValue={DEFAULT_PARTICLES.direction} />
        </div>
        <div className="two-col">
          <Field node={node} path="spread" label="Spread" min={0} max={180} step={1} unit="°" defaultValue={DEFAULT_PARTICLES.spread} />
          <Field node={node} path="opacity" label="Opacity" min={0} max={1} step={0.01} defaultValue={DEFAULT_PARTICLES.opacity} />
        </div>
        <Field node={node} path="seed" label="Seed" min={0} max={9999} step={1} kind="number" defaultValue={DEFAULT_PARTICLES.seed} />
        {!connected ? (
          <div className="two-col">
            <Field node={node} path="width" label="Width" min={16} max={2048} step={1} unit="px" kind="number" defaultValue={DEFAULT_PARTICLES.width} />
            <Field node={node} path="height" label="Height" min={16} max={2048} step={1} unit="px" kind="number" defaultValue={DEFAULT_PARTICLES.height} />
          </div>
        ) : null}
        <button type="button" className="ghost-btn small" onClick={() => updateNodeParams(node.id, { ...DEFAULT_PARTICLES })}>
          <Icon name="refresh" size={14} /> Reset particles
        </button>
      </Section>
      <div className="info-callout">
        <Icon name="sparkles" size={16} />
        <span>
          Particles are deterministic and animate over time. Add an <strong>Animate</strong> node or a
          <strong> Timeline</strong> to play/export the motion.
        </span>
      </div>
    </div>
  );
}
