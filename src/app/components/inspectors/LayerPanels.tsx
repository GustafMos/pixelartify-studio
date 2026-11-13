import React, { useMemo } from 'react';
import type {
  ExtractionSettings,
  GraphNode,
  LayerBlend,
  LayerRole,
  LayerSettings,
} from '../../../core/types';
import {
  DEFAULT_EXTRACTION,
  DEFAULT_INPAINT,
  bestTextColor,
  layerDefaults,
  threeLayerStack,
} from '../../../core';
import { useStudio } from '../../store';
import { maskToDataUrl } from '../../io';
import {
  Badge,
  ColorField,
  EmptyState,
  IconButton,
  Section,
  Segmented,
  SelectField,
  Slider,
  TextField,
  Toggle,
} from '../controls';
import { Icon } from '../icons';

const METHOD_OPTIONS = [
  { value: 'saliency', label: 'Saliency (auto subject)' },
  { value: 'box', label: 'Subject box / ellipse' },
  { value: 'chroma', label: 'Chroma key' },
  { value: 'luma', label: 'Luminance range' },
  { value: 'edge', label: 'Edge / line detail' },
  { value: 'stars', label: 'Stars / bright blobs' },
  { value: 'manual', label: 'Manual painting' },
] as const;

export function ExtractPanel({ node }: { node: GraphNode }): React.ReactElement {
  const {
    activeAsset,
    evaluation,
    updateNodeParams,
    refreshMasks,
    beginMaskEdit,
    beginSubjectSelect,
    maskTracking,
    trackedMasks,
    clearMaskOverride,
    maskOverrides,
    videoFrame,
  } = useStudio();
  const extraction: ExtractionSettings = {
    ...DEFAULT_EXTRACTION,
    ...((node.params.extraction as Partial<ExtractionSettings> | undefined) ?? {}),
  };
  const maskId = String(node.params.maskId ?? 'subject');
  const maskKey = activeAsset ? `${node.id}:${activeAsset.id}:${maskId}` : '';
  const override = maskKey ? maskOverrides[maskKey] : undefined;
  const tracked = maskKey ? trackedMasks[maskKey] : undefined;
  const tracking = maskKey && maskTracking?.key === maskKey ? maskTracking : null;

  const mask = useMemo(() => {
    const value = evaluation.values.get(node.id)?.mask;
    if (!value || value.type !== 'mask') return null;
    const item = value.items.find((m) => m.assetId === activeAsset?.id) ?? value.items[0];
    return item?.mask ?? null;
  }, [evaluation, node.id, activeAsset]);

  const maskUrl = useMemo(() => (mask ? maskToDataUrl(mask) : null), [mask]);
  const set = (patch: Partial<ExtractionSettings>): void =>
    updateNodeParams(node.id, { extraction: { ...extraction, ...patch } });

  return (
    <div className="inspector-panel">
      <Section title="Mask output">
        <TextField
          label="Mask ID"
          value={maskId}
          onChange={(value) => updateNodeParams(node.id, { maskId: value.trim() || 'subject' })}
          hint="Compose layers reference this ID."
          mono
        />
        <Toggle
          label="Extraction enabled"
          checked={extraction.enabled}
          onChange={(v) => set({ enabled: v })}
        />
        <Toggle
          label="Only extracted (rest transparent)"
          checked={Boolean(node.params.onlyExtracted)}
          onChange={(v) => updateNodeParams(node.id, { onlyExtracted: v })}
        />
        <p className="micro-copy">
          Applies the extracted mask to the media output itself. Leave off to pass the full image through while
          still exporting the mask for Compose layers.
        </p>
        {extraction.method === 'manual' && !override && Boolean(node.params.onlyExtracted) ? (
          <div className="info-callout">
            <Icon name="brush" size={16} />
            <span>
              Manual extraction has no mask yet, so the isolated output would be empty. Use{' '}
              <strong>Select subject</strong> or <strong>Paint mask</strong> first.
            </span>
          </div>
        ) : null}
        <div className="mask-preview-card">
          {maskUrl ? (
            <img src={maskUrl} alt="Extracted mask" />
          ) : (
            <div className="mask-placeholder">
              <Icon name="eye" size={20} />
              <span>No mask</span>
            </div>
          )}
          <div className="mask-preview-meta">
            <Badge tone={override ? 'success' : 'neutral'}>{override ? 'manual' : 'auto'}</Badge>
            {tracked ? (
              <Badge tone="success">tracked · {tracked.masks.length} frames</Badge>
            ) : null}
            {tracking ? (
              <Badge tone="warn">
                tracking {tracking.done}/{tracking.total}
              </Badge>
            ) : null}
            <span>{mask ? `${mask.width}×${mask.height}` : '—'}</span>
          </div>
        </div>
        {activeAsset?.kind === 'video' ? (
          <p className="micro-copy">
            <strong>Magic select → Apply &amp; track</strong> follows the subject through the clip and caches
            per-frame masks. Painted or box selections stay static.
          </p>
        ) : null}
        <div className="btn-row">
          <button type="button" className="ghost-btn small" onClick={refreshMasks}>
            <Icon name="refresh" size={14} /> Re-extract
          </button>
          <button
            type="button"
            className="ghost-btn small"
            onClick={() => {
              updateNodeParams(node.id, {
                onlyExtracted: true,
                extraction: { ...extraction, enabled: true },
              });
              beginSubjectSelect(node.id, maskId, 'magic');
            }}
            disabled={!activeAsset}
          >
            <Icon name="wand" size={14} /> Magic select
          </button>
          <button
            type="button"
            className="ghost-btn small"
            onClick={() => {
              updateNodeParams(node.id, {
                onlyExtracted: true,
                extraction: { ...extraction, enabled: true },
              });
              beginSubjectSelect(node.id, maskId, 'box');
            }}
            disabled={!activeAsset}
          >
            <Icon name="fit" size={14} /> Box
          </button>
          <button
            type="button"
            className="ghost-btn small"
            onClick={() => beginMaskEdit(node.id, maskId)}
            disabled={!activeAsset}
          >
            <Icon name="brush" size={14} /> Paint mask
          </button>
          {override ? (
            <button type="button" className="text-btn danger" onClick={() => clearMaskOverride(maskKey)}>
              Reset mask override
            </button>
          ) : null}
        </div>
      </Section>

      <Section title="Feature extractor">
        <SelectField
          label="Method"
          value={extraction.method}
          options={METHOD_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
          onChange={(v) => set({ method: v })}
        />

        {extraction.method === 'saliency' ? (
          <>
            <Slider
              label="Threshold"
              value={extraction.threshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => set({ threshold: v })}
              hint="Higher values isolate compact, high-contrast central subjects; lower values include more of the scene."
            />
            <Slider label="Softness" value={extraction.softness} min={0} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
            <Slider label="Centre bias" value={extraction.centerBias} min={0} max={1} step={0.01} onChange={(v) => set({ centerBias: v })} />
          </>
        ) : null}

        {extraction.method === 'chroma' ? (
          <>
            <ColorField label="Key colour" value={extraction.keyColor} onChange={(v) => set({ keyColor: v })} />
            <Slider label="Tolerance" value={extraction.tolerance} min={0.01} max={0.8} step={0.01} onChange={(v) => set({ tolerance: v })} />
            <Slider label="Edge softness" value={extraction.softness} min={0} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
          </>
        ) : null}

        {extraction.method === 'luma' ? (
          <>
            <Slider label="Luma min" value={extraction.lumaMin} min={0} max={1} step={0.01} onChange={(v) => set({ lumaMin: v })} />
            <Slider label="Luma max" value={extraction.lumaMax} min={0} max={1} step={0.01} onChange={(v) => set({ lumaMax: v })} />
            <Slider label="Edge softness" value={extraction.softness} min={0} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
          </>
        ) : null}

        {extraction.method === 'edge' ? (
          <>
            <Slider label="Edge threshold" value={extraction.threshold} min={0} max={1} step={0.01} onChange={(v) => set({ threshold: v })} />
            <Slider label="Dilate / softness" value={extraction.softness} min={0} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
          </>
        ) : null}

        {extraction.method === 'box' ? (
          <>
            <Segmented
              label="Shape"
              value={extraction.boxShape}
              options={[
                { value: 'ellipse', label: 'Ellipse' },
                { value: 'rectangle', label: 'Rectangle' },
              ]}
              onChange={(v) => set({ boxShape: v as 'ellipse' | 'rectangle' })}
            />
            <Slider label="X" value={extraction.boxX} min={0} max={1} step={0.01} onChange={(v) => set({ boxX: v })} />
            <Slider label="Y" value={extraction.boxY} min={0} max={1} step={0.01} onChange={(v) => set({ boxY: v })} />
            <Slider label="Width" value={extraction.boxWidth} min={0.01} max={1} step={0.01} onChange={(v) => set({ boxWidth: v })} />
            <Slider label="Height" value={extraction.boxHeight} min={0.01} max={1} step={0.01} onChange={(v) => set({ boxHeight: v })} />
          </>
        ) : null}

        {extraction.method === 'manual' ? (
          <div className="info-callout">
            <Icon name="brush" size={16} />
            <span>Use <strong>Paint mask</strong> above. Manual masks start empty so you can build them with the brush.</span>
          </div>
        ) : null}

        <Slider label="Feather" value={extraction.feather} min={0} max={8} step={0.1} unit="art px" onChange={(v) => set({ feather: v })} />
        <Toggle label="Invert mask" checked={extraction.invert} onChange={(v) => set({ invert: v })} />
      </Section>

      <div className="info-callout">
        <Icon name="layers" size={16} />
        <span>
          Add more Extract nodes for separate <strong>subject</strong> and <strong>detail</strong> masks, then
          wire them into a Compose node. Background layers inpaint anything hidden by higher layers.
        </span>
      </div>
      {videoFrame ? (
        <p className="micro-copy">Video preview uses the mask from the current frame. Final video export reuses the mask unless you paint an override.</p>
      ) : null}
    </div>
  );
}

const BLEND_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'add', label: 'Add' },
  { value: 'overlay', label: 'Overlay' },
] as const;

