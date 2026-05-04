# Agent Handoff — Beamfall

> Context for an AI agent picking up this repo cold. Read this before touching code.

## What this is

**Beamfall** — open-source local multiplayer arena game inspired by Laser League (delisted 2018). Hot-seat 1–4 players on one machine. Top-down 2D. TypeScript + PixiJS in a Tauri desktop shell.

Status: **v0.2.0** — playable hot-seat with 6-class character system, power-ups, 4 laser patterns, and a Vitest test harness. Visuals still placeholder. See `README.md` for the genre spec; this file is the implementation hand-off.

## Why these choices (load-bearing decisions)

These are the decisions an agent is most likely to second-guess. Don't unless you have a real reason.

1. **PixiJS, not a full engine.** Pixi is a thin WebGL renderer. Gameplay is plain TypeScript — unit-testable, no scene-graph framework lock-in. Phaser/Unity/Godot were rejected as overkill for a 2D arena.
2. **120 Hz fixed-timestep sim, 60 Hz render with interpolation.** Lasers are thin and fast — at 60 Hz a player tunnels through them between frames. 120 Hz halves the tunneling risk for ~no CPU cost. Glenn Fiedler accumulator pattern in `src/engine/loop.ts`.
3. **TypeScript-only gameplay, Rust is just the window.** Tauri shell (`src-tauri/`) does no gameplay work. One language, one debugger. Hot loops can move to Rust via `invoke` *if* perf demands it later — it doesn't yet.
4. **Local-only. No netcode.** Hot-seat is the genuine fun mode. Rollback netcode is its own multi-month project, parked as v2.
5. **Seeded PRNG (`src/game/rng.ts`).** Sim must be deterministic for replay/debug. Don't introduce `Math.random()` in gameplay code.
6. **Strict TS, no `any` shortcuts.** `tsconfig.json` has strict mode on. `npm run typecheck` is the gate.

## Repo layout (where to look)

```
src/
├── main.ts              bootstrap, scene switching (menu → lobby → match)
├── types.ts             shared contracts (PlayerSlot, InputSnapshot, …)
├── engine/
│   ├── loop.ts          120 Hz tick / 60 Hz render accumulator
│   ├── input/           keyboard.ts, gamepad.ts, snapshot.ts, bindings.ts
│   ├── render/          stage.ts (Pixi app), bloom.ts, world.ts (drawer), debug.ts
│   └── audio/           empty — Web Audio scheduler stub planned for v0.4
├── game/
│   ├── world.ts         match state container (the World)
│   ├── rules.ts         win conditions, round transitions
│   ├── rng.ts           seeded PRNG — use this, never Math.random
│   ├── entities/        player.ts, node.ts, laser.ts, pickup.ts (data shapes)
│   ├── systems/         movement, nodeActivation, laserScheduler, collision, scoring
│   └── arenas/          grid8x6.ts (only arena so far)
├── ui/                  menu.ts, lobby.ts, hud.ts, statsScreen.ts (Pixi-drawn, not DOM)
└── assets/              empty — placeholder geometry only at v0.1
src-tauri/               Rust window shell, do not put game logic here
```

**Mental model:** input → snapshot → systems mutate world → render reads world. One-way data flow per tick. Don't let render code mutate world state.

## Build & run

```bash
npm install
npm run dev          # browser, http://localhost:1420
npm run tauri:dev    # native window (needs Rust + Linux deps, see README)
npm run typecheck    # strict TS gate
npm run build        # typecheck + vite build
```

