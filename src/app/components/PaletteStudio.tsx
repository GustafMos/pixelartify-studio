import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HarmonyRule, PaletteDefinition, PaletteSettings } from '../../core/types';
import {
  DEFAULT_PALETTE,
  bestTextColor,
  contrastGrade,
  contrastRatio,
  extractPalette,
  generateHarmony,
  hexToHsl,
  hslToHex,
  normalizeHex,
  parsePalette,
  serializePalette,
  shadeRamp,
  simulateColorBlindness,
  type ColorBlindness,
} from '../../core';
import { useStudio } from '../store';
import { downloadText } from '../io';
import {
  Badge,
  ColorField,
  IconButton,
  Modal,
  SelectField,
  Slider,
  TextField,
} from './controls';
import { Icon } from './icons';

const RULES: Array<{ value: HarmonyRule; label: string }> = [
  { value: 'analogous', label: 'Analogous' },
  { value: 'monochromatic', label: 'Monochromatic' },
  { value: 'complementary', label: 'Complementary' },
  { value: 'split-complementary', label: 'Split complementary' },
  { value: 'triadic', label: 'Triadic' },
  { value: 'tetradic', label: 'Tetradic' },
  { value: 'square', label: 'Square' },
  { value: 'compound', label: 'Compound' },
];

const CVD_OPTIONS: Array<{ value: 'none' | ColorBlindness; label: string }> = [
  { value: 'none', label: 'Normal vision' },
  { value: 'protanopia', label: 'Protanopia' },
  { value: 'deuteranopia', label: 'Deuteranopia' },
  { value: 'tritanopia', label: 'Tritanopia' },
  { value: 'achromatopsia', label: 'Achromatopsia' },
];

