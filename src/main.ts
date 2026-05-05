// Beamfall — runtime entrypoint.
// Wires the engine loop, input sources, render stage, world simulation, and
// UI screens (menu / lobby / HUD) together. State machine drives the
// transition: menu -> lobby -> match -> stats, plus pause overlay during
// match and a 'replay' state for deterministic playback.

import { Text } from 'pixi.js';

import { startLoop } from '@/engine/loop';
import { KeyboardSource } from '@/engine/input/keyboard';
import { GamepadSource } from '@/engine/input/gamepad';
import { buildSnapshots } from '@/engine/input/snapshot';
import { createStage } from '@/engine/render/stage';
import type { Stage } from '@/engine/render/stage';
import { createWorldRenderer } from '@/engine/render/world';
import type { WorldRenderer } from '@/engine/render/world';
import { createDebugOverlay } from '@/engine/render/debug';
import {
  createWorld,
  tick as tickWorld,
  setInputProvider,
  startNewMatch,
  startNewRound,
} from '@/game/world';
import { createHud } from '@/ui/hud';
import type { Hud } from '@/ui/hud';
import { createLobby } from '@/ui/lobby';
import type { Lobby } from '@/ui/lobby';
import { createMenu } from '@/ui/menu';
import type { Menu } from '@/ui/menu';
import { createStatsScreen } from '@/ui/statsScreen';
import type { StatsScreen } from '@/ui/statsScreen';
import { createPauseMenu } from '@/ui/pauseMenu';
import type { PauseMenu } from '@/ui/pauseMenu';
import { applyMutators } from '@/game/mutators';
import type { MutatorId } from '@/game/mutators';
import {
  createPlayer as createReplayPlayer,
  createRecorder,
  loadReplay,
  saveReplay,
} from '@/engine/replay';
import type { Replay, ReplayPlayer, ReplayRecorder } from '@/engine/replay';
import { ensureAudio, isMuted, playSfx, setMuted } from '@/engine/audio/engine';
import {
  getBeatCount,
  getBeatPhase,
  getBpm,
  isMusicRunning,
  startMusic,
  stopMusic,
} from '@/engine/audio/music';
import type { SfxName } from '@/engine/audio/sfx';
import { drainEvents } from '@/game/events';
import type { GameEvent } from '@/game/events';
import { TICK_HZ } from '@/types';
import type { Arena, InputSnapshot, World } from '@/types';

type AppState = 'menu' | 'lobby' | 'match' | 'stats' | 'replay';

const VIEW_W = 1280;
const VIEW_H = 720;

/**
 * Item #4: recompute and apply layer offsets so the arena is centered in the
 * viewport. Pure w.r.t. inputs other than the layer x/y mutation. Called at
 * match start and on every window resize so the arena stays centered when
 * the canvas is rescaled or arenas of different sizes are loaded.
 */
function centerArena(stage: Stage, arena: Arena, viewportW: number, viewportH: number): void {
  const arenaPxW = arena.cols * arena.cellSize;
  const arenaPxH = arena.rows * arena.cellSize;
  const offsetX = (viewportW - arenaPxW) / 2;
  const offsetY = (viewportH - arenaPxH) / 2;
  stage.bgLayer.x = offsetX;
  stage.bgLayer.y = offsetY;
  stage.glowLayer.x = offsetX;
  stage.glowLayer.y = offsetY;
}

const KEY_PAUSE = 'Escape';
const GAMEPAD_START = 9;

