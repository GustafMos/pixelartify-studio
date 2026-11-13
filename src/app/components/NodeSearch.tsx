import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNodeType } from '../../core/types';
import { NODE_DEFS } from '../../core/graph';
import { PREPROCESS_DEFS, POSTPROCESS_DEFS, createPreprocessOp, createPostprocessOp } from '../../core/preprocess';
import { DEFAULT_REGION } from '../../core/region';
import { deepClone } from '../../core/defaults';
import { useStudio } from '../store';
import { TYPE_ICON } from './GraphCanvas';
import { Icon } from './icons';

const ALL_TYPES: GraphNodeType[] = (Object.keys(NODE_DEFS) as GraphNodeType[]).filter(
  (type) => type !== 'group',
);

interface EffectEntry {
  key: string;
  stage: 'pre' | 'post';
  effectType: string;
  title: string;
  description: string;
}

const EFFECT_ENTRIES: EffectEntry[] = [
  ...PREPROCESS_DEFS.map((d) => ({
    key: `pre:${d.type}`,
    stage: 'pre' as const,
    effectType: d.type,
    title: d.title,
    description: d.description,
  })),
  ...POSTPROCESS_DEFS.map((d) => ({
    key: `post:${d.type}`,
    stage: 'post' as const,
    effectType: d.type,
    title: d.title,
    description: d.description,
  })),
];

function matches(type: GraphNodeType, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const def = NODE_DEFS[type];
  return (
    def.title.toLowerCase().includes(q) ||
    def.description.toLowerCase().includes(q) ||
    type.includes(q)
  );
}

function effectMatches(entry: EffectEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.title.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.effectType.toLowerCase().includes(q)
  );
}

/**
 * Command palette for adding nodes. Shift+Space opens it, recently used node
 * types float to the top, the new node is added at the cursor (or after the
 * selected node), and individual effects can be added pre-configured.
 */
export function NodeSearch(): React.ReactElement | null {
  const { addNode, recentNodeTypes, selectedNode } = useStudio();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;
      if (e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        setOpen(true);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const filtered = useMemo(() => ALL_TYPES.filter((type) => matches(type, query)), [query]);
  const matchedEffects = useMemo(() => EFFECT_ENTRIES.filter((e) => effectMatches(e, query)), [query]);
  const recent = useMemo(
    () =>
      recentNodeTypes
        .filter((type) => filtered.includes(type))
        .filter((type, i, arr) => arr.indexOf(type) === i)
        .slice(0, 5),
    [recentNodeTypes, filtered],
  );
  const rest = useMemo(() => filtered.filter((type) => !recent.includes(type)), [filtered, recent]);
  const ordered = useMemo(() => [...recent, ...rest], [recent, rest]);

  // Flat list of selectable rows (nodes then effects) for keyboard navigation.
  const rowCount = ordered.length + matchedEffects.length;

  useEffect(() => {
    if (!open) return;
    const row = document.querySelector(`.node-search-row[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (type: GraphNodeType): void => {
    addNode(type);
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const chooseEffect = (entry: EffectEntry): void => {
    const isPre = entry.stage === 'pre';
    const op = isPre
      ? createPreprocessOp(entry.effectType as Parameters<typeof createPreprocessOp>[0])
      : createPostprocessOp(entry.effectType as Parameters<typeof createPostprocessOp>[0]);
    const params = isPre
      ? { ops: [op], region: deepClone(DEFAULT_REGION) }
      : { postprocess: { ops: [op], lockPalette: false }, region: deepClone(DEFAULT_REGION) };
    addNode(isPre ? 'preprocess' : 'postprocess', undefined, undefined, params);
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  if (!open) return null;

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rowCount === 0 ? 0 : (i + 1) % rowCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nodeType = ordered[active];
      if (nodeType) {
        choose(nodeType);
        return;
      }
      const entry = matchedEffects[active - ordered.length];
      if (entry) chooseEffect(entry);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const row = (type: GraphNodeType, index: number): React.ReactElement => {
    const def = NODE_DEFS[type];
    return (
      <button
        key={type}
        type="button"
        data-index={index}
        className={`node-search-row ${index === active ? 'is-active' : ''}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(type)}
      >
        <span className="node-search-icon" style={{ color: def.accent }}>
          <Icon name={TYPE_ICON[type]} size={16} />
        </span>
        <span className="node-search-copy">
          <strong>{def.title}</strong>
          <small>{def.description}</small>
        </span>
      </button>
    );
  };

  const effectRow = (entry: EffectEntry, index: number): React.ReactElement => (
    <button
      key={entry.key}
      type="button"
      data-index={index}
      className={`node-search-row ${index === active ? 'is-active' : ''}`}
      onMouseEnter={() => setActive(index)}
      onClick={() => chooseEffect(entry)}
    >
      <span className="node-search-icon" style={{ color: entry.stage === 'pre' ? '#f72585' : '#ef476f' }}>
        <Icon name="wand" size={16} />
      </span>
      <span className="node-search-copy">
        <strong>{entry.title}</strong>
        <small>{entry.stage === 'pre' ? 'Pre-process effect' : 'Post-process effect'} · {entry.description}</small>
      </span>
    </button>
  );

  return (
    <div
      className="node-search-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="node-search-panel" role="dialog" aria-label="Add node">
        <div className="node-search-input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search nodes or effects…"
            aria-label="Search nodes"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="node-search-context">
          {selectedNode ? `Add after “${selectedNode.title}”` : 'Add at cursor'}
          <span>· ↑↓ navigate · Enter add</span>
        </div>
        <div className="node-search-list">
          {recent.length > 0 ? (
            <>
              <div className="node-search-group">Recently used</div>
              {recent.map((type, i) => row(type, i))}
            </>
          ) : null}
          <div className="node-search-group">Nodes</div>
          {rest.length > 0 ? (
            rest.map((type, i) => row(type, recent.length + i))
          ) : (
            <div className="node-search-empty">No nodes match “{query}”.</div>
          )}
          {matchedEffects.length > 0 ? (
            <>
              <div className="node-search-group">Effects (pre-configured)</div>
              {matchedEffects.map((entry, i) => effectRow(entry, ordered.length + i))}
            </>
          ) : null}
          {rest.length === 0 && matchedEffects.length === 0 ? (
            <div className="node-search-empty">No matches for “{query}”.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
