/**
 * Pop-out viewer: opens the live preview in a separate browser window (the app
 * served at `?viewer=1`). Frames, playback state and controls travel over a
 * BroadcastChannel, which is reliable across same-origin windows without
 * depending on the opener relationship.
 */

import type { PixelImage } from '../core/types';

const CHANNEL_NAME = 'pixelartify-viewer';

let viewerWindow: Window | null = null;
let channel: BroadcastChannel | null = null;
let lastArtPush = 0;

function getChannel(): BroadcastChannel {
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export interface ViewerPlaybackState {
  playing: boolean;
  time: number;
  duration: number;
  hasTimeline: boolean;
  loop: boolean;
  fps: number;
  isVideo: boolean;
}

export function isViewerWindowOpen(): boolean {
  return Boolean(viewerWindow && !viewerWindow.closed);
}

export function toggleViewerWindow(): boolean {
  if (viewerWindow && !viewerWindow.closed) {
    viewerWindow.close();
    viewerWindow = null;
    return false;
  }
  const url = `${window.location.origin}${window.location.pathname}?viewer=1`;
  const win = window.open(
    url,
    'pixelartify-viewer',
    'width=760,height=560,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
  );
  if (!win) return false;
  viewerWindow = win;
  lastArtPush = 0;
  return true;
}

/** Push a rendered frame to the popup. Cheap no-op when the window is closed. */
export function postArtToViewer(image: PixelImage): void {
  if (!viewerWindow || viewerWindow.closed) {
    viewerWindow = null;
    return;
  }
  const now = performance.now();
  if (now - lastArtPush < 33) return; // throttle to ~30 fps
  lastArtPush = now;
  try {
    getChannel().postMessage({ type: 'art', width: image.width, height: image.height, data: image.data });
  } catch {
    // Ignore transient errors.
  }
}

export function postPlaybackToViewer(state: ViewerPlaybackState): void {
  if (!viewerWindow || viewerWindow.closed) return;
  try {
    getChannel().postMessage({ type: 'playback', ...state });
  } catch {
    // Ignore.
  }
}

export interface ViewerControl {
  action: 'toggle' | 'seek';
  time?: number;
}

/** Subscribe to control messages (play/pause/seek) from the popup. */
export function onViewerControl(handler: (control: ViewerControl) => void): () => void {
  const ch = getChannel();
  const listener = (e: MessageEvent): void => {
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'control') handler(d as ViewerControl);
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}

/** Subscribe to the popup's ready signal so current state can be pushed on open. */
export function onViewerReady(handler: () => void): () => void {
  const ch = getChannel();
  const listener = (e: MessageEvent): void => {
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'ready') handler();
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}
