import React, { useMemo, useRef } from 'react';
import type { GraphNode, PaletteDefinition, PaletteSettings } from '../../../core/types';
import { DEFAULT_PALETTE, extractPalette, parsePalette, bestTextColor } from '../../../core';
import { serializePalette } from '../../../core/palette';
import { useStudio } from '../../store';
import { Badge, IconButton, Section, Segmented, SelectField, Slider } from '../controls';
import { Icon } from '../icons';
import { downloadText } from '../../io';

export function PalettePanel({ node }: { node: GraphNode }): React.ReactElement {
  const {
    activeAsset,
    videoFrame,
    updateNodeParams,
    activePaletteId,
    setActivePalette,
    palettes,
    savePalette,
    deletePalette,
    setPaletteStudioOpen,
    activePalette,
    notify,
  } = useStudio();
  const palette = (node.params.palette as PaletteSettings | undefined) ?? { ...DEFAULT_PALETTE };
  const importRef = useRef<HTMLInputElement>(null);

  const sourceImage = videoFrame ?? activeAsset?.image ?? null;
  const builtin = useMemo(() => palettes.filter((p) => p.source === 'builtin'), [palettes]);
  const custom = useMemo(() => palettes.filter((p) => p.source !== 'builtin'), [palettes]);

  const set = (patch: Partial<PaletteSettings>): void =>
    updateNodeParams(node.id, { palette: { ...palette, ...patch } });

  const applyLibrary = (p: PaletteDefinition): void => {
    setActivePalette(p.id);
    set({ mode: 'custom', colors: p.colors });
  };

  const extractFromImage = (): void => {
    if (!sourceImage) {
      notify('Add an image first.', 'warn');
      return;
    }
    const colors = extractPalette(sourceImage, palette.autoCount || 24, palette.quantizer);
    set({ mode: 'custom', colors });
    notify(`Extracted ${colors.length} colours from the active image.`, 'success');
  };

  const addColor = (): void => {
    set({ mode: 'custom', colors: [...palette.colors, '#ffffff'] });
  };

  const updateColor = (index: number, color: string): void => {
    const colors = [...palette.colors];
    colors[index] = color;
    set({ colors });
  };

  const removeColor = (index: number): void => {
    set({ colors: palette.colors.filter((_, i) => i !== index) });
  };

  return (
    <div className="inspector-panel">
      <Section title="Palette source">
        <Segmented
          label="Mode"
          value={palette.mode}
          options={[
            { value: 'none', label: 'None' },
            { value: 'auto', label: 'Auto' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => set({ mode: v })}
        />
        {palette.mode === 'auto' ? (
          <>
            <Slider label="Colours" value={palette.autoCount} min={2} max={128} step={1} onChange={(v) => set({ autoCount: v })} />
            <SelectField
              label="Extractor"
              value={palette.quantizer}
              options={[
                { value: 'kmeans', label: 'Median cut + OKLab k-means' },
                { value: 'median-cut', label: 'Median cut (fast)' },
              ]}
              onChange={(v) => set({ quantizer: v as PaletteSettings['quantizer'] })}
            />
            <button type="button" className="primary-btn small" onClick={extractFromImage}>
              <Icon name="sparkles" size={14} /> Use extracted palette
            </button>
          </>
        ) : null}

        {palette.mode === 'custom' ? (
          <>
            <div className="palette-grid">
              {palette.colors.map((color, i) => (
                <div key={`${color}-${i}`} className="palette-swatch-wrap">
                  <label
                    className="palette-swatch"
                    style={{ background: color, color: bestTextColor(color) }}
                    title={color}
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => updateColor(i, e.target.value)}
                      aria-label={`Edit colour ${i + 1}`}
                    />
                    <span>{i + 1}</span>
                  </label>
                  <button
                    type="button"
                    className="swatch-remove"
                    title="Remove colour"
                    onClick={() => removeColor(i)}
                  >
                    <Icon name="close" size={10} />
                  </button>
                </div>
              ))}
              <button type="button" className="palette-add" onClick={addColor} title="Add colour">
                <Icon name="plus" size={16} />
              </button>
            </div>
            <div className="btn-row">
              <button type="button" className="ghost-btn small" onClick={() => setPaletteStudioOpen(true)}>
                <Icon name="palette" size={14} /> Palette Studio
              </button>
              <button type="button" className="ghost-btn small" onClick={() => importRef.current?.click()}>
                <Icon name="upload" size={14} /> Import
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() =>
                  downloadText(
                    serializePalette(palette.colors, 'gpl', `${node.title} palette`),
                    'palette.gpl',
                    'text/plain',
                  )
                }
              >
                <Icon name="download" size={14} /> .gpl
              </button>
            </div>
          </>
        ) : null}

        <Slider label="Palette strength" value={palette.strength} min={0} max={1} step={0.01} onChange={(v) => set({ strength: v })} />
        <SelectField
          label="Match space"
          value={palette.colorSpace}
          options={[
            { value: 'oklab', label: 'OKLab (perceptual)' },
            { value: 'rgb', label: 'RGB' },
          ]}
          onChange={(v) => set({ colorSpace: v as PaletteSettings['colorSpace'] })}
        />
      </Section>

      <Section title="Palette library" defaultOpen={false}>
        <div className="library-group">
          <span className="library-label">Built-in</span>
          <div className="library-list">
            {builtin.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`library-row ${activePaletteId === p.id ? 'is-active' : ''}`}
                onClick={() => applyLibrary(p)}
                title={p.description}
              >
                <span className="mini-ramp">
                  {p.colors.slice(0, 8).map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
                <span>{p.name}</span>
                <em>{p.colors.length}</em>
              </button>
            ))}
          </div>
        </div>
        {custom.length > 0 ? (
          <div className="library-group">
            <span className="library-label">Your palettes</span>
            <div className="library-list">
              {custom.map((p) => (
                <div key={p.id} className={`library-row ${activePaletteId === p.id ? 'is-active' : ''}`}>
                  <button type="button" className="library-main" onClick={() => applyLibrary(p)}>
                    <span className="mini-ramp">
                      {p.colors.slice(0, 8).map((c, i) => (
                        <i key={`${c}${i}`} style={{ background: c }} />
                      ))}
                    </span>
                    <span>{p.name}</span>
                    <em>{p.colors.length}</em>
                  </button>
                  <IconButton
                    icon="trash"
                    label="Delete palette"
                    size={13}
                    danger
                    onClick={() => deletePalette(p.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="ghost-btn small"
          onClick={() => {
            if (palette.colors.length === 0) {
              notify('Add colours or extract a palette first.', 'warn');
              return;
            }
            savePalette({
              id: `palette-${Date.now().toString(36)}`,
              name: activePalette?.name ? `${activePalette.name} edit` : 'Custom palette',
              colors: palette.colors,
              source: 'custom',
            });
          }}
        >
          <Icon name="save" size={14} /> Save current palette
        </button>
      </Section>

      {activePalette ? (
        <Section title="Active library palette" defaultOpen={false}>
          <div className="active-palette-head">
            <strong>{activePalette.name}</strong>
            <Badge>{activePalette.colors.length} colours</Badge>
          </div>
          {activePalette.description ? <p className="micro-copy">{activePalette.description}</p> : null}
          <div className="palette-grid readonly">
            {activePalette.colors.map((c) => (
              <span key={c} className="palette-swatch" style={{ background: c }} title={c} />
            ))}
          </div>
          <button type="button" className="ghost-btn small" onClick={() => applyLibrary(activePalette)}>
            Apply to this node
          </button>
        </Section>
      ) : null}

      <input
        ref={importRef}
        type="file"
        accept=".hex,.txt,.gpl,.pal,.json,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const colors = parsePalette(await file.text());
            if (colors.length === 0) throw new Error('No colours found.');
            set({ mode: 'custom', colors });
            savePalette({
              id: `palette-${Date.now().toString(36)}`,
              name: file.name.replace(/\.[^.]+$/, ''),
              colors,
              source: 'imported',
            });
            notify(`Imported ${colors.length} colours.`, 'success');
          } catch (err) {
            notify(`Palette import failed: ${err instanceof Error ? err.message : err}`, 'error');
          }
        }}
      />
    </div>
  );
}
