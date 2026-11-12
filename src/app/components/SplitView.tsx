import React, { useEffect, useRef, useState } from 'react';
import { Viewer } from './Viewer';
import { GraphCanvas } from './GraphCanvas';
import { Icon } from './icons';

/**
 * Blender-style split workspace: the output preview on top, the node graph
 * below. Drag the divider to resize.
 */
export function SplitView(): React.ReactElement {
  const [ratio, setRatio] = useState(0.42);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent): void => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = (e.clientY - rect.top) / Math.max(1, rect.height);
      setRatio(Math.max(0.2, Math.min(0.8, next)));
    };
    const onUp = (): void => setResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing]);

  return (
    <div ref={containerRef} className={`split-view ${resizing ? 'is-resizing' : ''}`}>
      <section className="split-pane" style={{ height: `${ratio * 100}%` }}>
        <header className="split-pane-head">
          <Icon name="image" size={13} />
          <strong>Viewer</strong>
          <span>output preview</span>
        </header>
        <div className="split-pane-body">
          <Viewer resizeKey={ratio} />
        </div>
      </section>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize viewer and node graph"
        onPointerDown={(e) => {
          e.preventDefault();
          setResizing(true);
        }}
      >
        <span />
      </div>
      <section className="split-pane split-pane-grow">
        <header className="split-pane-head">
          <Icon name="graph" size={13} />
          <strong>Node graph</strong>
          <span>drag ports or use the Connections panel</span>
        </header>
        <div className="split-pane-body">
          <GraphCanvas />
        </div>
      </section>
    </div>
  );
}