async function main(): Promise<void> {
  const parent = document.getElementById('app');
  if (!parent) {
    throw new Error('Beamfall: #app host element missing from index.html');
  }

  const stage: Stage = await createStage(parent, VIEW_W, VIEW_H);

  // --- Input sources -------------------------------------------------------
  const keyboard = new KeyboardSource();
  keyboard.attach();
  const gamepad = new GamepadSource();
  gamepad.attach();

  // --- Audio bootstrap -----------------------------------------------------
  // Browser autoplay policy requires the AudioContext be created from a user
  // gesture. Hook the first key/click to lazy-init; afterwards a no-op.
  const unlockAudio = (): void => {
    ensureAudio();
  };
  window.addEventListener('keydown', unlockAudio, { once: false });
  window.addEventListener('pointerdown', unlockAudio, { once: false });

  // Track game-state transitions for music start/fade.
  let lastWorldState: World['state'] | null = null;

  // --- App state -----------------------------------------------------------
  let appState: AppState = 'menu';

  // Menu owns the hudLayer text initially.
  let menu: Menu | null = createMenu(stage.hudLayer, {
    isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
    isGamepadButtonPressed: (idx: number, btn: number): boolean =>
      gamepad.buttonPressed(idx, btn),
  });

  let lobby: Lobby | null = null;
  let hud: Hud | null = null;
  let worldRenderer: WorldRenderer | null = null;
  let world: World | null = null;
  let statsScreen: StatsScreen | null = null;
  let pauseMenu: PauseMenu | null = null;
  let paused = false;

  // Replay-related state.
  let recorder: ReplayRecorder | null = null;
  let replayPlayer: ReplayPlayer | null = null;
  let replayBadge: Text | null = null;
  // Captured at match-start so we can build the Replay on match-end.
  let recordingMeta: {
    seed: number;
    bindings: World['bindings'];
    characters: World['characters'];
    arenaId: ReturnType<Lobby['arenaId']>;
    mutators: MutatorId[];
  } | null = null;

  const debug = createDebugOverlay(stage);

  // FPS counter sampling.
  let lastFps = 60;
  let frameCount = 0;
  let lastFpsCheck = performance.now();

  const updateFps = (): void => {
    frameCount += 1;
    const now = performance.now();
    if (now - lastFpsCheck >= 1000) {
      lastFps = (frameCount * 1000) / (now - lastFpsCheck);
      frameCount = 0;
      lastFpsCheck = now;
    }
  };

  // Per-tick input provider for the simulation. World and replay-player are
  // captured by closure; the closure picks the right source per tick.
  setInputProvider((): InputSnapshot[] => {
    if (replayPlayer !== null) return replayPlayer.next();
    if (!world) return [];
    const snapshots = buildSnapshots(world.bindings, keyboard, gamepad);
    if (recorder !== null) recorder.record(snapshots);
    return snapshots;
  });

  // Helper: tear down the play surface (renderer + HUD). Used by both
  // match-end transition and pause "Return to Menu".
  const teardownPlaySurface = (): void => {
    if (worldRenderer !== null) {
      worldRenderer.destroy();
      worldRenderer = null;
    }
    if (hud !== null) {
      hud.destroy();
      hud = null;
    }
    if (replayBadge !== null) {
      replayBadge.destroy();
      replayBadge = null;
    }
  };

  // Helper: build a play surface (renderer + HUD) for the current world.
  const buildPlaySurface = (w: World): void => {
    const arenaPxW = w.arena.cols * w.arena.cellSize;
    const arenaPxH = w.arena.rows * w.arena.cellSize;
    centerArena(stage, w.arena, VIEW_W, VIEW_H);
    worldRenderer = createWorldRenderer(stage, arenaPxW, arenaPxH);
    hud = createHud(stage.hudLayer);
  };

  const openMenu = (): void => {
    menu = createMenu(stage.hudLayer, {
      isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
      isGamepadButtonPressed: (idx: number, btn: number): boolean =>
        gamepad.buttonPressed(idx, btn),
    });
    appState = 'menu';
  };

  const openLobby = (): void => {
    lobby = createLobby(stage.hudLayer, {
      isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
      isGamepadConnected: (idx: number): boolean => gamepad.isConnected(idx),
      isGamepadButtonPressed: (idx: number, btn: number): boolean =>
        gamepad.buttonPressed(idx, btn),
    });
    appState = 'lobby';
  };

  // --- Audio helpers --------------------------------------------------------
  // Populate `world.beat` from the music module each tick. Sim systems read it
  // (laserScheduler) but never write back — keeps determinism intact.
  const syncBeat = (w: World): void => {
    if (isMusicRunning()) {
      w.beat = { phase: getBeatPhase(), bpm: getBpm(), count: getBeatCount() };
    } else {
      // Explicitly clear so sim takes the legacy code path.
      delete w.beat;
    }
  };

  // Watch for round/match boundaries to start/stop music.
  const handleWorldStateTransition = (w: World): void => {
    if (lastWorldState !== w.state) {
      const prev = lastWorldState;
      lastWorldState = w.state;
      if (w.state === 'playing' && prev !== 'playing') {
        startMusic();
      } else if (w.state === 'roundEnd' || w.state === 'matchEnd') {
        if (prev === 'playing') stopMusic(w.state === 'matchEnd' ? 1.2 : 0.4);
      }
    }
  };

  // Map a GameEvent to an SFX name. Centralized so the sim never imports SFX.
  const eventToSfx = (ev: GameEvent): SfxName | null => {
    switch (ev.kind) {
      case 'kill':
        if (ev.cause === 'blade') return 'slash';
        if (ev.cause === 'snipe') return 'death';
        return 'death';
      case 'capture':
        return 'capture';
      case 'pickupCollected':
        return 'pickup';
      case 'abilityTrigger':
        switch (ev.class) {
          case 'smash':
          case 'blade':
            return 'dash';
          case 'shock':
            return 'zap';
          case 'ghost':
            return 'teleport';
          case 'thief':
            return 'steal';
          case 'snipe':
            return null; // covered by snipeArm/snipeFire
        }
        return null;
      case 'snipeArm':
        return 'pickup';
      case 'snipeFire':
        return 'teleport';
      case 'roundEnd':
        return 'roundEnd';
      case 'matchEnd':
        return 'matchEnd';
      case 'countdownTick':
        return ev.value <= 0 ? 'countdownGo' : 'countdownTick';
    }
  };

  // --- Loop ----------------------------------------------------------------
  startLoop({
    tickHz: TICK_HZ,
    onPollInputs: (): void => {
      gamepad.poll();
    },
    onTick: (dt: number): void => {
      if (appState === 'menu' && menu !== null) {
        menu.update(VIEW_W, VIEW_H);
        const choice = menu.pick();
        if (choice === 'play') {
          menu.destroy();
          menu = null;
          openLobby();
        } else if (choice === 'replay') {
          const replay = loadReplay();
          if (replay !== null) {
            menu.destroy();
            menu = null;
            startReplay(replay);
          }
        } else if (choice === 'quit') {
          window.close();
        }
      } else if (appState === 'lobby' && lobby !== null) {
        lobby.update(VIEW_W, VIEW_H);
        if (lobby.isReady()) {
          const bindings = lobby.bindings();
          if (bindings.length > 0) {
            const characters = lobby.characters();
            const arenaId = lobby.arenaId();
            const mutators = lobby.mutators();
            lobby.destroy();
            lobby = null;

            // Use an explicit seed so replays reproduce. Date.now() is fine
            // here — wall-clock is consumed exactly once, at match boot, and
            // captured into the replay metadata.
            const seed = Date.now() >>> 0;
            const w = createWorld(bindings, characters, seed, arenaId);
            applyMutators(w, mutators);
            startNewMatch(w);
            world = w;

            // Persist mutator selection.
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem('beamfall:lastMutators', JSON.stringify(mutators));
              }
            } catch {
              // Best-effort.
            }

            // Begin recording. Capture metadata for finalize() at match end.
            recorder = createRecorder();
            recordingMeta = {
              seed,
              bindings: w.bindings.slice(),
              characters: w.characters.slice(),
              arenaId,
              mutators: mutators.slice(),
            };

            buildPlaySurface(w);
            appState = 'match';
          }
        }
      } else if (appState === 'match' && world !== null) {
        // Mute toggle (M). Edge-triggered.
        if (keyboard.wasPressed('KeyM')) setMuted(!isMuted());

        // Pause toggle. Edge-triggered on Escape OR gamepad Start.
        let pauseEdge = keyboard.wasPressed(KEY_PAUSE);
        if (!pauseEdge) {
          for (let g = 0; g < 4; g++) {
            if (gamepad.buttonPressed(g, GAMEPAD_START)) {
              pauseEdge = true;
              break;
            }
          }
        }
        if (pauseEdge) {
          if (paused) {
            paused = false;
            if (pauseMenu !== null) {
              pauseMenu.destroy();
              pauseMenu = null;
            }
          } else {
            paused = true;
            pauseMenu = createPauseMenu(stage.hudLayer, {
              isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
              isGamepadButtonPressed: (idx: number, btn: number): boolean =>
                gamepad.buttonPressed(idx, btn),
            });
          }
        }

        if (paused && pauseMenu !== null) {
          pauseMenu.update(VIEW_W, VIEW_H);
          const choice = pauseMenu.pick();
          if (choice === 'resume') {
            paused = false;
            pauseMenu.destroy();
            pauseMenu = null;
          } else if (choice === 'restart') {
            paused = false;
            pauseMenu.destroy();
            pauseMenu = null;
            startNewRound(world);
          } else if (choice === 'menu') {
            paused = false;
            pauseMenu.destroy();
            pauseMenu = null;
            // Drop the in-progress recording — it's meaningless without a
            // matchEnd transition.
            recorder = null;
            recordingMeta = null;
            stopMusic();
            teardownPlaySurface();
            world = null;
            openMenu();
          }
        } else {
          syncBeat(world);
          tickWorld(world, dt);
          handleWorldStateTransition(world);

          if (world.state === 'matchEnd') {
            // Finalize the recording before tearing anything down.
            if (recorder !== null && recordingMeta !== null) {
              const replay = recorder.finalize(recordingMeta);
              saveReplay(replay);
            }
            recorder = null;
            recordingMeta = null;

            teardownPlaySurface();
            statsScreen = createStatsScreen(stage.hudLayer, world, {
              isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
              isGamepadButtonPressed: (idx: number, btn: number): boolean =>
                gamepad.buttonPressed(idx, btn),
            });
            appState = 'stats';
          }
        }
      } else if (appState === 'replay' && world !== null && replayPlayer !== null) {
        syncBeat(world);
        tickWorld(world, dt);
        handleWorldStateTransition(world);
        // End playback when the recorded inputs run out OR the match has
        // already ended via the recorded sim.
        if (replayPlayer.exhausted() || world.state === 'matchEnd') {
          replayPlayer = null;
          stopMusic();
          teardownPlaySurface();
          world = null;
          openMenu();
        }
      } else if (appState === 'stats' && statsScreen !== null) {
        statsScreen.update(VIEW_W, VIEW_H);
        if (statsScreen.wantsRestart()) {
          statsScreen.destroy();
          statsScreen = null;
          world = null;
          openLobby();
        }
      }

    },
    onPostTicks: (): void => {
      // Item #1: clear edge-triggered keyboard state ONCE per rendered frame,
      // after every tick that fits in the accumulator has consumed edges.
      // Doing this inside onTick would lose edges on the 2nd..Nth tick of a
      // multi-tick frame (e.g. after a tab-pause when the accumulator drains).
      keyboard.clearEdges();
    },
    onRender: (alpha: number): void => {
      updateFps();
      // Drain audio events ONCE per render frame. The drain happens here (not
      // inside the tick) so multiple ticks per frame coalesce into one batch
      // dispatch — and so it sits cleanly on the render-side of the boundary.
      if (world !== null) {
        const events = drainEvents(world.events);
        for (const ev of events) {
          const name = eventToSfx(ev);
          if (name !== null) playSfx(name);
        }
      }
      if (worldRenderer !== null && world !== null) {
        worldRenderer.render(world, alpha);
      }
      if (hud !== null && world !== null) {
        hud.update(world, VIEW_W, VIEW_H);
      }
      debug.update(lastFps, TICK_HZ, world !== null ? world.state : appState);
    },
  });

  // ---------------------------------------------------------------------
  // Replay startup. Builds an identical World from the Replay metadata,
  // installs the recorded-input source, and switches to AppState 'replay'.
  // ---------------------------------------------------------------------
  function startReplay(replay: Replay): void {
    const w = createWorld(replay.bindings, replay.characters, replay.seed, replay.arenaId);
    applyMutators(w, replay.mutators);
    startNewMatch(w);
    world = w;

    replayPlayer = createReplayPlayer(replay);

    buildPlaySurface(w);

    // Small "REPLAY" badge in top-left corner so it's clear which mode we're in.
    replayBadge = new Text({
      text: 'REPLAY',
      style: {
        fontFamily: 'monospace',
        fontSize: 16,
        fill: 0xff5577,
        align: 'left',
        fontWeight: 'bold',
        letterSpacing: 2,
      },
    });
    replayBadge.x = 8;
    replayBadge.y = 8;
    stage.hudLayer.addChild(replayBadge);

    appState = 'replay';
  }

  // --- Resize: keep logical viewport at VIEW_W x VIEW_H, scale via CSS. ----
  // Item #4: re-center the arena on resize so the playfield stays centered
  // even if the loaded arena's cell count or cell size changes mid-run.
  const handleResize = (): void => {
    const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    const canvas = stage.app.canvas;
    canvas.style.width = `${VIEW_W * scale}px`;
    canvas.style.height = `${VIEW_H * scale}px`;
    if (world !== null) {
      centerArena(stage, world.arena, VIEW_W, VIEW_H);
    }
  };
  window.addEventListener('resize', handleResize);
  handleResize();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Beamfall failed to start:', err);
});
