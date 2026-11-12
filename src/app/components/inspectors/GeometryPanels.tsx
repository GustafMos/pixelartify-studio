import React from 'react';
import type { GraphNode } from '../../../core/types';
import type { ChannelSettings, ChannelSource } from '../../../core/channels';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import { Section, SelectField, Slider, Toggle, NumberField, Badge } from '../controls';

export function CropPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { activeAsset, updateNodeParams } = useStudio();
  const p = node.params as { x: number; y: number; width: number; height: number; unit: string };
  const unit = (p.unit ?? 'normalized') as 'normalized' | 'percent' | 'pixels';
  const maxX = unit === 'normalized' ? 1 : unit === 'percent' ? 100 : Math.max(1, activeAsset?.width ?? 1000);
  const maxY = unit === 'normalized' ? 1 : unit === 'percent' ? 100 : Math.max(1, activeAsset?.height ?? 1000);
  const step = unit === 'pixels' ? 1 : unit === 'percent' ? 0.5 : 0.005;

  const set = (patch: Record<string, number | string>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section title="Crop region" subtitle="Masks and alpha are cropped with the source.">
        <SelectField
          label="Units"
          value={unit}
          options={[
            { value: 'normalized', label: 'Normalized (0–1)' },
            { value: 'percent', label: 'Percent (0–100)' },
            { value: 'pixels', label: 'Source pixels' },
          ]}
          onChange={(v) => set({ unit: v })}
        />
        <Slider label="X" value={p.x ?? 0} min={0} max={maxX} step={step} onChange={(v) => set({ x: v })} />
        <Slider label="Y" value={p.y ?? 0} min={0} max={maxY} step={step} onChange={(v) => set({ y: v })} />
        <Slider label="Width" value={p.width ?? 1} min={unit === 'pixels' ? 1 : 0.01} max={maxX} step={step} onChange={(v) => set({ width: v })} />
        <Slider label="Height" value={p.height ?? 1} min={unit === 'pixels' ? 1 : 0.01} max={maxY} step={step} onChange={(v) => set({ height: v })} />
        <button
          type="button"
          className="ghost-btn small"
          onClick={() => set({ x: 0, y: 0, width: 1, height: 1, unit: 'normalized' })}
        >
          <Icon name="refresh" size={14} /> Reset crop
        </button>
      </Section>
      <div className="info-callout">
        <Icon name="layers" size={16} />
        <span>
          Aspect ratio changes here flow into the Pixelate node. Use <strong>Fixed height</strong> or
          <strong> Fixed width</strong> to keep batch output consistent after cropping.
        </span>
      </div>
    </div>
  );
}

export function ResizePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { activeAsset, updateNodeParams } = useStudio();
  const p = node.params as {
    width: number;
    height: number;
    unit: string;
    factor?: number;
    mode: string;
    filter: string;
    allowUpscale: number;
  };
  const unit = (p.unit ?? 'pixels') as 'pixels' | 'percent' | 'times';
  const sw = activeAsset?.width ?? 1;
  const sh = activeAsset?.height ?? 1;
  const factor = Number(p.factor ?? 2);
  const targetW =
    unit === 'percent' ? (p.width / 100) * sw : unit === 'times' ? sw * factor : p.width;
  const targetH =
    unit === 'percent' ? (p.height / 100) * sh : unit === 'times' ? sh * factor : p.height;
  const set = (patch: Record<string, unknown>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section title="Resize" subtitle="Premultiplied alpha prevents fringes on transparent edges.">
        <SelectField
          label="Units"
          value={unit}
          options={[
            { value: 'pixels', label: 'Pixels' },
            { value: 'percent', label: 'Percent' },
            { value: 'times', label: 'Times (×)' },
          ]}
          onChange={(v) => set({ unit: v })}
        />
        {unit === 'times' ? (
          <NumberField
            label="Scale"
            value={factor}
            min={0.05}
            step={0.25}
            unit="×"
            hint="Multiplies the source dimensions. 2× doubles both width and height."
            onChange={(v) => set({ factor: v })}
          />
        ) : (
          <div className="two-col">
            <NumberField
              label="Width"
              value={p.width ?? 0}
              min={0}
              step={1}
              unit={unit === 'percent' ? '%' : 'px'}
              hint="0 keeps the source aspect ratio"
              onChange={(v) => set({ width: v })}
            />
            <NumberField
              label="Height"
              value={p.height ?? 0}
              min={0}
              step={1}
              unit={unit === 'percent' ? '%' : 'px'}
              hint="0 keeps the source aspect ratio"
              onChange={(v) => set({ height: v })}
            />
          </div>
        )}
        <SelectField
          label="Fit mode"
          value={p.mode ?? 'fit'}
          options={[
            { value: 'fit', label: 'Fit inside (no crop)' },
            { value: 'fill', label: 'Fill + centre crop' },
            { value: 'stretch', label: 'Stretch to exact size' },
          ]}
          onChange={(v) => set({ mode: v })}
        />
        <SelectField
          label="Texture filter"
          value={p.filter ?? 'nearest'}
          options={[
            { value: 'nearest', label: 'Nearest (hard pixels)' },
            { value: 'bilinear', label: 'Bilinear' },
            { value: 'box', label: 'Box / area' },
            { value: 'bicubic', label: 'Bicubic (Catmull–Rom)' },
            { value: 'lanczos3', label: 'Lanczos 3 (sharp)' },
          ]}
          onChange={(v) => set({ filter: v })}
        />
        <Toggle
          label="Allow upscaling"
          checked={Number(p.allowUpscale ?? 1) > 0.5}
          onChange={(v) => set({ allowUpscale: v ? 1 : 0 })}
        />
      </Section>
      <div className="stat-strip">
        <div>
          <span>Target</span>
          <strong>
            {Math.max(1, Math.round(targetW)) || 'auto'} × {Math.max(1, Math.round(targetH)) || 'auto'}
          </strong>
        </div>
        <div>
          <span>Alpha</span>
          <strong>retained</strong>
        </div>
      </div>
      <div className="info-callout">
        <Icon name="zoomIn" size={16} />
        <span>
          Resize runs before pixelation. <strong>Nearest</strong> is the default for pixel art and keeps
          hard edges; use <strong>Lanczos 3</strong> only for clean downscales of photographic input.
        </span>
      </div>
    </div>
  );
}