const ROLE_OPTIONS: Array<{ value: LayerRole; label: string }> = [
  { value: 'background', label: 'Background' },
  { value: 'foreground', label: 'Foreground' },
  { value: 'detail', label: 'Detail' },
  { value: 'overlay', label: 'Overlay' },
];

export function ComposePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { graph, updateNodeParams, beginMaskEdit, activeAsset } = useStudio();
  const layers = (node.params.layers as LayerSettings[] | undefined) ?? [];

  const availableMaskIds = useMemo(() => {
    const ids = new Set<string>(['subject', 'detail']);
    for (const n of graph.nodes) {
      if (n.type === 'extract') ids.add(String(n.params.maskId ?? 'subject'));
    }
    return [...ids];
  }, [graph.nodes]);

  const setLayers = (next: LayerSettings[]): void => {
    const sorted = [...next].sort((a, b) => a.z - b.z).map((l, i) => ({ ...l, z: i * 10 }));
    updateNodeParams(node.id, { layers: sorted });
  };

  const update = (id: string, patch: Partial<LayerSettings>): void => {
    setLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addLayer = (role: LayerRole): void => {
    const layer = layerDefaults(role);
    layer.z = layers.length * 10 + 10;
    setLayers([...layers, layer]);
  };

  const move = (id: string, dir: -1 | 1): void => {
    const sorted = [...layers].sort((a, b) => b.z - a.z); // top first in UI
    const index = sorted.findIndex((l) => l.id === id);
    const target = index + dir;
    if (target < 0 || target >= sorted.length) return;
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    setLayers([...sorted].reverse());
  };

  const topFirst = [...layers].sort((a, b) => b.z - a.z);

  return (
    <div className="inspector-panel">
      <Section
        title={`Layer stack · ${layers.length}`}
        right={
          <button type="button" className="text-btn" onClick={() => setLayers(threeLayerStack())}>
            Reset stack
          </button>
        }
      >
        <div className="add-layer-row">
          {ROLE_OPTIONS.map((r) => (
            <button key={r.value} type="button" className="ghost-btn small" onClick={() => addLayer(r.value)}>
              <Icon name="plus" size={12} /> {r.label}
            </button>
          ))}
        </div>

        {layers.length === 0 ? (
          <EmptyState icon="layers" title="No layers">
            Add a background and subject layer, then connect masks from one or more Extract nodes.
          </EmptyState>
        ) : null}

        <div className="layer-list">
          {topFirst.map((layer, index) => {
            const maskAvailable = layer.maskId ? availableMaskIds.includes(layer.maskId) : false;
            return (
              <div key={layer.id} className={`layer-card role-${layer.role} ${layer.visible ? '' : 'is-hidden'}`}>
                <div className="layer-head">
                  <IconButton
                    icon={layer.visible ? 'eye' : 'eyeOff'}
                    label={layer.visible ? 'Hide layer' : 'Show layer'}
                    size={14}
                    active={layer.visible}
                    onClick={() => update(layer.id, { visible: !layer.visible })}
                  />
                  <input
                    className="layer-name-input"
                    value={layer.name}
                    onChange={(e) => update(layer.id, { name: e.target.value })}
                    aria-label="Layer name"
                  />
                  <Badge tone={layer.role === 'foreground' ? 'accent' : layer.role === 'background' ? 'neutral' : 'success'}>
                    {layer.role}
                  </Badge>
                  <IconButton icon="chevron" label="Move layer up" size={13} onClick={() => move(layer.id, -1)} />
                  <IconButton icon="chevron" label="Move layer down" size={13} onClick={() => move(layer.id, 1)} />
                  <IconButton
                    icon="trash"
                    label="Delete layer"
                    size={13}
                    danger
                    onClick={() => setLayers(layers.filter((l) => l.id !== layer.id))}
                  />
                </div>

                <div className="layer-body">
                  <div className="two-col">
                    <SelectField
                      label="Mask"
                      value={layer.maskId ?? ''}
                      options={[{ value: '', label: 'Whole image' }, ...availableMaskIds.map((id) => ({ value: id, label: id }))]}
                      onChange={(v) => update(layer.id, { maskId: v || null })}
                    />
                    <SelectField
                      label="Blend"
                      value={layer.blend}
                      options={BLEND_OPTIONS.map((b) => ({ value: b.value, label: b.label }))}
                      onChange={(v) => update(layer.id, { blend: v as LayerBlend })}
                    />
                  </div>
                  {layer.role !== 'background' ? (
                    <SelectField
                      label="Inpaint occlusion mask (optional)"
                      value={layer.occlusionMaskId ?? ''}
                      options={[{ value: '', label: 'Use this layer mask' }, ...availableMaskIds.map((id) => ({ value: id, label: id }))]}
                      onChange={(v) => update(layer.id, { occlusionMaskId: v || null })}
                      hint="A looser mask used only to remove this layer's area (legs, shadow) from background layers."
                    />
                  ) : null}
                  {layer.maskId && !maskAvailable ? (
                    <p className="field-warning">No Extract node currently outputs mask “{layer.maskId}”.</p>
                  ) : null}
                  <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} onChange={(v) => update(layer.id, { opacity: v })} />
                  <div className="two-col">
                    <Slider label="Offset X" value={layer.offsetX} min={-64} max={64} step={1} unit="art px" onChange={(v) => update(layer.id, { offsetX: v })} />
                    <Slider label="Offset Y" value={layer.offsetY} min={-64} max={64} step={1} unit="art px" onChange={(v) => update(layer.id, { offsetY: v })} />
                  </div>
                  <Slider label="Layer scale" value={layer.scale} min={0.25} max={3} step={0.01} onChange={(v) => update(layer.id, { scale: v })} />

                  {layer.role === 'detail' ? (
                    <Slider label="Detail strength" value={layer.detailStrength} min={0} max={1} step={0.01} onChange={(v) => update(layer.id, { detailStrength: v })} />
                  ) : null}

                  {layer.role === 'background' ? (
                    <>
                      <Toggle
                        label="Inpaint occluded regions"
                        checked={layer.inpaintOcclusion}
                        onChange={(v) => update(layer.id, { inpaintOcclusion: v })}
                        hint="Fills the area hidden by higher layers so the background holds up when the subject moves."
                      />
                      {layer.inpaintOcclusion ? (
                        <div className="inset-panel">
                          <SelectField
                            label="Inpaint method"
                            value={layer.inpaint.method}
                            options={[
                              { value: 'directional', label: 'Directional / mirrored fill' },
                              { value: 'diffusion', label: 'Pyramid + diffusion' },
                              { value: 'pyramid', label: 'Pyramid fill only' },
                              { value: 'dither', label: 'Dithered regeneration' },
                            ]}
                            onChange={(v) =>
                              update(layer.id, { inpaint: { ...layer.inpaint, method: v as LayerSettings['inpaint']['method'] } })
                            }
                          />
                          <Slider label="Texture" value={layer.inpaint.texture} min={0} max={1} step={0.01} onChange={(v) => update(layer.id, { inpaint: { ...layer.inpaint, texture: v } })} />
                          <Slider label="Iterations" value={layer.inpaint.iterations} min={0} max={96} step={1} onChange={(v) => update(layer.id, { inpaint: { ...layer.inpaint, iterations: v } })} />
                          <Slider label="Radius" value={layer.inpaint.radius} min={0} max={8} step={0.1} unit="art px" onChange={(v) => update(layer.id, { inpaint: { ...layer.inpaint, radius: v } })} />
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {layer.maskId ? (
                    <button
                      type="button"
                      className="ghost-btn small"
                      onClick={() => {
                        const extract = graph.nodes.find(
                          (n) => n.type === 'extract' && String(n.params.maskId ?? 'subject') === layer.maskId,
                        );
                        beginMaskEdit(extract?.id ?? node.id, layer.maskId!);
                      }}
                      disabled={!activeAsset}
                    >
                      <Icon name="brush" size={14} /> Paint “{layer.maskId}” mask
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="info-callout">
        <Icon name="layers" size={16} />
        <span>
          Layers are composited at art resolution. Background layers with inpainting regenerate the hidden
          region; detail layers add an edge high-pass; offsets are measured in <strong>art pixels</strong> for
          parallax.
        </span>
      </div>
    </div>
  );
}
