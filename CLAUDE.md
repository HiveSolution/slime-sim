# slime-sim

Interactive WebGPU slime mould simulation. What and why live in the cortex
note `G:\konstruct9\cortex\10-nodes\slime-sim.md`; read it first. How the
simulation works is in `README.md`. The hive rules in `G:\konstruct9\CLAUDE.md`
apply.

## Source of truth

The model follows Jones (2010); the PDF is at
`G:\konstruct9\input_data\artl.2010.16.2.pdf`. Parameter names in code
comments (`[SA]`, `[RA]`, `[SO]`, ...) are the paper's, from its Table 1.

- A change to simulation behaviour must match the paper, or be listed under
  "Where it differs from the paper" in `README.md`.
- **Don't copy code from SebLague/Slime-Simulation.** It is GPL-3.0 and this
  repo is MIT. Use it only to see how something behaves.

## Design

Follow `G:\konstruct9\cortex\05-core\` (Stack, Colors, Typography, Icons).

- Dark only for now: `index.html` ships `<html class="dark">`.
- Tokens are defined once in `src/styles.css`. Use token classes, never hex
  values. The background and peak colours of the picture are read from the
  tokens at startup (`readColors` in `src/app/app.ts`); species colours are
  user settings.

## Conventions

- `src/sim/` stays framework-free (no Angular imports), so it can be reused
  elsewhere, e.g. as a tool page in renokk-web.
- Component selector prefix: `slime`. Standalone components, signals, zoneless.
- Spartan components live in `libs/ui/<name>` as owned copies. Add new ones
  with `npx ng g @spartan-ng/cli:ui <name> --interactive false --defaults`
  (config: `components.json`).
- Run `npx prettier --write "src/**/*.{ts,html,css}"`, `npx ng test --watch=false`
  and `npx ng build` before committing.
- Commit and push each finished milestone to `main` without asking first.
  This replaces the hive's ask-before-pushing rule for this node only.
  Force-pushing and deleting branches still need a question.

## Deployment

Live at <https://hivesolution.github.io/slime-sim/>. Every push to `main`
runs `.github/workflows/deploy.yml`: tests, a build with
`--base-href /slime-sim/`, then GitHub Pages. A push therefore publishes;
check the run with `gh run watch` and look at the live site afterwards.

- Keep asset paths relative (`favicon.ico`, not `/favicon.ico`), or they
  break under the `/slime-sim/` base path.

## Gotchas

- The `Params` and `Species` structs in `src/sim/shaders.ts` and
  `packParams` in `src/sim/params.ts` must have the same layout. WGSL aligns
  `vec4f` to 16 bytes, which leaves gaps. The `packParams` tests pin the
  offsets; update them together with the structs.
- Same for the `Brush` struct and `packBrush` in `src/sim/food.ts`.
- Food sources are GPU-only state: one texture for the food as painted, one
  for what is left. There is no CPU copy, so painting, erasing, clearing and
  refilling are all GPU passes.
- A texture can't be read and written in the same render pass. That is why
  diffuse (reads the food sources) and deposit (subtracts from them) are
  separate passes.
- The shaders are TypeScript template strings, so a backtick in a WGSL
  comment ends the string.
- WGSL reserves many ordinary words (`from`, `target`, ...). A shader that
  uses one fails at startup with the compiler's message shown on the page.
- A setting that changes buffer or texture sizes, or the start state, must be
  in `RESET_KEYS` (`src/sim/settings.ts`).
- A new setting also needs a key in `src/sim/share.ts` (encode and decode),
  or shared links silently drop it. A numeric one needs an entry in `LIMITS`
  or `SPECIES_LIMITS`, which both the sliders and the link decoder use. Keep
  old links working: add keys, don't rename or reorder them.
- To test "Copy link" in headless Chrome, grant `clipboard-sanitized-write`
  (and `clipboard-read` to read it back); `clipboard-write` alone is not
  enough. This writes to the real system clipboard.
- Unit tests run in jsdom, which has no WebGPU, so they cover only the pure
  code. To check the simulation itself, drive Chrome headless with
  `--enable-unsafe-webgpu --enable-gpu --ignore-gpu-blocklist` (puppeteer-core
  works) and look at screenshots.
- npm 12 blocks install scripts that aren't approved (`npm install-scripts ls`).
  The build works without them.
