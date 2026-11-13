import React, { useEffect, useRef, useState } from 'react';

const CHANNEL_NAME = 'pixelartify-viewer';

let sendChannel: BroadcastChannel | null = null;

function send(msg: Record<string, unknown>): void {
  try {
    if (!sendChannel) sendChannel = new BroadcastChannel(CHANNEL_NAME);
    sendChannel.postMessage(msg);
  } catch {
    // Ignore.
  }
}

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
 * and playback state over a BroadcastChannel, and sends play/pause/seek controls
 * back the same way. Frames are drawn straight to a canvas (no re-encoding).
 */
export function PopupViewer(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [connected, setConnected] = useState(false);
  const [pb, setPb] = useState<PlaybackState>({
    playing: false,
    time: 0,
    duration: 0,
    hasTimeline: false,
    loop: false,
    fps: 24,
    isVideo: false,
  });

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return;
    }

    let readyTimer = 0;
    const sendReady = (): void => channel?.postMessage({ type: 'ready' });

    const onMsg = (e: MessageEvent): void => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'art') {
        const canvas = canvasRef.current;
        const w = Number(d.width) || 0;
        const h = Number(d.height) || 0;
        if (!canvas || w <= 0 || h <= 0) return;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = ctx.createImageData(w, h);
        img.data.set(new Uint8ClampedArray(d.data as ArrayBuffer | number[]));
        ctx.putImageData(img, 0, 0);
        setSize({ width: w, height: h });
        setConnected(true);
        if (readyTimer) {
          window.clearInterval(readyTimer);
          readyTimer = 0;
        }
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

    channel.addEventListener('message', onMsg);
    sendReady();
    // Poll until a frame arrives so an early "ready" (before the opener has
    // subscribed) is never lost.
    readyTimer = window.setInterval(sendReady, 400);

    return () => {
      if (readyTimer) window.clearInterval(readyTimer);
      channel?.removeEventListener('message', onMsg);
      channel?.close();
    };
  }, []);

  return (
    <div className="popup-viewer">
      <div className="popup-stage">
        {!connected ? (
          <div className="popup-empty">
            <span>Waiting for preview…</span>
            <small>{size.width ? `${size.width} × ${size.height}` : 'Open a graph in the main window.'}</small>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="popup-canvas"
          style={{ opacity: connected ? 1 : 0 }}
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
