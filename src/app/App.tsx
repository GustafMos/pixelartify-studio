import React, { useEffect } from 'react';
import { useStudio } from './store';
import { TopBar } from './components/TopBar';
import { AssetRail } from './components/AssetRail';
import { GraphCanvas } from './components/GraphCanvas';
import { Inspector } from './components/Inspector';
import { Viewer } from './components/Viewer';
import { SplitView } from './components/SplitView';
import { PaletteStudio } from './components/PaletteStudio';
import { Toasts } from './components/Toasts';
import { Icon } from './components/icons';
import { Badge } from './components/controls';

export function App(): React.ReactElement {
  const {
    mode,
    setMode,
    activeAsset,
    preview,
    selectedNode,
    selectedNodeId,
    deleteNode,
    undo,
    redo,
    exportCurrent,
    setSelectedOutput,
    selectedOutputId,
    setMaskOverride,
    notify,
    isRendering,
    graphErrors,
    evaluation,
  } = useStudio();

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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pixelartify:save-preset'));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void exportCurrent();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key.toLowerCase() === 'g') {
          e.preventDefault();
          setMode(mode === 'studio' ? 'split' : mode === 'split' ? 'graph' : 'studio');
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
          e.preventDefault();
          deleteNode(selectedNodeId);
          notify('Node deleted. Ctrl+Z to undo.', 'info');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteNode, exportCurrent, mode, notify, redo, selectedNodeId, setMode, undo]);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <AssetRail />
        <main className="main-area">
          {mode === 'studio' ? <Viewer /> : mode === 'graph' ? <GraphCanvas /> : <SplitView />}
        </main>
        <Inspector />
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className={`status-light ${isRendering ? 'is-busy' : ''}`} />
          <span>{isRendering ? 'Rendering' : 'Ready'}</span>
          <span className="status-sep" />
          <span className="status-file">{activeAsset?.name ?? 'No media'}</span>
          {activeAsset ? (
            <span className="status-meta">
              {activeAsset.width}×{activeAsset.height}
              {activeAsset.kind === 'video' ? ' · video' : ' · image'}
            </span>
          ) : null}
        </div>
        <div className="status-right">
          {selectedNode ? (
            <>
              <Icon name="node" size={12} />
              <span>{selectedNode.title}</span>
              <span className="status-sep" />
            </>
          ) : null}
          {preview ? (
            <>
              <Badge tone="accent">
                {preview.size.width}×{preview.size.height}
              </Badge>
              <span className="status-meta">
                {preview.palette.length ? `${preview.palette.length} colours` : 'free colour'}
              </span>
              <span className="status-meta">{preview.stats.durationMs.toFixed(0)} ms</span>
            </>
          ) : null}
          <span className="status-sep" />
          <span className="status-meta">
            {evaluation.errors.length + graphErrors.length === 0
              ? 'graph ok'
              : `${evaluation.errors.length + graphErrors.length} warning(s)`}
          </span>
          <span className="status-version">PixelArtify Studio 0.1.0</span>
        </div>
      </footer>

      <PaletteStudio />
      <Toasts />
    </div>
  );
}