Linux Tauri deps: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential curl wget file`.

## Character system (v0.2)

Six classes, each with a distinct ultimate. Spec lives in `src/game/characters.ts`; ability state machine in `src/game/systems/abilities.ts`. Classes are inspired by Laser League's classes (clean-room re-implementation, no shared code).

| Class | Ultimate | Physics |
|-------|----------|---------|
| SMASH | Forward dash that knocks enemies back into lasers | Dash velocity overrides input during active window; on contact, victim gets impulse decayed exponentially by `effects.ts` |
| BLADE | Forward dash that kills on contact | Hit refills gauge instantly; miss = full cooldown. Charge-based reward for accuracy |
| SHOCK | Radial AoE stun around the caster | Enemies in `radius` get `stunTimer` set; their gauge resets to 0 |
| SNIPE | Two-step: place marker, teleport back killing along the line | Segment-vs-circle test along teleport line; respects pickup-shield |
| GHOST | Temporary invincibility (walks through enemy lasers) | `collision.ts` skips alive players whose ability phase is 'active' for class 'ghost' |
| THIEF | Convert nearest in-range enemy node to caster's color | If no node in range, charge is preserved (no-op trigger) |

**Why each piece exists:**
- `AbilityState` (in `types.ts`): `phase` enum captures idle/active/armed; `dashVel` is the impulse stored at trigger so `movement.ts` reads it without re-deriving from input.
- `effects.ts` runs **first** in the tick, before abilities/movement. This is on purpose — knockback/stun timers must be current before movement decides what to apply.
- `abilities.ts` runs **before** movement so a dash trigger this tick uses its velocity this tick.
- `pickups.ts` runs **after** collision so a player who died this tick can't grab a shield retroactively.

**Tunables you should not touch without reason:**
- `KNOCKBACK_DECAY = 6.0` in `effects.ts` — tuned with `knockbackImpulse: 14` in SMASH spec. They're a pair.
- `SPEED_BOOST_MULT = 1.6` in `movement.ts` — bigger and pickups become must-grabs; smaller and they feel pointless.
- `ALL_CHARACTERS` order in `characters.ts` is the lobby cycle order — change it and players have to relearn the menu.

## Power-ups (v0.2)

Three kinds, spawned by `systems/pickups.ts` every ~8s up to `MAX_ACTIVE_PICKUPS = 2`:
- **speed** — 1.6x player speed for 4s.
- **stun** — instantly stuns nearest enemy-color player for 1.2s.
- **shield** — 2.5s pickup-invincibility (separate field from GHOST's class invincibility — both work, neither blocks the other).

Spawn positions: random arena cells via `world.rng()` (seeded — replays are deterministic), avoiding within 1.5 cells of any alive player.

## Laser patterns (v0.2)

Implemented in `systems/laserScheduler.ts`:
- **sweep** — single radial beam rotating CCW (original v0.1 pattern).
- **rotate** — two opposing beams (180° apart) rotating CCW. More coverage.
- **pulse** — fixed horizontal beam, on for half the cycle, off for half. Creates rhythm gaps.
- **segment-flip** — alternates horizontal/vertical at half-cycle. Forces position re-reads.

The default arena (`arenas/grid8x6.ts`) now seeds one of each so a single round shows all four.

## Match stats & MVP screen (v0.2)

Per-player stats are tracked across a whole match (not reset per round) in
`Player.stats`. Score weights live in `src/game/stats.ts` — keep them there;
do not sprinkle constants across systems.

Tracked counters and where they're written:
- `ultKills` — `abilities.ts`: BLADE dash hit, SNIPE line-kill. (SMASH does not
  count for ult kills directly — its knockback can shove a target into a laser
  but the kill is then credited to the laser owner via `laserKills`. This is a
  deliberate design choice: SMASH rewards positioning, not raw aim.)
- `laserKills` — `collision.ts`: when a player dies to a laser, the same-color
  player gets the credit. With one player per color (current rule) this is the
  node activator.
- `captures` — `nodeActivation.ts`: incremented only on color *change* (not
  every tick of overlap). THIEF also counts as a capture.
- `thiefSteals`, `shockHits` — `abilities.ts` direct write on success.
- `roundsWon` — `world.ts`: credited at round-end to alive winning-color players.
- `deaths` — set by whichever system caused the death (laser collision, BLADE,
  SNIPE).

`startNewMatch` clears stats; `startNewRound` does NOT — that's intentional so
the post-match leaderboard shows the whole match.

The leaderboard / MVP screen is `src/ui/statsScreen.ts`. It activates when
`world.state` becomes `matchEnd`; the play surface (worldRenderer + HUD) is
torn down and the stats screen takes over the hudLayer. Press Start/Enter to
return to lobby. The MVP is the highest-scoring *player*, which may not be
the winning *color* — by design (a player can dominate stats and still lose
the round-count race).

## Tests (v0.2)

Vitest harness wired in. `npm run test`. Covers:
- `tests/scoring.test.ts` — round-end logic (last-color, total-wipe, count-majority, ties).
- `tests/abilities.test.ts` — SHOCK stun/range/teammate-safety, THIEF nearest-node + charge-preserve-on-miss, GHOST active-phase entry, SNIPE two-step + line-kill, BLADE hit-refill, SMASH knockback.
- `tests/stats.test.ts` — score formula, weight ordering, tie-rank behavior, death penalty.

Add tests for any new system — pure functions over `World` make this cheap.

## v0.3 additions (this development sprint)

Five clusters shipped in sequence. All commits land on `main`:
- `5502ff3` **CI** — `.github/workflows/ci.yml`: typecheck/test/build on push and PR (Node 20, ubuntu-latest).
- `ad9857d` **Content** — 3 new arenas (`wide12x6`, `tall6x10`, `cross10x10`) + 3 new patterns (`zigzag`, `ring`, `pendulum`) + Tab to cycle in lobby. Registry in `src/game/arenas/index.ts`.
- `896f281` **Game feel** — `src/engine/render/abilityFx.ts` (SHOCK ring, SNIPE marker line, GHOST flicker, BLADE/SMASH trails, THIEF flash via new `LaserNode.flashTimer`) + HUD ability gauge (80×6 bar + class badge, pulses on SNIPE armed) + hit-stop (`World.hitStopTimer`, freezes systems for 80ms on impact) + screen shake (`World.shake`, render-decayed) + particles (`src/engine/render/particles.ts`).
- `7034dfa` **Pause/replay/mutators** — `src/ui/pauseMenu.ts` (Esc/Start), `src/engine/replay.ts` (24-bit packed snapshot encoding, localStorage persistence, AppState 'replay'), `src/game/mutators.ts` (5 mutators: fastSpeed, sluggishLasers, instantCharge, noPickups, chaosNodes; toggle 1-5 in lobby).
- `44e3a76` **Audio** — `src/engine/audio/{engine,sfx,music}.ts`: lazy AudioContext, 12 synthesized SFX (no assets), 130 BPM step-sequencer, beat-locked lasers via optional `world.beat`. Game-event sink in `src/game/events.ts` keeps gameplay pure (events queue drained render-side and dispatched to `playSfx`). 'M' to mute.

Critical invariants preserved across all changes:
- Determinism: gameplay sim never reads wall-clock or audio. `world.beat` is read-only from gameplay's view; absent → byte-identical to baseline.
- Replay seed flows createWorld → makeRng. The only `Date.now()` in sim code is the seed fallback when no explicit seed is passed (replays always pass one).
- World additions (`hitStopTimer`, `shake`, `events`, `laserRateMultiplier`, `abilityRateMultiplier`, `pickupsEnabled`, `chaosTimer`, `beat`) are optional/defaulted. Old constructors keep working.

## What's done at v0.3 (cumulative)

- Fixed-timestep loop, 120/60, with deterministic replay support.
- Keyboard + gamepad input, 4 slots, lobby claim flow.
- 4 arenas, 7 laser patterns.
- Round/match scoring, last-color-standing → first to 5 wins.
- 6 character classes with full ability state machines and physics.
- 3 power-up kinds, RNG-spawned with seed determinism.
- Per-player stats tracking + post-match MVP screen.
- HUD (round/timer/scores/ability gauge) + state overlays.
- Pause menu (Resume / Restart Round / Return to Menu).
- Match modifiers (5 mutators, lobby toggle, localStorage persistence).
- Deterministic replay system (record + playback from main menu).
- Ability VFX (SHOCK ring, SNIPE line, GHOST flicker, dash trails, THIEF flash).
- Hit-stop, screen shake, particle bursts.
- Audio: 12 synthesized SFX, beat-synced procedural music, beat-locked laser scheduler.
- Polished menu with neon decor + version line.
- Bloom post-process.
- 7 test files / 40 passing tests.

## What's NOT done

- **No real art.** All shapes/synthesized geometry. `src/assets/` is empty on purpose.
- **No controller rebinding UI.** Roadmap v0.4.
- **No netcode.** Won't be added without an explicit decision (see decision #4).
- **No menu music or mid-round audio transitions.** Music starts at round-begin only.
- **No SFX volume slider, no per-player audio panning.** Master mute toggle ('M') only.
- **No replay scrubbing or pause during playback.** Plays start to finish.
- **Pre-existing TS errors in `src/game/systems/abilities.ts`** under `noUncheckedIndexedAccess` — predate this sprint, none of the new code adds errors. Worth a cleanup pass.
- **SMASH does not credit ult kills directly** when knocking a target into a laser — by design. Don't "fix" this without discussing the score-weight implications.

## Conventions

- Strict TS, no `any` outside justified seams.
- Systems are functions over `World`, not classes.
- Gameplay never imports from `src/engine/render/*`. Render reads world; world doesn't know render exists.
- Rust side stays minimal. If you're tempted to add gameplay to `src-tauri/`, stop — see decision #3.
- Determinism: seeded RNG, fixed timestep, no wall-clock in sim code.

## Known traps

- **Don't bypass the input snapshot.** Systems read `InputSnapshot`, not raw event handlers. `snapshot.ts` is the single source of per-tick truth.
- **Render interpolation reads two world states.** If you add fields to entities, make sure they're either interpolatable (numbers) or stable across the tick boundary, or render will jitter.
- **Pixi v8, not v7.** API differs (`Application.init()` is async, etc.). Check the v8 docs if syntax looks off.
- **Tauri 2.x, not 1.x.** Plugin/permission model changed.
- **Gamepad API is browser-flaky.** `gamepad.ts` polls; don't rely on connect/disconnect events alone.

## Roadmap

- [x] **v0.1.0** — playable hot-seat MVP, 1 laser pattern.
- [x] **v0.2.0** — 6 character classes, power-ups, 4 laser patterns, match stats + MVP screen, polished menu, Vitest harness.
- [ ] **v0.3** — render-side ability feedback (SHOCK aura, SNIPE marker, dash trail), HUD ability gauge, rebinding UI.
- [ ] **v0.4** — Web Audio scheduler + music sync, 3 arenas, SFX for hits/dashes/captures.
- [ ] **v0.5** — visual polish (particles, screen shake, neon trails, kill cam flashes).
- [ ] **v1.0** — signed Win/Mac builds, GitHub releases, itch.io.

## Agent orchestration (agentic-config)

This project uses [WaterplanAI/agentic-config](https://github.com/WaterplanAI/agentic-config) v0.3.0 (Claude Code plugin marketplace) for multi-agent workflows. Installed plugins (user scope):

- **`ac-workflow`** — pimux-backed orchestration (`ac-workflow-mux`, `-ospec`, `-roadmap`). Use for multi-phase work.
- **`ac-safety`** — credential-leak, write-scope, destructive-bash, supply-chain, playwright guardrails.
- **`ac-audit`** — JSONL append-only tool log. Survives agent crashes; check after a long parallel run.
- **`ac-git`** — git/PR/release automation skills.
- **`ac-qa`** — QA + browser automation for smoke tests against built bundles.

When picking up this repo:
1. Verify install with `claude plugin list` (should show all 5 enabled).
2. For multi-feature dispatches (e.g. "ship X, Y, Z in parallel"), use `ac-workflow-mux-roadmap` instead of raw `Agent` tool calls. It handles tmux scope per agent so they don't fight on `types.ts`/`world.ts`/`main.ts`.
3. Background agents need `--dangerously-skip-permissions` to actually execute (they can't surface permission prompts). Limit those sessions to project-scoped dirs, not `$HOME`.
4. `ac-audit` writes to a JSONL log — read it with `cat` if you need a post-mortem of what a failed agent actually did.

**Why we adopted it (lessons from the v0.3 sprint):**
- Plain `Agent` tool worktree isolation failed (parent process not in a git repo). MUX is tmux-based and doesn't need worktrees.
- "Te aviso cuando termine" doesn't work — agent results stay buried until the user opens a turn. MUX has built-in status surfacing.
- We caught a black-screen Windows build only when the user installed it. With `ac-qa` + a Playwright smoke against `npm run preview`, we'd catch CSP/init errors pre-release.
- An agent ran `pip install --break-system-packages` unchallenged. `ac-safety` blocks that.

## Provenance & licensing

- MIT. Clean-room. **No assets, code, or content from Laser League.** Inspiration only — that game is delisted and not redistributable. Keep this clean if you generate or import anything.
- Owner / primary maintainer: see commit history once initialized.

## Repo state when handed off

- `git` was **not** initialized in the snapshot you received. `git init` and a first commit is appropriate before further work.
- `node_modules/`, `src-tauri/target/`, `dist/`, `.git/` are excluded from the archive. Run `npm install` first.
- `.gitignore` already covers all build/editor/OS junk — don't loosen it.
