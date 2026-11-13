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
 * Standalone viewer window (opened via `?viewer=1`). Receives frames and
 * playback state from the opener via postMessage, and sends play/pause/seek
 * controls back. The image is auto-fit with pixelated rendering.
 */
export function PopupViewer(): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
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
        setSrc(typeof d.url === 'string' ? d.url : null);
        setSize({ width: Number(d.width) || 0, height: Number(d.height) || 0 });
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
        {src ? (
          <img src={src} alt="" draggable={false} />
        ) : (
          <div className="popup-empty">
            <span>Waiting for preview…</span>
            <small>{size.width ? `${size.width} × ${size.height}` : 'Open a graph in the main window.'}</small>
          </div>
        )}
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
