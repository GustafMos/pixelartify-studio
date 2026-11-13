import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPreset, serializePreset } from '../../core';
import { useStudio } from '../store';
import { presetCpuSummary } from '../bottlenecks';
import { downloadText } from '../io';
import { Badge, IconButton, Modal, TextArea, TextField } from './controls';
import { Icon } from './icons';

export function TopBar(): React.ReactElement {
  const {
    mode,
    setMode,
    presets,
    applyPreset,
    newCleanSlate,
    savePreset,
    deletePreset,
    importPresetFile,
    exportPresetFile,
    graph,
    graphErrors,
    undo,
    redo,
    canUndo,
    canRedo,
    notify,
    userPresets,
  } = useStudio();
  const [presetOpen, setPresetOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [name, setName] = useState('My RipScorpy Look');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const filtered = presets.filter((p) => {
    const q = search.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.tags?.some((t) => t.includes(q));
  });

  const presetWarnings = useMemo(() => {
    const map = new Map<string, ReturnType<typeof presetCpuSummary>>();
    for (const preset of presets) map.set(preset.id, presetCpuSummary(preset.graph));
    return map;
  }, [presets]);

  useEffect(() => {
    const onSave = (): void => setSaveOpen(true);
    window.addEventListener('pixelartify:save-preset', onSave);
    return () => window.removeEventListener('pixelartify:save-preset', onSave);
  }, []);

  const handleSave = (exportAfter: boolean): void => {
    const preset = savePreset(name, description);
    if (preset && exportAfter) exportPresetFile(preset);
    if (preset) setSaveOpen(false);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <img src="./ripscorpy-logo.png" alt="RipScorpy" draggable={false} />
        </span>
        <div className="brand-copy">
          <strong>RipScorpy</strong>
          <span>MEDIA SUITE</span>
        </div>
      </div>

      <div className="mode-switch">
        <button type="button" className={mode === 'studio' ? 'is-active' : ''} onClick={() => setMode('studio')}>
          <Icon name="image" size={15} /> Studio
        </button>
        <button type="button" className={mode === 'split' ? 'is-active' : ''} onClick={() => setMode('split')}>
          <Icon name="split" size={15} /> Split
        </button>
        <button type="button" className={mode === 'graph' ? 'is-active' : ''} onClick={() => setMode('graph')}>
          <Icon name="graph" size={15} /> Node graph
        </button>
      </div>

      <div className="preset-bar">
        <button type="button" className={`preset-trigger ${presetOpen ? 'is-open' : ''}`} onClick={() => setPresetOpen((v) => !v)}>
          <Icon name="sparkles" size={15} />
          <span>Presets</span>
          <Badge>{presets.length}</Badge>
          <Icon name="chevron" size={13} />
        </button>
        <button type="button" className="ghost-btn small" onClick={() => setSaveOpen(true)}>
          <Icon name="save" size={14} /> Save preset
        </button>
        <button type="button" className="ghost-btn small" onClick={() => newCleanSlate()} title="Start a clean graph: Media input → Output, no processing.">
          <Icon name="plus" size={14} /> Clean slate
        </button>
        {presetOpen ? (
          <div className="preset-popover" onMouseLeave={() => setPresetOpen(false)}>
            <div className="preset-search">
              <Icon name="search" size={14} />
              <input
                autoFocus
                placeholder="Search presets…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="preset-list">
              {filtered.map((preset) => {
                const isUser = userPresets.some((p) => p.id === preset.id);
                const cpu = presetWarnings.get(preset.id);
                return (
                  <div key={preset.id} className="preset-row">
                    <button
                      type="button"
                      className="preset-main"
                      onClick={() => {
                        applyPreset(preset);
                        setPresetOpen(false);
                      }}
                    >
                      <span className="preset-thumb">
                        {preset.thumbnail ? <img src={preset.thumbnail} alt="" /> : <Icon name="sparkles" size={18} />}
                      </span>
                      <span className="preset-meta">
                        <strong>
                          {preset.name}
                          {cpu ? (
                            <span className="preset-warning" title={cpu.detail}>
                              !
                            </span>
                          ) : null}
                        </strong>
                        <small>{preset.description}</small>
                        {preset.tags?.length ? (
                          <span className="preset-tags">
                            {preset.tags.slice(0, 3).map((t) => (
                              <em key={t}>{t}</em>
                            ))}
                          </span>
                        ) : null}
                        {cpu ? <span className="preset-cpu">CPU: {cpu.short}</span> : null}
                      </span>
                    </button>
                    <div className="preset-actions">
                      <IconButton
                        icon="download"
                        label="Export preset"
                        size={14}
                        onClick={() => exportPresetFile(preset)}
                      />
                      {isUser ? (
                        <IconButton icon="trash" label="Delete preset" size={14} danger onClick={() => deletePreset(preset.id)} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 ? <p className="micro-copy">No presets match.</p> : null}
            </div>
            <p className="preset-cpu-legend">
              <span className="preset-warning">!</span> uses CPU-heavy stages at the current settings
            </p>
            <div className="preset-footer">
              <button type="button" className="ghost-btn small" onClick={() => importRef.current?.click()}>
                <Icon name="upload" size={14} /> Import preset
              </button>
              <button type="button" className="ghost-btn small" onClick={() => setSaveOpen(true)}>
                <Icon name="save" size={14} /> Save current
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        {graphErrors.length > 0 ? (
          <span className="graph-error-pill" title={graphErrors.map((e) => e.message).join('\n')}>
            <Icon name="close" size={13} /> {graphErrors.length} issue{graphErrors.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="graph-ok-pill">
            <Icon name="check" size={13} /> graph ready
          </span>
        )}
        <IconButton icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        <IconButton icon="settings" label="About & credits" onClick={() => setAboutOpen(true)} />
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            const name = 'My Look';
            const preset = createPreset(name, graph);
            downloadText(serializePreset(preset), 'pixelartify-graph.json');
            notify('Graph exported as a preset.', 'success');
          }}
        >
          <Icon name="download" size={15} /> Export graph
        </button>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await importPresetFile(file);
        }}
      />

      <Modal
        open={saveOpen}
        title="Save preset"
        subtitle="Saves the full node graph, palette, dithering and output configuration."
        onClose={() => setSaveOpen(false)}
        footer={
          <>
            <button type="button" className="ghost-btn" onClick={() => setSaveOpen(false)}>
              Cancel
            </button>
            <button type="button" className="ghost-btn" onClick={() => handleSave(true)}>
              <Icon name="download" size={14} /> Save & export
            </button>
            <button type="button" className="primary-btn" onClick={() => handleSave(false)}>
              <Icon name="save" size={14} /> Save preset
            </button>
          </>
        }
      >
        <TextField label="Preset name" value={name} onChange={setName} />
        <TextArea
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What is this look for? Which game or asset set?"
          rows={3}
        />
        <div className="preset-summary">
          <Badge tone="accent">{graph.nodes.length} nodes</Badge>
          <Badge>{graph.edges.length} connections</Badge>
          <Badge>{graph.nodes.filter((n) => n.type === 'output').length} outputs</Badge>
        </div>
      </Modal>

      <Modal
        open={aboutOpen}
        title="RipScorpy Media Processing Suite"
        subtitle="MIT-licensed, local-first pixel art conversion."
        onClose={() => setAboutOpen(false)}
        wide
      >
        <div className="about-grid">
          <div>
            <h3>What it does</h3>
            <p>
              Edge-aware pixelation with a canonical working resolution, palette extraction and harmony tools,
              29 dithering algorithms, feature extraction, layer inpainting, crop/resize and channel routing,
              video and spritesheet export. All processing happens locally in your browser.
            </p>
            <h3>Credits & references</h3>
            <ul className="credit-list">
              <li>
                <strong>pixel-mosaic</strong> by Yogthos (MIT) — edge-aware grid alignment and feature-preserving
                downscaling inspiration. <a href="https://github.com/yogthos/pixel-mosaic" target="_blank" rel="noreferrer">GitHub</a>
              </li>
              <li>
                <strong>Ditherista / libdither</strong> by Robert Kist (MIT/BSD) — dithering method catalog and
                colour-matching inspiration. <a href="https://github.com/robertkist/ditherista" target="_blank" rel="noreferrer">GitHub</a>
              </li>
              <li>
                <strong>Mediabunny</strong> (MPL-2.0) — WebCodecs video demuxing, decoding and muxing.
              </li>
              <li>
                <strong>OKLab</strong> by Björn Ottosson (MIT) — perceptual colour space.
              </li>
              <li>
                <strong>Kuwahara</strong> (1976), <strong>Bayer</strong> (1973), <strong>Floyd–Steinberg</strong>{' '}
                (1976), <strong>Ulichney</strong> (1993), <strong>Riemersma</strong> (1998),{' '}
                <strong>Yliluoma</strong> (2009) — algorithms referenced.
              </li>
              <li>
                Palette data: PICO-8 (Lexaloffle), Sweetie 16 (GrafxKid), Endesga 32, DawnBringer 16, CGA,
                Game Boy DMG. See CREDITS.md for links.
              </li>
              <li>
                React, Vite, fflate, TypeScript and the open-source ecosystem. Adobe Color inspired the harmony
                panel; this project is not affiliated with Adobe.
              </li>
            </ul>
          </div>
          <div>
            <h3>Keyboard</h3>
            <div className="shortcut-grid">
              <span>Undo / redo</span>
              <kbd>Ctrl Z</kbd>
              <kbd>Ctrl ⇧ Z</kbd>
              <span>Switch Studio / Graph</span>
              <kbd>G</kbd>
              <span>Save preset</span>
              <kbd>Ctrl S</kbd>
              <span>Export current image</span>
              <kbd>Ctrl E</kbd>
              <span>Delete selected node</span>
              <kbd>Del</kbd>
              <span>Pan canvas</span>
              <kbd>Drag</kbd>
              <span>Zoom</span>
              <kbd>Wheel</kbd>
            </div>
            <h3>License</h3>
            <p>
              RipScorpy Media Processing Suite is released under the MIT License. Third-party dependencies retain their own
              licenses; see <code>THIRD_PARTY_NOTICES.md</code> and <code>CREDITS.md</code>.
            </p>
            <p className="micro-copy">
              Version 0.1.0 · source available on GitHub as{' '}
              <a href="https://github.com/GustafMos/rsmps" target="_blank" rel="noreferrer">
                <strong>RipScorpy Media Processing Suite</strong>
              </a>
              .
            </p>
          </div>
        </div>
      </Modal>
    </header>
  );
}
