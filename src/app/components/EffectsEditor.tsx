import React, { useMemo, useState } from 'react';
import type { PostprocessOp, PostprocessType, PreprocessOp, PreprocessType } from '../../core/types';
import {
  POSTPROCESS_BY_TYPE,
  POSTPROCESS_DEFS,
  PREPROCESS_BY_TYPE,
  PREPROCESS_DEFS,
  createPostprocessOp,
  createPreprocessOp,
  type EffectDefinition,
} from '../../core/preprocess';
import { ColorField, IconButton, Section, Slider } from './controls';
import { Icon } from './icons';

type AnyOp = PreprocessOp | PostprocessOp;

export function EffectsEditor<T extends PreprocessType | PostprocessType>({
  stage,
  ops,
  onChange,
}: {
  stage: 'pre' | 'post';
  ops: AnyOp[];
  onChange: (ops: AnyOp[]) => void;
}): React.ReactElement {
  const defs = (stage === 'pre' ? PREPROCESS_DEFS : POSTPROCESS_DEFS) as EffectDefinition<T>[];
  const byType = (stage === 'pre' ? PREPROCESS_BY_TYPE : POSTPROCESS_BY_TYPE) as Record<
    T,
    EffectDefinition<T>
  >;
  const [addType, setAddType] = useState<T>(defs[0].type);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, EffectDefinition<T>[]>();
    for (const def of defs) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return [...map.entries()];
  }, [defs]);

  const update = (id: string, patch: Partial<AnyOp>): void => {
    onChange(ops.map((op) => (op.id === id ? ({ ...op, ...patch } as AnyOp) : op)));
  };

  const updateParam = (id: string, key: string, value: number): void => {
    onChange(
      ops.map((op) =>
        op.id === id ? ({ ...op, params: { ...op.params, [key]: value } } as AnyOp) : op,
      ),
    );
  };

  const add = (): void => {
    const op = stage === 'pre' ? createPreprocessOp(addType as PreprocessType) : createPostprocessOp(addType as PostprocessType);
    onChange([...ops, op as AnyOp]);
    setExpanded((prev) => ({ ...prev, [op.id]: true }));
  };

  const move = (index: number, dir: -1 | 1): void => {
    const next = [...ops];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="effects-editor">
      <div className="effect-add-row">
        <select value={addType} onChange={(e) => setAddType(e.target.value as T)} aria-label="Effect type">
          {grouped.map(([category, list]) => (
            <optgroup key={category} label={category}>
              {list.map((def) => (
                <option key={def.type} value={def.type}>
                  {def.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" className="primary-btn small" onClick={add}>
          <Icon name="plus" size={14} /> Add effect
        </button>
      </div>

      {ops.length === 0 ? (
        <div className="inline-empty">
          <Icon name={stage === 'pre' ? 'wand' : 'sparkles'} size={18} />
          <span>No {stage === 'pre' ? 'pre-processing' : 'post-processing'} effects yet.</span>
        </div>
      ) : null}

      <div className="effect-stack">
        {ops.map((op, index) => {
          const def = byType[op.type as T];
          if (!def) return null;
          const isOpen = expanded[op.id] ?? true;
          return (
            <div key={op.id} className={`effect-card ${op.enabled ? '' : 'is-disabled'}`}>
              <div className="effect-head">
                <button
                  type="button"
                  className="effect-toggle"
                  onClick={() => setExpanded((prev) => ({ ...prev, [op.id]: !isOpen }))}
                  title={def.description}
                >
                  <Icon name="chevron" size={13} className={isOpen ? 'rot-0' : 'rot-90'} />
                  <strong>{def.title}</strong>
                </button>
                <div className="effect-actions">
                  <IconButton
                    icon={op.enabled ? 'eye' : 'eyeOff'}
                    label={op.enabled ? 'Disable effect' : 'Enable effect'}
                    active={op.enabled}
                    onClick={() => update(op.id, { enabled: !op.enabled })}
                    size={14}
                  />
                  <IconButton icon="chevron" label="Move up" onClick={() => move(index, -1)} size={14} />
                  <IconButton icon="chevron" label="Move down" onClick={() => move(index, 1)} size={14} />
                  <IconButton
                    icon="trash"
                    label="Remove effect"
                    danger
                    onClick={() => onChange(ops.filter((o) => o.id !== op.id))}
                    size={14}
                  />
                </div>
              </div>
              {isOpen ? (
                <div className="effect-body">
                  <p className="effect-desc">{def.description}</p>
                  {def.params.map((param) => (
                    <Slider
                      key={param.key}
                      label={param.label}
                      value={op.params[param.key] ?? param.default}
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      unit={param.unit}
                      hint={param.hint}
                      onChange={(value) => updateParam(op.id, param.key, value)}
                    />
                  ))}
                  {def.colorParam ? (
                    <ColorField
                      label="Outline colour"
                      value={op.color ?? '#101018'}
                      onChange={(color) => update(op.id, { color })}
                    />
                  ) : null}
                  {def.credits ? (
                    <p className="credit-line">Reference: {def.credits.join(' · ')}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
