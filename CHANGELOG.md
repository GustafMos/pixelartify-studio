# Changelog

All notable changes to PixelArtify Studio are documented here.

## [0.2.0] - 2026-11-13

### Added

- **Background node** — solid colour, linear/radial gradients, checkerboard,
  stripes, grid, dots and noise. Connect media to place the pattern behind it,
  or use it as a standalone generated image.
- **3D object node** — cube, sphere, cylinder, cone, torus and pyramid rendered
  with an orthographic camera, z-buffer and Lambert shading. Rotate, move,
  scale, zoom and light the object; composite it over media or a background.
- **Animate node** — formula-driven continuous motion with a Motion output.
  Drive 3D objects and backgrounds with `t`, `frame`, `lt`, trig, interpolation
  and clamping functions. Includes duration/fps/loop controls and horizontal or
  two-axis wrap modes, plus a viewer timeline with play/pause and scrubbing.
- **Timeline node** — stretches still media across a chosen duration and frame
  rate so animated effects, grain and overlays can play over an image.
- **Retime node** — stop-motion sampling down to a lower frame rate, and a
  block-matching optical-flow mode that interpolates new frames for smoother
  output. Applied during video/spritesheet export; stop motion also previews
  with a quantised video clock.
- **Animated film grain and noise displacement** — enable **Animate** on either
  effect in the Pre-process or Post-process inspector.
- **Timeline animation export** — the Output inspector can render Animate or
  Timeline graphs to video, spritesheet or both.
- **Node groups** — Ctrl/Cmd-click nodes, then group them. Groups can collapse
  to a single box with combined input/output dots, be duplicated as a whole
  (including internal wires and input assets), or be ungrouped.
- **GPU layer compositing** — the final Compose layers blend now runs through a
  WebGL2 ping-pong compositor with automatic CPU fallback.
- **GPU edge maps** — Sobel/chroma gradients and non-maximum suppression now run
  on the GPU inside the sampler.
- **Preset CPU warnings** — the preset browser shows an amber `!` and the exact
  CPU-heavy stages used by a preset.
- **Direct-canvas playback** — video and animation playback paint straight to
  the preview canvas without PNG encoding or a React render per frame.
- GPU layers badge and improved CPU warning text for layer inpainting and
  detail high-pass layers.

### Changed

- Processing before a generator is now baked before the generated pixels are
  added. A 3D object added near the end of a graph is no longer re-pixelated,
  dithered or post-processed by nodes that came before it; only downstream
  nodes affect it.
- Adding an Output node now makes it the active preview.
- Small-art working supersampling was reduced to 2×.
- Version bumped to 0.2.0.

### Fixed

- Playback freeze caused by `requestAnimationFrame` throttling when the page
  lacked focus.
- Duplicate React keys in the asset rail after applying presets.
- Stale preview image encoding during playback.
- Frame-rate and duration handling for stop-motion and interpolation exports.

## [0.1.0] - 2026-11-11

- Initial public release: node graph, edge-aware pixelation, palettes, dithering,
  preprocessing/postprocessing, layers and inpainting, magic mask tracking, GPU
  sampler/dither/resize/effects, presets, batch/video/spritesheet/A4 export,
  CLI and documentation.