const CHANNEL_OPTIONS: Array<{ value: ChannelSource; label: string }> = [
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
  { value: 'a', label: 'Alpha' },
  { value: 'luma', label: 'Luma' },
  { value: 'zero', label: 'Zero' },
  { value: 'one', label: 'One' },
];

export function ChannelsPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const s = node.params as unknown as ChannelSettings;
  const set = (patch: Partial<ChannelSettings>): void => updateNodeParams(node.id, { ...s, ...patch });

  return (
    <div className="inspector-panel">
      <Section title="Channel operation" subtitle="A dedicated colour → channel mode with optional alpha retention.">
        <SelectField
          label="Mode"
          value={s.operation ?? 'extract'}
          options={[
            { value: 'extract', label: 'Extract channel → grayscale' },
            { value: 'swap', label: 'Swap / reorder channels' },
            { value: 'pack', label: 'Pack channels into RGBA' },
            { value: 'luma-to-alpha', label: 'Luma → alpha' },
            { value: 'alpha-to-luma', label: 'Alpha → luma' },
            { value: 'hsl-map', label: 'HSL → RGB channels' },
          ]}
          onChange={(v) => set({ operation: v as ChannelSettings['operation'] })}
        />

        {s.operation === 'extract' ? (
          <SelectField
            label="Source channel"
            value={s.channel ?? 'luma'}
            options={CHANNEL_OPTIONS}
            onChange={(v) => set({ channel: v })}
          />
        ) : null}

        {s.operation === 'swap' ? (
          <SelectField
            label="Channel order"
            value={s.swap ?? 'bgr'}
            options={[
              { value: 'rgb', label: 'RGB' },
              { value: 'bgr', label: 'BGR' },
              { value: 'gbr', label: 'GBR' },
              { value: 'brg', label: 'BRG' },
              { value: 'grb', label: 'GRB' },
              { value: 'rbg', label: 'RBG' },
            ]}
            onChange={(v) => set({ swap: v as ChannelSettings['swap'] })}
          />
        ) : null}

        {s.operation === 'pack' ? (
          <>
            <div className="two-col">
              <SelectField label="→ R" value={s.pack?.r ?? 'r'} options={CHANNEL_OPTIONS} onChange={(v) => set({ pack: { ...s.pack, r: v } })} />
              <SelectField label="→ G" value={s.pack?.g ?? 'g'} options={CHANNEL_OPTIONS} onChange={(v) => set({ pack: { ...s.pack, g: v } })} />
            </div>
            <div className="two-col">
              <SelectField label="→ B" value={s.pack?.b ?? 'b'} options={CHANNEL_OPTIONS} onChange={(v) => set({ pack: { ...s.pack, b: v } })} />
              <SelectField label="→ A" value={s.pack?.a ?? 'a'} options={CHANNEL_OPTIONS} onChange={(v) => set({ pack: { ...s.pack, a: v } })} />
            </div>
          </>
        ) : null}

        <Toggle
          label="Retain original alpha"
          checked={s.keepAlpha ?? true}
          onChange={(v) => set({ keepAlpha: v })}
          hint="When enabled, the source alpha channel is preserved through the operation."
        />
        <Toggle label="Invert result" checked={s.invert ?? false} onChange={(v) => set({ invert: v })} />
      </Section>

      <div className="stat-strip">
        <div>
          <span>Operation</span>
          <strong>{s.operation ?? 'extract'}</strong>
        </div>
        <div>
          <span>Alpha</span>
          <strong>{s.keepAlpha ?? true ? 'retained' : 'replaced'}</strong>
        </div>
      </div>

      <div className="info-callout">
        <Icon name="layers" size={16} />
        <span>
          <strong>HSL → RGB channels</strong> encodes hue in red, saturation in green and lightness in blue —
          useful as a displacement or matte source. <strong>Luma → alpha</strong> turns a painting into a
          soft cutout.
        </span>
      </div>
    </div>
  );
}
