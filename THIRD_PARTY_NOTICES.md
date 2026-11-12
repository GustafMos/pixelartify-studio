# Third-party notices

PixelArtify Studio's own source is MIT licensed (see `LICENSE`). The project depends on the following packages and external programs. Their licenses apply to their respective code and binaries.

## Runtime dependencies

| Package | Version | License | Project |
| --- | --- | --- | --- |
| mediabunny | ^1.65.2 | MPL-2.0 | <https://github.com/Vanilagy/mediabunny> |
| react | ^19.1.0 | MIT | <https://github.com/facebook/react> |
| react-dom | ^19.1.0 | MIT | <https://github.com/facebook/react> |
| fflate | ^0.8.2 | MIT | <https://github.com/101arrowz/fflate> |
| sharp | ^0.35.5 | Apache-2.0 | <https://github.com/lovell/sharp> |

`sharp` bundles libvips, which is LGPL-2.1-or-later. See the sharp and libvips distributions for their notices and source links.

### Mediabunny (MPL-2.0)

Mediabunny is used unmodified as a dependency. Its source is available at the link above. MPL-2.0 is file-level copyleft: it does not relicense PixelArtify Studio's own files. If you modify Mediabunny files and distribute them, you must make those modified files available under MPL-2.0.

## Optional dependency (CLI video)

| Package | Version | License | Project |
| --- | --- | --- | --- |
| @ffmpeg-installer/ffmpeg | ^1.1.0 | LGPL-2.1 (wrapper) | <https://github.com/kribblo/node-ffmpeg-installer> |
| @ffmpeg-installer/win32-x64 | platform binary | GPLv3 | <https://ffmpeg.org/> |
| @ffmpeg-installer/darwin-x64 / linux-x64 etc. | platform binary | see package | <https://ffmpeg.org/> |

The optional ffmpeg binary is a **separate executable** invoked via `child_process.spawn`; it is not linked into or combined with PixelArtify Studio's MIT code. Some platform builds (including the Windows build) are GPLv3. If you redistribute a package that includes these binaries, comply with the GPL: include the license text and provide the corresponding source, or remove the optional dependency and use a system ffmpeg (`FFMPEG_PATH`).

The browser studio does **not** require ffmpeg; it uses WebCodecs through Mediabunny.

## Development dependencies

| Package | License |
| --- | --- |
| @types/node | MIT |
| @types/react | MIT |
| @types/react-dom | MIT |
| @vitejs/plugin-react | MIT |
| tsx | MIT |
| typescript | Apache-2.0 |
| vite | MIT |
| vitest | MIT |
| esbuild | MIT |

## Runtime environment

- Node.js is licensed under the MIT license and additional notices.
- Chromium/Firefox/Safari provide the WebCodecs, Canvas and Web Audio APIs used by the studio.

## Attribution in the app

The About dialog in PixelArtify Studio and `CREDITS.md` link to the principal inspirations: pixel-mosaic, Ditherista/libdither, Mediabunny, OKLab and the dithering/colour-science literature.

If you believe something is missing or incorrectly attributed, please open an issue.
