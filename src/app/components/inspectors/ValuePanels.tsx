import React from 'react';
import type { GraphNode } from '../../../core/types';
import {
  DEFAULT_MATH,
  MATH_OPERATIONS,
  type MathParams,
} from '../../../core/value';
import { DEFAULT_TRANSFORM, type TransformParams } from '../../../core/transform';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import { Field } from '../Field';
import {
  Badge,
  ColorField,
  NumberField,
  Section,
  SelectField,
  TextField,
} from '../controls';

export function ConstantPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const value = Number(node.params.value ?? 0);
  return (
    <div className="inspector-panel">
      <Section title="Constant" subtitle="A scalar value you can route into any driven field or a Math node.">
        <NumberField
          label="Value"
          value={value}
          step={0.1}
          onChange={(v) => updateNodeParams(node.id, { value: v })}
        />
      </Section>
      <div className="info-callout">
        <Icon name="hash" size={16} />
        <span>
          Click the <Icon name="link" size={11} /> on another node's field and connect this Value
          output, or feed it into a Math node to combine several values.
        </span>
      </div>
    </div>
  );
}

export function MathPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const p: MathParams = { ...DEFAULT_MATH, ...(node.params as Partial<MathParams>) };
  const set = (patch: Partial<MathParams>): void => updateNodeParams(node.id, patch);
  return (
    <div className="inspector-panel">
      <Section title="Math" subtitle="Combine its value inputs with a fixed operation.">
        <SelectField
          label="Operation"
          value={p.operation}
          options={MATH_OPERATIONS}
          onChange={(operation) => set({ operation })}
        />
        {p.operation === 'clamp' ? (
          <div className="two-col">
            <Field node={node} path="min" label="Min" min={-10000} max={10000} step={0.1} defaultValue={0} />
            <Field node={node} path="max" label="Max" min={-10000} max={10000} step={0.1} defaultValue={1} />
          </div>
        ) : (
          <Field node={node} path="operand" label="Operand" min={-10000} max={10000} step={0.1} defaultValue={1} hint="Used for binary operations or a lone input." />
        )}
      </Section>
      <div className="info-callout">
        <Icon name="func" size={16} />
        <span>
          Connect Constant nodes (or other driven fields) to the Inputs port. The operation folds
          them left-to-right; the last input acts as the mix amount for Lerp.
        </span>
      </div>
    </div>
  );
}

export function TextPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const p = node.params as Record<string, unknown>;
  const set = (patch: Record<string, unknown>): void => updateNodeParams(node.id, patch);
  return (
    <div className="inspector-panel">
      <Section title="Text" subtitle="Render text over the media, or standalone when left unconnected.">
        <TextField label="Text" value={String(p.text ?? '')} onChange={(text) => set({ text })} />
        <ColorField label="Colour" value={String(p.color ?? '#ffffff')} onChange={(color) => set({ color })} />
        <div className="two-col">
          <Field node={node} path="size" label="Size" min={4} max={512} step={1} defaultValue={48} unit="px" />
          <Field node={node} path="outline" label="Outline" min={0} max={32} step={1} defaultValue={0} unit="px" />
        </div>
        <div className="two-col">
          <Field node={node} path="x" label="X" min={0} max={1} step={0.01} defaultValue={0.5} />
          <Field node={node} path="y" label="Y" min={0} max={1} step={0.01} defaultValue={0.5} />
        </div>
        <Field node={node} path="alpha" label="Opacity" min={0} max={1} step={0.01} defaultValue={1} />
        <div className="two-col">
          <SelectField
            label="Font"
            value={String(p.font ?? 'monospace')}
            options={[
              { value: 'monospace', label: 'Monospace' },
              { value: 'sans', label: 'Sans' },
              { value: 'serif', label: 'Serif' },
            ]}
            onChange={(font) => set({ font })}
          />
          <SelectField
            label="Align"
            value={String(p.align ?? 'center')}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(align) => set({ align })}
          />
        </div>
      </Section>
    </div>
  );
}

export function TransformPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const p: TransformParams = { ...DEFAULT_TRANSFORM, ...(node.params as Partial<TransformParams>) };
  return (
    <div className="inspector-panel">
      <Section title="Transform" subtitle="Translate, rotate, scale and shear the incoming media.">
        <div className="two-col">
          <Field node={node} path="x" label="Move X" min={-4096} max={4096} step={1} defaultValue={0} unit={p.unit === 'normalized' ? '×w' : 'px'} />
          <Field node={node} path="y" label="Move Y" min={-4096} max={4096} step={1} defaultValue={0} unit={p.unit === 'normalized' ? '×h' : 'px'} />
        </div>
        <Field node={node} path="rotation" label="Rotate" min={-180} max={180} step={1} defaultValue={0} unit="°" />
        <div className="two-col">
          <Field node={node} path="scaleX" label="Scale X" min={0.01} max={8} step={0.01} defaultValue={1} />
          <Field node={node} path="scaleY" label="Scale Y" min={0.01} max={8} step={0.01} defaultValue={1} />
        </div>
        <div className="two-col">
          <Field node={node} path="shearX" label="Shear X" min={-2} max={2} step={0.01} defaultValue={0} />
          <Field node={node} path="shearY" label="Shear Y" min={-2} max={2} step={0.01} defaultValue={0} />
        </div>
        <div className="two-col">
          <Field node={node} path="pivotX" label="Pivot X" min={0} max={1} step={0.01} defaultValue={0.5} />
          <Field node={node} path="pivotY" label="Pivot Y" min={0} max={1} step={0.01} defaultValue={0.5} />
        </div>
        <SelectField
          label="Move units"
          value={p.unit}
          options={[
            { value: 'art', label: 'Art pixels' },
            { value: 'normalized', label: 'Frame units (0–1)' },
          ]}
          onChange={(unit) => updateNodeParams(node.id, { unit })}
        />
      </Section>
      <div className="info-callout">
        <Icon name="move" size={16} />
        <span>
          With this node selected, drag the on-canvas rectangle to move, corner handles to scale,
          and drag outside the box to rotate. Use the value pin to expose a field on the node.
        </span>
      </div>
    </div>
  );
}
