/**
 * Pop-out viewer: opens the live preview in a separate browser window so it can
 * sit on a second monitor while the node graph is edited. Frames are pushed to
 * the popup via postMessage as PNG data URLs (the popup scales with pixelated
 * rendering, so art stays crisp).
 */

import type { PixelImage } from '../core/types';
import { pixelImageToDataUrl } from './io';

let viewerWindow: Window | null = null;

const POPUP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>PixelArtify — Viewer</title>
<style>
  html, body { margin: 0; height: 100%; background: #141414; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  #wrap { position: relative; max-width: 100vw; max-height: 100vh; }
  img { display: block; max-width: 100vw; max-height: 100vh; object-fit: contain; image-rendering: pixelated; }
  #meta { position: fixed; left: 10px; bottom: 10px; color: #9a9a9a; font: 11px ui-monospace, monospace; }
  .checker { background-image: conic-gradient(#222 25%, #1a1a1a 0 50%, #222 0 75%, #1a1a1a 0); background-size: 20px 20px; }
</style>
</head>
<body>
  <div id="wrap" class="checker"><img id="art" alt="preview"></div>
  <div id="meta">PixelArtify viewer</div>
  <script>
    var art = document.getElementById('art');
    var meta = document.getElementById('meta');
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== 'pixelartify-art') return;
      art.src = e.data.url;
      meta.textContent = e.data.width + ' × ' + e.data.height + ' px';
    });
  </script>
</body>
</html>`;

export function isViewerWindowOpen(): boolean {
  return Boolean(viewerWindow && !viewerWindow.closed);
}

export function toggleViewerWindow(): boolean {
  if (viewerWindow && !viewerWindow.closed) {
    viewerWindow.close();
    viewerWindow = null;
    return false;
  }
  const win = window.open(
    '',
    'pixelartify-viewer',
    'width=760,height=560,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
  );
  if (!win) return false;
  try {
    win.document.open();
    win.document.write(POPUP_HTML);
    win.document.close();
  } catch {
    return false;
  }
  viewerWindow = win;
  return true;
}

/** Push a rendered frame to the popup. Cheap no-op when the window is closed. */
export function postArtToViewer(image: PixelImage): void {
  if (!viewerWindow || viewerWindow.closed) {
    viewerWindow = null;
    return;
  }
  try {
    viewerWindow.postMessage(
      { type: 'pixelartify-art', url: pixelImageToDataUrl(image), width: image.width, height: image.height },
      '*',
    );
  } catch {
    // Popup may be navigating; ignore.
  }
}