export function PaletteStudio(): React.ReactElement {
  const {
    paletteStudioOpen,
    setPaletteStudioOpen,
    graph,
    selectedNode,
    activeAsset,
    videoFrame,
    updateNodeParams,
    savePalette,
    selectNode,
    notify,
    activePalette,
    setActivePalette,
    palettes,
  } = useStudio();

  const paletteNode = useMemo(() => {
    if (selectedNode?.type === 'palette') return selectedNode;
    return graph.nodes.find((n) => n.type === 'palette') ?? null;
  }, [graph.nodes, selectedNode]);

  const paletteSettings = (paletteNode?.params.palette as PaletteSettings | undefined) ?? null;
  const [colors, setColors] = useState<string[]>([]);
  const [base, setBase] = useState('#3a86ff');
  const [rule, setRule] = useState<HarmonyRule>('analogous');
  const [count, setCount] = useState(5);
  const [saturation, setSaturation] = useState(1);
  const [lightness, setLightness] = useState(1);
  const [spread, setSpread] = useState(1);
  const [cvd, setCvd] = useState<'none' | ColorBlindness>('none');
  const [saveName, setSaveName] = useState('My Palette');
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const savedIdRef = useRef<string | null>(null);

  // Initialise only when the studio opens or the target node changes. Saving a
  // new palette changes the active palette id; it must not reset the editor to
  // the node's previous colours (which made Apply look like a no-op).
  useEffect(() => {
    if (!paletteStudioOpen) return;
    const initial =
      paletteSettings && paletteSettings.colors.length > 0
        ? paletteSettings.colors
        : activePalette?.colors ?? colors;
    // If the node has its own palette, Save creates a new library entry. If we
    // are editing a loaded custom palette, Save updates it in place.
    savedIdRef.current =
      !(paletteSettings && paletteSettings.colors.length > 0) &&
      activePalette &&
      activePalette.source !== 'builtin'
        ? activePalette.id
        : null;
    if (initial.length > 0) {
      setColors([...initial]);
      const vivid = [...initial].sort((a, b) => hexToHsl(b).s - hexToHsl(a).s)[0];
      setBase(vivid ?? initial[0]);
      setSaveName(activePalette?.name ?? 'My Palette');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteStudioOpen, paletteNode?.id]);

  const harmony = useMemo(
    () =>
      generateHarmony({
        base,
        rule,
        count,
        saturation,
        lightness,
        spread,
      }),
    [base, rule, count, saturation, lightness, spread],
  );

  const ramp = useMemo(() => shadeRamp(base, 9), [base]);

  useEffect(() => {
    if (!paletteStudioOpen) return;
    const canvas = wheelRef.current;
    if (!canvas) return;
    const size = 190;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    const center = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const r = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (r > center - 3) {
          img.data[i + 3] = 0;
          continue;
        }
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const sat = Math.min(1, r / (center - 3));
        const parsed = hslToHex(hue, sat, 0.55);
        const n = parseInt(parsed.slice(1), 16);
        img.data[i] = (n >> 16) & 255;
        img.data[i + 1] = (n >> 8) & 255;
        img.data[i + 2] = n & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [paletteStudioOpen]);

  const baseHsl = hexToHsl(base);
  const markerAngle = (baseHsl.h * Math.PI) / 180;
  const markerR = baseHsl.s * 80;
  const markerX = 95 + Math.cos(markerAngle) * markerR;
  const markerY = 95 + Math.sin(markerAngle) * markerR;

  const pickWheel = (clientX: number, clientY: number): void => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - rect.width / 2;
    const dy = clientY - rect.top - rect.height / 2;
    const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (rect.width / 2 - 3));
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    setBase(hslToHex(hue, r, baseHsl.l));
  };

  const addColor = (color: string): void => {
    setColors((prev) => (prev.includes(color) ? prev : [...prev, color]));
  };

  const extract = (): void => {
    const img = videoFrame ?? activeAsset?.image;
    if (!img) {
      notify('Add an image first.', 'warn');
      return;
    }
    const next = extractPalette(img, Math.max(4, colors.length || 16), 'kmeans');
    setColors(next);
    notify(`Extracted ${next.length} colours.`, 'success');
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const next = parsePalette(await file.text());
      if (next.length === 0) throw new Error('No colours found.');
      setColors(next);
      setBase(next[0]);
      notify(`Imported ${next.length} colours.`, 'success');
    } catch (err) {
      notify(`Palette import failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  const apply = (): void => {
    if (!paletteNode) {
      notify('Add a Palette node to the graph first.', 'warn');
      return;
    }
    if (colors.length === 0) {
      notify('Add or extract at least one colour first.', 'warn');
      return;
    }
    const settings: PaletteSettings = {
      ...DEFAULT_PALETTE,
      ...(paletteNode.params.palette as PaletteSettings | undefined),
      mode: 'custom',
      colors: [...colors],
    };
    updateNodeParams(paletteNode.id, { palette: settings });
    selectNode(paletteNode.id);
    notify(
      `Applied ${colors.length} colours to “${paletteNode.title}”.`,
      'success',
    );
  };

  const save = (): void => {
    if (colors.length === 0) {
      notify('Add or extract at least one colour before saving.', 'warn');
      return;
    }
    const name = saveName.trim() || 'Palette';
    const p: PaletteDefinition = {
      id: savedIdRef.current ?? `palette-${Date.now().toString(36)}`,
      name,
      colors: [...colors],
      source: 'custom',
    };
    savedIdRef.current = p.id;
    setSaveName(name);
    savePalette(p);
  };

  const simulated = cvd === 'none' ? colors : colors.map((c) => simulateColorBlindness(c, cvd));
  const pairs = useMemo(() => {
    const out: Array<{ a: string; b: string; ratio: number; grade: string }> = [];
    const sample = simulated.slice(0, 7);
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const ratio = contrastRatio(sample[i], sample[j]);
        out.push({ a: sample[i], b: sample[j], ratio, grade: contrastGrade(ratio) });
      }
    }
    return out;
  }, [simulated]);

  return (
    <Modal
      open={paletteStudioOpen}
      title="Palette Studio"
      subtitle="Adobe Color–inspired wheel, harmony rules, contrast checks and accessible palette editing."
      onClose={() => setPaletteStudioOpen(false)}
      wide
      footer={
        <>
          <span className="palette-studio-target">
            Target: {paletteNode ? paletteNode.title : 'no Palette node'}
          </span>
          <button type="button" className="ghost-btn" onClick={() => setPaletteStudioOpen(false)}>
            Close
          </button>
          <button type="button" className="ghost-btn" onClick={save}>
            <Icon name="save" size={14} /> Save palette
          </button>
          <button type="button" className="primary-btn" onClick={apply} disabled={!paletteNode}>
            <Icon name="palette" size={14} /> Apply to node
          </button>
        </>
      }
    >
      <div className="palette-studio">
        <div className="palette-studio-left">
          <div className="wheel-card">
            <div className="wheel-wrap">
              <canvas
                ref={wheelRef}
                className="color-wheel"
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  pickWheel(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (e.buttons & 1) pickWheel(e.clientX, e.clientY);
                }}
              />
              <span
                className="wheel-marker"
                style={{ left: markerX, top: markerY, background: base }}
              />
            </div>
            <div className="wheel-controls">
              <ColorField label="Base colour" value={base} onChange={setBase} />
              <Slider label="Lightness" value={baseHsl.l * 100} min={2} max={98} step={1} unit="%" onChange={(v) => setBase(hslToHex(baseHsl.h, baseHsl.s, v / 100))} />
              <Slider label="Saturation" value={baseHsl.s * 100} min={0} max={100} step={1} unit="%" onChange={(v) => setBase(hslToHex(baseHsl.h, v / 100, baseHsl.l))} />
            </div>
          </div>

          <div className="harmony-card">
            <div className="harmony-head">
              <span className="panel-kicker">Harmony</span>
              <Badge tone="accent">{RULES.find((r) => r.value === rule)?.label}</Badge>
            </div>
            <SelectField label="Rule" value={rule} options={RULES} onChange={(v) => setRule(v)} />
            <div className="two-col">
              <Slider label="Colours" value={count} min={3} max={8} step={1} onChange={setCount} />
              <Slider label="Spread" value={spread} min={0.4} max={1.6} step={0.01} onChange={setSpread} />
            </div>
            <Slider label="Saturation scale" value={saturation} min={0.2} max={1.6} step={0.01} onChange={setSaturation} />
            <Slider label="Lightness scale" value={lightness} min={0.2} max={1.6} step={0.01} onChange={setLightness} />
            <div className="harmony-swatches">
              {harmony.map((c, i) => (
                <button
                  key={`${c}${i}`}
                  type="button"
                  className="harmony-swatch"
                  style={{ background: c, color: bestTextColor(c) }}
                  onClick={() => setBase(c)}
                  onDoubleClick={() => addColor(c)}
                  title={`${c} — click to set base, double-click to add`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="btn-row">
              <button type="button" className="ghost-btn small" onClick={() => setColors(harmony)}>
                Use harmony
              </button>
              <button type="button" className="ghost-btn small" onClick={() => harmony.forEach(addColor)}>
                Add all
              </button>
            </div>
          </div>

          <div className="ramp-card">
            <span className="panel-kicker">Shades & tints</span>
            <div className="ramp-row">
              {ramp.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="ramp-swatch"
                  style={{ background: c }}
                  title={`${c} — add to palette`}
                  onClick={() => addColor(c)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="palette-studio-right">
          <div className="palette-editor-head">
            <span className="panel-kicker">Palette · {colors.length}</span>
            <div className="btn-row">
              <button type="button" className="ghost-btn small" onClick={extract}>
                <Icon name="image" size={13} /> Extract
              </button>
              <button type="button" className="ghost-btn small" onClick={() => importRef.current?.click()}>
                <Icon name="upload" size={13} /> Import
              </button>
            </div>
          </div>

          <div className="palette-editor-grid">
            {colors.map((c, i) => (
              <div key={`${c}-${i}`} className="editor-swatch-wrap">
                <label className="editor-swatch" style={{ background: c }} title={c}>
                  <input type="color" value={normalizeHex(c)} onChange={(e) => {
                    const next = [...colors];
                    next[i] = e.target.value;
                    setColors(next);
                  }} />
                </label>
                <div className="editor-swatch-meta">
                  <span>{normalizeHex(c)}</span>
                  <IconButton
                    icon="close"
                    label="Remove colour"
                    size={11}
                    onClick={() => setColors(colors.filter((_, idx) => idx !== i))}
                  />
                </div>
              </div>
            ))}
            <button type="button" className="editor-add" onClick={() => addColor('#ffffff')}>
              <Icon name="plus" size={18} />
              <span>Add</span>
            </button>
          </div>

          <div className="btn-row palette-library-row">
            <select
              value={activePalette?.id ?? ''}
              onChange={(e) => {
                const p = palettes.find((x) => x.id === e.target.value);
                if (p) {
                  savedIdRef.current = p.source === 'builtin' ? null : p.id;
                  setActivePalette(p.id);
                  setColors(p.colors);
                  setBase(p.colors[0]);
                  setSaveName(p.name);
                }
              }}
              aria-label="Load palette"
            >
              <option value="">Load library palette…</option>
              {palettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.colors.length})
                </option>
              ))}
            </select>
            <TextField value={saveName} onChange={setSaveName} placeholder="Palette name" />
          </div>

          <div className="contrast-card">
            <div className="contrast-head">
              <span className="panel-kicker">Contrast & accessibility</span>
              <SelectField
                label="Vision"
                value={cvd}
                options={CVD_OPTIONS}
                onChange={(v) => setCvd(v as 'none' | ColorBlindness)}
              />
            </div>
            <div className="contrast-summary">
              <div>
                <span>vs white</span>
                <strong>{contrastRatio(base, '#ffffff').toFixed(2)}</strong>
                <em>{contrastGrade(contrastRatio(base, '#ffffff'))}</em>
              </div>
              <div>
                <span>vs black</span>
                <strong>{contrastRatio(base, '#000000').toFixed(2)}</strong>
                <em>{contrastGrade(contrastRatio(base, '#000000'))}</em>
              </div>
              <div>
                <span>Best text</span>
                <strong style={{ color: bestTextColor(base) }}>{bestTextColor(base)}</strong>
                <em>on {base}</em>
              </div>
            </div>
            <div className="cvd-strip">
              {simulated.map((c, i) => (
                <span key={`${c}${i}`} style={{ background: c }} title={c} />
              ))}
            </div>
            <div className="contrast-grid">
              {pairs.slice(0, 18).map((p, i) => (
                <div key={i} className={`contrast-cell grade-${p.grade.replace(/\s/g, '')}`}>
                  <span>
                    <i style={{ background: p.a }} />
                    <i style={{ background: p.b }} />
                  </span>
                  <strong>{p.ratio.toFixed(1)}</strong>
                  <em>{p.grade}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="export-row">
            {(['hex', 'gpl', 'jasc', 'paintnet', 'json'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                className="ghost-btn small"
                onClick={() =>
                  downloadText(
                    serializePalette(colors, fmt, saveName || 'PixelArtify Palette'),
                    `palette.${fmt === 'jasc' ? 'pal' : fmt === 'paintnet' ? 'txt' : fmt}`,
                    'text/plain',
                  )
                }
              >
                .{fmt === 'jasc' ? 'pal' : fmt === 'paintnet' ? 'txt' : fmt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".hex,.txt,.gpl,.pal,.json,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
    </Modal>
  );
}
