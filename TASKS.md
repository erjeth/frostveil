# Frostveil - Tasks and checkpoints

Group of three, one branch per member, merged into `main` through pull requests (rebase on `main` first).
Commit prefixes: `core:`, `ui:`, `bench:`, `docs:`, `test:`, `chore:`. Only edit the files you own.

## File ownership

| Member | Name | Branch | Owns (only edit these) |
|---|---|---|---|
| A | Achmad Mirza Arzheta Rahman | `feature/core` | `src/core/*`, `tests/*`, `package.json`, `.gitignore`, `.nojekyll`, `.github/*`, `docs/CONTRACT.md`, `docs/ALGORITHMS.md` |
| B | Farrel Aryasatya Raharjo | `feature/ui` | `src/ui/*`, `index.html`, `css/*`, `docs/img/*`, `docs/UI_NOTES.md` |
| C | Dzakwan Ghonim Fath'Han Mubina | `feature/bench-docs` | `bench/*`, `README.md`, `TASKS.md`, `docs/DESIGN.md`, `docs/EVALUATION.md`, `docs/REPORT.md` |

## Member A - Algorithms and core logic

- [ ] CP0 scaffold: `package.json` (scripts `test`, `bench`, `serve`), `.gitignore`, `.nojekyll`, folder skeleton, CI workflow
- [ ] `docs/CONTRACT.md` committed (the API contract, read-only for everyone else)
- [ ] CP1: `rng.js` (mulberry32), `graph.js`, `bfs.js`, `components.js` (iterative), `tarjan.js` (iterative), `src/core/index.js`, with tests
- [ ] CP2: `simulation.js`, `levelGen.js` (Kruskal with union-find), `levels.js` (8 levels), with tests
- [ ] CP3: `strategies.js` (Random, Max-Degree, Articulation-Aware Greedy, `playOut`, `bruteForceOptimal`), reference-score logic in `evaluateOutcome`, with tests
- [ ] `docs/ALGORITHMS.md` (algorithm details, used by `docs/DESIGN.md`)
- [ ] Check that every level is winnable; change a level's seed only if needed and document it in `docs/CONTRACT.md`

## Member B - Game and UI

- [ ] Mock core to work before CP1 to CP3 land; switch to the real core as each checkpoint reaches `main`
- [ ] `index.html`, `css/*`: page shell and styles, relative paths only (works under a GitHub Pages sub-path)
- [ ] Canvas rendering of the graph (positions scaled from [0, 1]), node states, populations, Citadel
- [ ] Warden actions: Light Beacon, Sever Road, undo, End phase; turn and actions-left display
- [ ] Frost Forecast overlay (from `frostForecast`) and Safe Zones overlay (from `safeZones`)
- [ ] Hint (from `articulationGreedyStrategy`) and critical settlements / roads display
- [ ] Level select (levels 1 to 8) and Free Play (n 10 to 80, k 1 to 3, 1 to 3 sources, seed input, Random seed button)
- [ ] Result screen with saved percent, win/lose and 0 to 3 stars
- [ ] `docs/UI_NOTES.md` and `docs/img/screenshot.png`

## Member C - Evaluation and documentation

- [x] Milestone 1: `bench/` skeleton, `graphs.js`, `stats.js`, `mockCore.js`, `core.js`; draft `README.md` and `TASKS.md`
- [x] Milestone 2: runtime benchmark (10.1) with CSV/JSON output (verified with `--quick` on the stand-in core)
- [x] Milestone 3: strategy comparison (10.2) and brute-force scaling (10.3) (verified with `--quick` on the stand-in core)
- [x] Milestone 4: `charts.js`, `bench.html`, static SVG output (`runtime.svg`, `strategies.svg`, `bruteforce.svg`)
- [x] Milestone 5: draft `docs/DESIGN.md`, structure of `docs/EVALUATION.md` and `docs/REPORT.md` with `TODO(real numbers)` placeholders
- [ ] Milestone 6: switch `bench/core.js` to the real core, run the full benchmarks, delete `bench/mockCore.js`, fill all real numbers, charts and analysis into the documents
- [ ] Milestone 7: final verification (every number matches `bench/results/`, every README command works, every link and image path resolves)
- [ ] Sync the Articulation-Aware Greedy pseudocode and complexity in `docs/DESIGN.md` with `docs/ALGORITHMS.md`

## Checkpoints and integration

| Checkpoint | Delivered by | Content | Passes when |
|---|---|---|---|
| CP0 Scaffold | A | `package.json`, `.gitignore`, `.nojekyll`, folder skeleton, `docs/CONTRACT.md`, CI | `npm test` runs |
| CP1 Graph algorithms | A | `rng`, `graph`, `bfs`, `components`, `tarjan`, `src/core/index.js` | `npm test` green |
| CP2 Playable core | A | `simulation`, `levelGen`, `levels` | `npm test` green |
| CP3 Strategies | A | `strategies` (with `playOut`, `bruteForceOptimal`), final `evaluateOutcome` reference scores | `npm test` green |
| CP4 Final integration | A, B, C | all three branches merged | see the list below |

Until a checkpoint lands, B works against a mock core and C works against `bench/mockCore.js`. When a checkpoint
reaches `main`, pull it and switch to the real code.

Final integration steps (CP4):

- [ ] Branches `feature/core`, `feature/ui`, `feature/bench-docs` merged into `main` through pull requests
- [ ] `npm test` is green on `main`
- [ ] `npm run bench` run on the merged code; results committed in `bench/results/`
- [ ] The game is played end to end (level select, a win, a loss, Free Play, Hint)
- [ ] GitHub Pages enabled (Settings -> Pages -> Deploy from branch -> `main` -> `/ (root)`) and the link added to `docs/REPORT.md`

## Team contributions

| Member | Name | Track | Main contributions | Commit prefixes |
|---|---|---|---|---|
| A | Achmad Mirza Arzheta Rahman | Algorithms and core logic | graph algorithms (BFS, components, Tarjan), simulation, level generator (Kruskal), strategies and brute force, tests, CI, contract and algorithm docs | `core:`, `test:`, `chore:` |
| B | Farrel Aryasatya Raharjo | Game and UI | canvas game, actions and undo, Frost Forecast and Safe Zones overlays, Hint, level select and Free Play, result screen, UI notes | `ui:` |
| C | Dzakwan Ghonim Fath'Han Mubina | Evaluation and documentation | benchmark harness, runtime / strategy / brute-force experiments, charts, in-browser benchmark, Design, Evaluation and Report documents, README and task list | `bench:`, `docs:` |
