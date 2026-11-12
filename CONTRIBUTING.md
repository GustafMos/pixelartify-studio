# Contributing to PixelArtify Studio

Thanks for helping improve the tool. This project is MIT-licensed and aims to be a practical, local-first studio for game artists.

## Development

```bash
npm install
npm run dev        # Vite studio
npm run test       # core tests (vitest)
npm run check      # typecheck + tests
npm run build      # production web build
npm run build:cli  # headless CLI bundle
```

- Node 20+.
- The core in `src/core` must stay DOM-free and Node-compatible.
- Keep look-defining parameters in **art pixels** or normalized units. Never make a feature depend on the raw source resolution.
- Add tests for algorithm changes.
- Run `npm run check` before opening a PR.

## Adding an effect

1. Add a type to `PreprocessType` or `PostprocessType` in `src/core/types.ts`.
2. Add a `PREPROCESS_DEFS` / `POSTPROCESS_DEFS` entry with parameter metadata in `src/core/preprocess.ts`.
3. Implement the effect and add a switch case in `applyPreprocess` / `applyPostprocess`.
4. The inspector auto-generates sliders from the metadata.
5. Credit the algorithm/paper in the effect definition and in `CREDITS.md`.

## Adding a dither algorithm

1. Add a registry entry in `src/core/dither.ts`.
2. For ordered/pattern algorithms, return a threshold matrix from `matrixFor`.
3. For error diffusion, add a kernel to `DIFFUSION_KERNELS`.
4. Write a test that asserts palette exactness, alpha preservation and determinism.
5. Add the paper/source to `CREDITS.md`.

## Adding a node

1. Extend `GraphNodeType` in `types.ts`.
2. Add `NODE_DEFS` and `nodeParams` in `graph.ts`.
3. Implement the evaluation case. Return typed port values; do not mutate upstream items.
4. Add an inspector panel and an icon mapping.
5. Add a graph test.

## Graphics constraints

- **Retain alpha.** Resampling uses premultiplied alpha; masks and channels must not introduce fringes.
- **Resolution independence.** A 480p and a 1080p source with the same preset should share art dimensions and texture scale.
- **No hidden network calls.** Everything must work offline.
- **Crediting.** Any algorithm, palette or asset added must be credited with a link and license in `CREDITS.md`.

## Reporting bugs

Please include:

- the preset/graph JSON if possible (Export graph),
- source dimensions and type,
- browser/OS/Node version,
- steps to reproduce, expected vs actual,
- console errors or CLI output.

## License

By contributing, you agree that your contribution is licensed under the MIT License.
