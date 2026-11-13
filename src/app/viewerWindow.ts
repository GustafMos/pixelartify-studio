/**
 * Pop-out viewer: opens the live preview in a separate browser window (the app
 * served at `?viewer=1`). Frames and playback state are pushed via postMessage;
 * play/pause/seek controls come back the same way.
 */

import type { PixelImage } from '../core/types';
import { pixelImageToDataUrl } from './io';

let viewerWindow: Window | null = null;

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
  return true;
}

function post(msg: Record<string, unknown>): void {
  if (!viewerWindow || viewerWindow.closed) {
    viewerWindow = null;
    return;
  }
  try {
    viewerWindow.postMessage(msg, '*');
  } catch {
    // Window may be navigating; ignore.
  }
}

/** Push a rendered frame to the popup. Cheap no-op when the window is closed. */
export function postArtToViewer(image: PixelImage): void {
  if (!viewerWindow || viewerWindow.closed) return;
  post({ type: 'art', url: pixelImageToDataUrl(image), width: image.width, height: image.height });
}

export function postPlaybackToViewer(state: ViewerPlaybackState): void {
  if (!viewerWindow || viewerWindow.closed) return;
  post({ type: 'playback', ...state });
}

export interface ViewerControl {
  action: 'toggle' | 'seek';
  time?: number;
}

/** Subscribe to control messages (play/pause/seek) from the popup. Returns an unsubscribe fn. */
export function onViewerControl(handler: (control: ViewerControl) => void): () => void {
  const listener = (e: MessageEvent): void => {
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'control') {
      handler(d as ViewerControl);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Subscribe to the popup's ready signal so current state can be pushed on open. */
export function onViewerReady(handler: () => void): () => void {
  const listener = (e: MessageEvent): void => {
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'ready') handler();
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
