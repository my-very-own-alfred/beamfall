# Beamfall

> Open-source local multiplayer arena game inspired by Laser League.

![placeholder](docs/gameplay.gif)

> GIF coming once we have visuals.

## What it is

Beamfall is a top-down 2D arena game for 1-4 players on a single machine. Couch-style hot-seat: keyboards split into per-slot layouts, plus any USB gamepad you plug in.

Each round, players race to activate colored laser nodes scattered across the arena. Cross your own color and you're fine. Cross an enemy color and you die. Last color standing wins the round; first to 5 rounds wins the match.

The design is inspired by Laser League (Roll7 / 505 Games, 2018), which has been delisted from Steam. Beamfall is not derivative — no assets, code, or content come from that game. It's a clean-room open-source take on the genre.

## Status

v0.1.0 MVP. Hot-seat keyboard works, gamepad lobby works, 1 arena, 1 laser pattern. Visuals are placeholder geometry. See Roadmap.

## Run it locally

```bash
git clone <repo>
cd beamfall
npm install
npm run dev          # browser at http://localhost:1420
npm run tauri:dev    # native window (requires Rust toolchain)
```

### Prerequisites

- Node 20+ and npm
- Rust 1.75+ (only for `tauri:dev` / `tauri:build`)
- Linux platform deps for Tauri:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential curl wget file
  ```
- macOS: Xcode Command Line Tools
- Windows: WebView2 (preinstalled on Win11) and MSVC build tools

## Controls

| Slot | Color  | Move           | Activate     | Power        |
|------|--------|----------------|--------------|--------------|
| 1    | Red    | WASD           | Space        | Q            |
| 2    | Blue   | Arrow keys     | Enter        | Right Shift  |
| 3    | Yellow | IJKL           | U            | O            |
| 4    | Green  | Numpad 8/2/4/6 | Numpad 0     | Numpad Enter |

Or any USB gamepad: claim a slot with **A** in the lobby, **Start** to begin the match. Left stick or D-pad to move, **A** to activate, **B** for power.

## How to play

1. **In the lobby**, each player presses their layout's "up" key (`W` / `Up` / `I` / `Numpad 8`) or **A** on a gamepad to claim a slot.
2. Once at least one player has claimed, anyone presses **Enter** or gamepad **Start** to begin the match.
3. **In the match**, walk over a node to make it your color. The node fires lasers in your color along its pattern.
4. Don't cross enemy-color lasers. Your own color is safe.
5. Last color alive wins the round. First to 5 rounds wins the match.

## Tech stack

- **Tauri 2.x** — desktop runtime, ~15 MB binary
- **Vite 5** + **TypeScript 5** (strict mode)
- **PixiJS v8** + `pixi-filters` — rendering, bloom
- **120 Hz** fixed-timestep simulation, **60 Hz** render with interpolation

## Project structure

```
beamfall/
├── src/
│   ├── engine/
│   │   ├── loop.ts          # fixed-timestep accumulator (120 Hz tick, 60 Hz render)
│   │   ├── input/           # keyboard + gamepad sources, snapshot building
│   │   ├── render/          # Pixi stage with bloom, world drawer
│   │   └── audio/           # Web Audio scheduler (stub for now)
│   ├── game/
│   │   ├── world.ts         # match state container
│   │   ├── rules.ts         # win conditions, round transitions
│   │   ├── rng.ts           # seeded PRNG
│   │   ├── entities/        # players, nodes, lasers
│   │   ├── systems/         # movement, activation, laser scheduling, collision, scoring
│   │   └── arenas/          # arena definitions
│   ├── ui/
│   │   ├── menu.ts          # title screen
│   │   ├── lobby.ts         # slot-claiming screen
│   │   └── hud.ts           # in-match round/score display
│   ├── types.ts             # shared contract (PlayerSlot, InputSnapshot, etc.)
│   └── main.ts              # bootstrap
├── src-tauri/               # Rust shell (window only, no gameplay code)
├── index.html
├── vite.config.ts
└── package.json
```

## Architecture decisions

- **PixiJS over Phaser/Unity/Godot** — Pixi is a thin WebGL renderer, not a framework. Gameplay logic stays plain TypeScript, easier to reason about and unit-test. Phaser pulls in physics/scenes we don't need; Unity/Godot are overkill for a 2D arena.
- **120 Hz simulation tick** — laser collision is the hot path; at 60 Hz a fast-moving player can tunnel through a thin laser between frames. 120 Hz halves that risk without measurable CPU cost.
- **Fixed-timestep + render interpolation** — deterministic sim (replayable, debuggable), smooth visuals on any monitor refresh rate. Standard Glenn Fiedler pattern.
- **JS-only sim, no Rust gameplay code** — Tauri is just the window. Keeps the stack one language, one debug story. If perf becomes a problem we can move hot loops to Rust later via `invoke`.
- **Local-only, no netcode** — netcode is its own multi-month project. Hot-seat is the actual fun mode of the inspiration. Rollback netcode is a possible v2.

## Roadmap

- [x] **v0.1.0 MVP** — playable hot-seat, 1 arena, 1 laser pattern
- [ ] **v0.2** — 4 gamepad support polished, controller rebinding UI
- [ ] **v0.3** — power-ups (speed, stun, snipe), 3 laser patterns
- [ ] **v0.4** — music + audio sync (Web Audio scheduler), 3 arenas
- [ ] **v0.5** — visual polish (particles, screen shake, neon trails)
- [ ] **v1.0** — release: code-signed Win/Mac builds, GitHub releases, itch.io

## Contributing

PRs welcome. For non-trivial changes, open an issue first to discuss scope. Code is MIT-licensed; by contributing you agree to that license.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

Inspired by **Laser League** (Roll7 / 505 Games, 2018). This project is not affiliated with, endorsed by, or derived from that game — only its genre.
