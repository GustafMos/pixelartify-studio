import React from 'react';
import type { GraphNode, PixelateSettings, ResolutionSettings } from '../../../core/types';
import { DEFAULT_PIXELATE, computeArtSize, describeResolution, DEFAULT_RESOLUTION } from '../../../core';
import { useStudio } from '../../store';
import { Section, Segmented, SelectField, Slider, Toggle, NumberField, Badge } from '../controls';
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
        <Slider
          label={
            resolution.mode === 'block-size'
              ? 'Source pixels per art pixel'
              : resolution.mode === 'fixed-height'
                ? 'Art height'
                : resolution.mode === 'fixed-width'
                  ? 'Art width'
                  : 'Short side'
          }
          value={resolution.value}
          min={valueMin}
          max={valueMax}
          step={1}
          unit="px"
          onChange={(v) => setRes({ value: v })}
        />
        <Slider
          label="Export scale"
          value={resolution.exportScale}
          min={1}
          max={8}
          step={1}
          unit="×"
          onChange={(v) => setRes({ exportScale: v })}
        />
        <Toggle
          label="Even output dimensions"
          checked={resolution.snapEven}
          onChange={(v) => setRes({ snapEven: v })}
          hint="Recommended for H.264 video and many game engines."
        />
        <div className="two-col">
          <NumberField label="Min side" value={resolution.minSide} min={2} max={512} onChange={(v) => setRes({ minSide: v })} />
          <NumberField label="Max side" value={resolution.maxSide} min={64} max={4096} onChange={(v) => setRes({ maxSide: v })} />
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
        <Slider label="Edge alignment" value={pixelate.alignment} min={0} max={1} step={0.01} onChange={(v) => setPix({ alignment: v })} disabled={!pixelate.edgeAware} />
        <Slider label="Colour blend" value={pixelate.colorBlend} min={0} max={1} step={0.01} onChange={(v) => setPix({ colorBlend: v })} hint="0 = area average, 1 = dominant local colour." />
        <Slider label="Edge sensitivity" value={pixelate.edgeThreshold} min={0} max={1} step={0.01} onChange={(v) => setPix({ edgeThreshold: v })} disabled={!pixelate.edgeAware} />
        <Slider label="Smoothing passes" value={pixelate.gridPasses} min={0} max={4} step={1} onChange={(v) => setPix({ gridPasses: v })} disabled={!pixelate.edgeAware} />
        <Slider label="Pre-blur" value={pixelate.preBlur} min={0} max={3} step={0.05} unit="art px" onChange={(v) => setPix({ preBlur: v })} />
        <Slider label="Post sharpen" value={pixelate.postSharpen} min={0} max={1} step={0.01} onChange={(v) => setPix({ postSharpen: v })} />
        <p className="micro-copy">
          The sampler runs at a canonical supersampled resolution derived from the art size, so 480p and
          1080p sources share the same pixel grid and feature scale.
        </p>
      </Section>

      <Section title="Tone & colour" defaultOpen={false}>
        <Slider label="Contrast" value={pixelate.contrast} min={0.5} max={2} step={0.01} onChange={(v) => setPix({ contrast: v })} />
        <Slider label="Brightness" value={pixelate.brightness} min={-0.5} max={0.5} step={0.01} onChange={(v) => setPix({ brightness: v })} />
        <Slider label="Saturation" value={pixelate.saturation} min={0} max={2} step={0.01} onChange={(v) => setPix({ saturation: v })} />
        <Slider label="Gamma" value={pixelate.gamma} min={0.4} max={2.5} step={0.01} onChange={(v) => setPix({ gamma: v })} />
        <Slider label="Hue shift" value={pixelate.hueShift} min={-180} max={180} step={1} unit="°" onChange={(v) => setPix({ hueShift: v })} />
        <Slider label="Alpha threshold" value={pixelate.alphaThreshold} min={0} max={1} step={0.01} onChange={(v) => setPix({ alphaThreshold: v })} />
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
