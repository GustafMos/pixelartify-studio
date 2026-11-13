import React, { useMemo, useState } from 'react';
import type { DitherSettings, GraphNode } from '../../../core/types';
import { DITHER_ALGORITHMS, DITHER_BY_ID, type DitherCategory } from '../../../core/dither';
import { DEFAULT_DITHER } from '../../../core/defaults';
import { useStudio } from '../../store';
import { Badge, Section, Segmented, SelectField, Toggle } from '../controls';
import { Field } from '../Field';
import { Icon } from '../icons';

const CATEGORY_LABEL: Record<string, string> = {
  none: 'None',
  ordered: 'Ordered',
  diffusion: 'Error diffusion',
  pattern: 'Pattern',
  palette: 'Palette blend',
};

export function DitherPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const dither = (node.params.dither as DitherSettings | undefined) ?? { ...DEFAULT_DITHER };
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | DitherCategory>('all');
  const selected = DITHER_BY_ID[dither.algorithm] ?? DITHER_BY_ID.none;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DITHER_ALGORITHMS.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.id.includes(q)
      );
    });
  }, [search, category]);

  const set = (patch: Partial<DitherSettings>): void =>
    updateNodeParams(node.id, { dither: { ...dither, ...patch } });

  const categories: Array<{ value: 'all' | DitherCategory; label: string }> = [
    { value: 'all', label: `All ${DITHER_ALGORITHMS.length}` },
    { value: 'ordered', label: 'Ordered' },
    { value: 'diffusion', label: 'Diffusion' },
    { value: 'pattern', label: 'Pattern' },
    { value: 'palette', label: 'Palette' },
  ];

  return (
    <div className="inspector-panel">
      <Section title="Dither algorithm" defaultOpen>
        <div className="search-box">
          <Icon name="search" size={14} />
          <input
            value={search}
            placeholder={`Search ${DITHER_ALGORITHMS.length} algorithms…`}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="category-chips">
          {categories.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`chip ${category === c.value ? 'is-active' : ''}`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="algorithm-list">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`algorithm-row ${a.id === dither.algorithm ? 'is-active' : ''}`}
              onClick={() => set({ algorithm: a.id })}
              title={a.description}
            >
              <span className={`algorithm-dot cat-${a.category}`} />
              <span className="algorithm-name">{a.name}</span>
              <span className="algorithm-cat">{CATEGORY_LABEL[a.category]}</span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="micro-copy">No algorithms match “{search}”.</p> : null}
        </div>
      </Section>

      <div className="algo-detail">
        <div className="algo-detail-head">
          <strong>{selected.name}</strong>
          <Badge tone={selected.category === 'none' ? 'neutral' : 'accent'}>{CATEGORY_LABEL[selected.category]}</Badge>
        </div>
        <p>{selected.description}</p>
        {selected.credits?.length ? <p className="credit-line">Credit: {selected.credits.join(' · ')}</p> : null}
      </div>

      {selected.category !== 'none' ? (
        <Section title="Parameters">
          <Field node={node} path="dither.strength" label="Strength" min={0} max={1} step={0.01} defaultValue={DEFAULT_DITHER.strength} />
          <Field
            node={node}
            path="dither.scale"
            label="Pattern scale"
            min={0.5}
            max={6}
            step={0.25}
            unit="art px"
            defaultValue={DEFAULT_DITHER.scale}
            hint="Scales the dither matrix in art pixels. Keeps the texture proportional across resolutions."
          />
          {selected.category === 'diffusion' ? (
            <Toggle label="Serpentine scan" checked={dither.serpentine} onChange={(v) => set({ serpentine: v })} />
          ) : null}
          <SelectField
            label="Colour space"
            value={dither.colorSpace}
            options={[
              { value: 'oklab', label: 'OKLab (perceptual)' },
              { value: 'linear', label: 'Linear RGB' },
              { value: 'srgb', label: 'sRGB' },
            ]}
            onChange={(v) => set({ colorSpace: v as DitherSettings['colorSpace'] })}
          />
          <Field node={node} path="dither.threshold" label="Threshold bias" min={-1} max={1} step={0.01} defaultValue={DEFAULT_DITHER.threshold} />
          <Field node={node} path="dither.seed" label="Seed" min={0} max={9999} step={1} defaultValue={DEFAULT_DITHER.seed} />
        </Section>
      ) : (
        <div className="info-callout">
          <Icon name="sparkles" size={16} />
          <span>No dithering: colours snap directly to the nearest palette entry. Use a small palette for hard poster art.</span>
        </div>
      )}

      <Section title="Source credit" defaultOpen={false}>
        <p className="micro-copy">
          Algorithm catalog inspired by <strong>Ditherista</strong> by Robert Kist (MIT) and the classic
          literature: Bayer, Floyd–Steinberg, Ulichney, Riemersma, Yliluoma. Implementations are original
          TypeScript. See CREDITS.md.
        </p>
      </Section>
    </div>
  );
}
