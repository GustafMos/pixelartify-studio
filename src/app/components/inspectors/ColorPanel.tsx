import React from 'react';
import type { ColorCorrectionSettings, GraphNode } from '../../../core/types';
import { COLOR_CORRECTION_PARAMS, DEFAULT_COLOR_CORRECTION } from '../../../core/preprocess';
import { useStudio } from '../../store';
import { Section, Badge } from '../controls';
import { Field } from '../Field';
import { Icon } from '../icons';

const PRESETS: Array<{ name: string; values: Partial<ColorCorrectionSettings> }> = [
  { name: 'Neutral', values: { ...DEFAULT_COLOR_CORRECTION } },
  { name: 'Punch', values: { contrast: 1.18, saturation: 1.22, gamma: 0.98 } },
  { name: 'Warm', values: { temperature: 0.35, tint: 0.04, saturation: 1.08 } },
  { name: 'Cool', values: { temperature: -0.34, tint: -0.03, contrast: 1.04 } },
  { name: 'Fade', values: { contrast: 0.84, brightness: 0.035, saturation: 0.78 } },
  { name: 'B&W', values: { saturation: 0 } },
];

export function ColorPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const color: ColorCorrectionSettings = {
    ...DEFAULT_COLOR_CORRECTION,
    ...((node.params.color as Partial<ColorCorrectionSettings> | undefined) ?? {}),
  };

  const set = (patch: Partial<ColorCorrectionSettings>): void =>
    updateNodeParams(node.id, { color: { ...color, ...patch } });

  return (
    <div className="inspector-panel">
      <div className="art-size-card color-summary-card">
        <div>
          <span>Exposure</span>
          <strong>{color.exposure.toFixed(2)} EV</strong>
        </div>
        <div>
          <span>Contrast</span>
          <strong>{color.contrast.toFixed(2)}</strong>
        </div>
        <div>
          <span>Saturation</span>
          <strong>{color.saturation.toFixed(2)}</strong>
        </div>
        <Badge tone="warn">alpha retained</Badge>
      </div>

      <Section title="Looks">
        <div className="color-preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="ghost-btn small"
              onClick={() => set(preset.values)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Adjustments">
        {COLOR_CORRECTION_PARAMS.map((param) => (
          <Field
            key={param.key}
            node={node}
            path={`color.${param.key}`}
            label={param.label}
            min={param.min}
            max={param.max}
            step={param.step}
            unit={param.unit}
            defaultValue={param.default}
          />
        ))}
        <button
          type="button"
          className="ghost-btn small"
          onClick={() => set({ ...DEFAULT_COLOR_CORRECTION })}
        >
          <Icon name="refresh" size={14} /> Reset correction
        </button>
      </Section>

      <div className="info-callout">
        <Icon name="sliders" size={16} />
        <span>
          Color correction runs before pixelation and palette matching. It preserves alpha and is
          resolution independent. Place several Color Correct nodes for an ordered grade.
        </span>
      </div>
    </div>
  );
}
