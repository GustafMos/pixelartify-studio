import React from 'react';
import type { GraphNode, PixelateSettings, ResolutionSettings } from '../../../core/types';
import { DEFAULT_PIXELATE, computeArtSize, describeResolution, DEFAULT_RESOLUTION } from '../../../core';
import { useStudio } from '../../store';
import { Section, Segmented, SelectField, Toggle, Badge } from '../controls';
import { Field } from '../Field';
import { Icon } from '../icons';

const RESOLUTION_MODES = [
  { value: 'fixed-height', label: 'Fixed height' },
  { value: 'fixed-width', label: 'Fixed width' },
  { value: 'short-side', label: 'Short side' },
  { value: 'block-size', label: 'Block size' },
] as const;

export function PixelatePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { activeAsset, updateNodeParams, videoFrame } = useStudio();
  const resolution = (node.params.resolution as ResolutionSettings | undefined) ?? { ...DEFAULT_RESOLUTION };
  const pixelate = (node.params.pixelate as PixelateSettings | undefined) ?? { ...DEFAULT_PIXELATE };
  const sourceW = videoFrame?.width ?? activeAsset?.width ?? 1920;
  const sourceH = videoFrame?.height ?? activeAsset?.height ?? 1080;
  const art = computeArtSize(sourceW, sourceH, resolution);

  const setRes = (patch: Partial<ResolutionSettings>): void =>
    updateNodeParams(node.id, { resolution: { ...resolution, ...patch } });
  const setPix = (patch: Partial<PixelateSettings>): void =>
    updateNodeParams(node.id, { pixelate: { ...pixelate, ...patch } });

  const valueMax = resolution.mode === 'block-size' ? 32 : 1080;
  const valueMin = resolution.mode === 'block-size' ? 1 : 16;
  const valueLabel =
    resolution.mode === 'block-size'
      ? 'Source pixels per art pixel'
      : resolution.mode === 'fixed-height'
        ? 'Art height'
        : resolution.mode === 'fixed-width'
          ? 'Art width'
          : 'Short side';

  return (
    <div className="inspector-panel">
      <div className="art-size-card">
        <div>
          <span>Art size</span>
          <strong>
            {art.width} × {art.height}
          </strong>
        </div>
        <div>
          <span>Export</span>
          <strong>
            {art.exportWidth} × {art.exportHeight}
          </strong>
        </div>
        <div>
          <span>Scale</span>
          <strong>{art.pixelScale}×</strong>
        </div>
        <Badge tone="accent">resolution independent</Badge>
      </div>

      <Section title="Resolution policy" subtitle="Derived from the target art size, never the source dimensions.">
        <SelectField
          label="Mode"
          value={resolution.mode}
          options={RESOLUTION_MODES.map((m) => ({ value: m.value, label: m.label }))}
          onChange={(v) => setRes({ mode: v })}
        />
        <Field
          node={node}
          path="resolution.value"
          label={valueLabel}
          min={valueMin}
          max={valueMax}
          step={1}
          unit="px"
          defaultValue={270}
        />
        <Field node={node} path="resolution.exportScale" label="Export scale" min={1} max={8} step={1} unit="×" defaultValue={4} />
        <Toggle
          label="Even output dimensions"
          checked={resolution.snapEven}
          onChange={(v) => setRes({ snapEven: v })}
          hint="Recommended for H.264 video and many game engines."
        />
        <div className="two-col">
          <Field node={node} path="resolution.minSide" label="Min side" min={2} max={512} step={1} kind="number" defaultValue={2} />
          <Field node={node} path="resolution.maxSide" label="Max side" min={64} max={4096} step={1} kind="number" defaultValue={4096} />
        </div>
        <p className="micro-copy">{describeResolution(art)}</p>
      </Section>

      <Section title="Edge-aware sampler">
        <Toggle
          label="Edge-aware sampling"
          checked={pixelate.edgeAware}
          onChange={(v) => setPix({ edgeAware: v })}
          hint="Searches for sampling windows that avoid cutting through strong edges."
        />
        <Field node={node} path="pixelate.alignment" label="Edge alignment" min={0} max={1} step={0.01} defaultValue={DEFAULT_PIXELATE.alignment} />
        <Field node={node} path="pixelate.colorBlend" label="Colour blend" min={0} max={1} step={0.01} defaultValue={DEFAULT_PIXELATE.colorBlend} hint="0 = area average, 1 = dominant local colour." />
        <Field node={node} path="pixelate.edgeThreshold" label="Edge sensitivity" min={0} max={1} step={0.01} defaultValue={DEFAULT_PIXELATE.edgeThreshold} />
        <Field node={node} path="pixelate.gridPasses" label="Smoothing passes" min={0} max={4} step={1} defaultValue={DEFAULT_PIXELATE.gridPasses} />
        <Field node={node} path="pixelate.preBlur" label="Pre-blur" min={0} max={3} step={0.05} unit="art px" defaultValue={DEFAULT_PIXELATE.preBlur} />
        <Field node={node} path="pixelate.postSharpen" label="Post sharpen" min={0} max={1} step={0.01} defaultValue={DEFAULT_PIXELATE.postSharpen} />
        <p className="micro-copy">
          The sampler runs at a canonical supersampled resolution derived from the art size, so 480p and
          1080p sources share the same pixel grid and feature scale.
        </p>
      </Section>

      <Section title="Tone & colour" defaultOpen={false}>
        <Field node={node} path="pixelate.contrast" label="Contrast" min={0.5} max={2} step={0.01} defaultValue={DEFAULT_PIXELATE.contrast} />
        <Field node={node} path="pixelate.brightness" label="Brightness" min={-0.5} max={0.5} step={0.01} defaultValue={DEFAULT_PIXELATE.brightness} />
        <Field node={node} path="pixelate.saturation" label="Saturation" min={0} max={2} step={0.01} defaultValue={DEFAULT_PIXELATE.saturation} />
        <Field node={node} path="pixelate.gamma" label="Gamma" min={0.4} max={2.5} step={0.01} defaultValue={DEFAULT_PIXELATE.gamma} />
        <Field node={node} path="pixelate.hueShift" label="Hue shift" min={-180} max={180} step={1} unit="°" defaultValue={DEFAULT_PIXELATE.hueShift} />
        <Field node={node} path="pixelate.alphaThreshold" label="Alpha threshold" min={0} max={1} step={0.01} defaultValue={DEFAULT_PIXELATE.alphaThreshold} />
        <button
          type="button"
          className="ghost-btn small"
          onClick={() => {
            updateNodeParams(node.id, {
              pixelate: { ...DEFAULT_PIXELATE },
              resolution: { ...DEFAULT_RESOLUTION },
            });
          }}
        >
          <Icon name="refresh" size={14} /> Reset pixelate node
        </button>
      </Section>
    </div>
  );
}
