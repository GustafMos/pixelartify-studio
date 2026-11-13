import React, { useEffect, useRef, useState } from 'react';

interface PlaybackState {
  playing: boolean;
  time: number;
  duration: number;
  hasTimeline: boolean;
  loop: boolean;
  fps: number;
  isVideo: boolean;
}

/**
 * Standalone viewer window (opened via `?viewer=1`). Receives raw RGBA frames
 * and playback state from the opener via postMessage, and sends play/pause/seek
 * controls back. Frames are drawn straight to a canvas (no re-encoding).
 */
export function PopupViewer(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pb, setPb] = useState<PlaybackState>({
    playing: false,
    time: 0,
    duration: 0,
    hasTimeline: false,
    loop: false,
    fps: 24,
    isVideo: false,
  });
  const pbRef = useRef(pb);
  pbRef.current = pb;

  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'art') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const w = Number(d.width) || 0;
        const h = Number(d.height) || 0;
        if (w <= 0 || h <= 0) return;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = ctx.createImageData(w, h);
        img.data.set(new Uint8ClampedArray(d.data as ArrayBuffer | number[]));
        ctx.putImageData(img, 0, 0);
        setSize({ width: w, height: h });
      } else if (d.type === 'playback') {
        setPb({
          playing: Boolean(d.playing),
          time: Number(d.time) || 0,
          duration: Number(d.duration) || 0,
          hasTimeline: Boolean(d.hasTimeline),
          loop: Boolean(d.loop),
          fps: Number(d.fps) || 24,
          isVideo: Boolean(d.isVideo),
        });
      }
    };
    window.addEventListener('message', onMsg);
    window.opener?.postMessage({ type: 'ready' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const send = (msg: Record<string, unknown>): void => {
    window.opener?.postMessage(msg, '*');
  };

  return (
    <div className="popup-viewer">
      <div className="popup-stage">
        {size.width > 0 ? null : (
          <div className="popup-empty">
            <span>Waiting for preview…</span>
            <small>Open a graph in the main window.</small>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="popup-canvas"
          style={{ opacity: size.width > 0 ? 1 : 0 }}
          aria-label="Pixel art preview"
        />
      </div>

      {pb.hasTimeline ? (
        <div className="popup-playbar">
          <button
            type="button"
            className="popup-play"
            onClick={() => send({ type: 'control', action: 'toggle' })}
            title={pb.playing ? 'Pause' : 'Play'}
          >
            {pb.playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, pb.duration)}
            step={1 / Math.max(1, pb.fps)}
            value={Math.min(pb.time, Math.max(0.01, pb.duration))}
            onChange={(e) => send({ type: 'control', action: 'seek', time: Number(e.target.value) })}
            aria-label="Timeline"
          />
          <span className="popup-time">
            {pb.time.toFixed(2)} / {pb.duration > 0 ? pb.duration.toFixed(2) : '∞'} s
          </span>
          <span className="popup-badge">{pb.isVideo ? 'video' : 'anim'} · {pb.fps} fps</span>
        </div>
      ) : null}
    </div>
  );
}
