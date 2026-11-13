import React, { useCallback, useRef } from 'react';
import type { GraphNode } from '../../core/types';
import { DEFAULT_TRANSFORM, type TransformParams } from '../../core/transform';
import { getPath, setPath } from '../../core/value';
import { useStudio } from '../store';

/**
 * On-canvas transform gizmo shown while a Transform node is selected.
 * Drag the box to move, the corner to scale, and the handle above to rotate.
 * The box is positioned in art-pixel space (the `.art-wrapper` maps 1:1).
 */
export function TransformGizmo({
  node,
  artW,
  artH,
  zoom,
}: {
  node: GraphNode;
  artW: number;
  artH: number;
  zoom: number;
}): React.ReactElement | null {
  const { updateNodeParams } = useStudio();
  const dragRef = useRef<{ mode: 'move' | 'scale' | 'rotate'; startX: number; startY: number } | null>(null);

  const p: TransformParams = { ...DEFAULT_TRANSFORM, ...(node.params as Partial<TransformParams>) };
  const x = p.unit === 'normalized' ? p.x * artW : p.x;
  const y = p.unit === 'normalized' ? p.y * artH : p.y;
  const boxW = Math.max(2, artW * p.scaleX);
  const boxH = Math.max(2, artH * p.scaleY);
  const cx = artW / 2 + x;
  const cy = artH / 2 + y;

  const set = useCallback(
    (patch: Record<string, unknown>): void =>
      updateNodeParams(node.id, patch as Record<string, unknown>),
    [node.id, updateNodeParams],
  );

  const write = useCallback(
    (path: string, value: number): void => {
      updateNodeParams(node.id, setPath(node.params, path, value) as Record<string, unknown>);
    },
    [node.id, node.params, updateNodeParams],
  );

  const begin = (mode: 'move' | 'scale' | 'rotate') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is optional.
    }
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY };
  };

  const move = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / Math.max(0.1, zoom);
    const dy = (e.clientY - drag.startY) / Math.max(0.1, zoom);

    if (drag.mode === 'move') {
      if (p.unit === 'normalized') {
        write('x', Math.max(-1, Math.min(1, (getNum(node, 'x') ?? 0) + dx / artW)));
        write('y', Math.max(-1, Math.min(1, (getNum(node, 'y') ?? 0) + dy / artH)));
      } else {
        write('x', (getNum(node, 'x') ?? 0) + dx);
        write('y', (getNum(node, 'y') ?? 0) + dy);
      }
    } else if (drag.mode === 'scale') {
      const startScale = p.scaleX || 1;
      const next = Math.max(0.05, startScale * (1 + (dx + dy) / Math.max(1, (artW + artH) / 2)));
      write('scaleX', next);
      write('scaleY', next);
    } else {
      const angle = Math.atan2(e.clientY - drag.startY, e.clientX - drag.startX) * (180 / Math.PI);
      const rotation = ((p.rotation ?? 0) + angle - 90 + 360) % 360;
      write('rotation', rotation > 180 ? rotation - 360 : rotation);
    }
  };

  const end = (): void => {
    dragRef.current = null;
  };

  const left = ((cx - boxW / 2) / artW) * 100;
  const top = ((cy - boxH / 2) / artH) * 100;
  const width = (boxW / artW) * 100;
  const height = (boxH / artH) * 100;

  return (
    <>
      <div
        className="transform-gizmo-box"
        style={{
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
          transform: `rotate(${p.rotation ?? 0}deg)`,
        }}
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="transform-gizmo-label">Transform</span>
        <i className="transform-gizmo-corner" data-handle="scale" onPointerDown={begin('scale')} />
        <i className="transform-gizmo-rotate" data-handle="rotate" onPointerDown={begin('rotate')} />
      </div>
    </>
  );
}

function getNum(node: GraphNode, path: string): number | undefined {
  const v = getPath(node.params, path);
  return Number.isFinite(Number(v)) ? Number(v) : undefined;
}
