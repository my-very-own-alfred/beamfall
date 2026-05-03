// Beamfall — runtime entrypoint.
// Wires the engine loop, input sources, render stage, world simulation, and
// UI screens (menu / lobby / HUD) together. State machine drives the
// transition: menu -> lobby -> match.

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
} from '@/game/world';
import { createHud } from '@/ui/hud';
import type { Hud } from '@/ui/hud';
import { createLobby } from '@/ui/lobby';
import type { Lobby } from '@/ui/lobby';
import { createMenu } from '@/ui/menu';
import type { Menu } from '@/ui/menu';
import { createStatsScreen } from '@/ui/statsScreen';
import type { StatsScreen } from '@/ui/statsScreen';
import { TICK_HZ } from '@/types';
import type { World } from '@/types';

type AppState = 'menu' | 'lobby' | 'match' | 'stats';

const VIEW_W = 1280;
const VIEW_H = 720;

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

  // Per-tick input provider for the simulation. World is captured by closure
  // and may be null before a match starts.
  setInputProvider(() => {
    if (!world) return [];
    return buildSnapshots(world.bindings, keyboard, gamepad);
  });

  // --- Loop ----------------------------------------------------------------
  startLoop({
    tickHz: TICK_HZ,
    onPollInputs: (): void => {
      // Poll gamepad once per rendered frame. Keyboard state is event-driven
      // and stays current automatically; edges are cleared at end of tick.
      gamepad.poll();
    },
    onTick: (dt: number): void => {
      if (appState === 'menu' && menu !== null) {
        menu.update(VIEW_W, VIEW_H);
        const choice = menu.pick();
        if (choice === 'play') {
          menu.destroy();
          menu = null;
          lobby = createLobby(stage.hudLayer, {
            isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
            isGamepadConnected: (idx: number): boolean => gamepad.isConnected(idx),
            isGamepadButtonPressed: (idx: number, btn: number): boolean =>
              gamepad.buttonPressed(idx, btn),
          });
          appState = 'lobby';
        } else if (choice === 'quit') {
          // Tauri webview: window.close() works when invoked from app context.
          window.close();
        }
      } else if (appState === 'lobby' && lobby !== null) {
        lobby.update(VIEW_W, VIEW_H);
        if (lobby.isReady()) {
          const bindings = lobby.bindings();
          // Guard: lobby.isReady() is gated on at least one binding, but be
          // defensive for the off chance the user somehow advanced empty.
          if (bindings.length > 0) {
            const characters = lobby.characters();
            lobby.destroy();
            lobby = null;

            const w = createWorld(bindings, characters, undefined, lobby.arenaId());
            startNewMatch(w);
            world = w;

            const arenaPxW = w.arena.cols * w.arena.cellSize;
            const arenaPxH = w.arena.rows * w.arena.cellSize;
            // Center the arena in the viewport.
            const offsetX = (VIEW_W - arenaPxW) / 2;
            const offsetY = (VIEW_H - arenaPxH) / 2;
            stage.bgLayer.x = offsetX;
            stage.bgLayer.y = offsetY;
            stage.glowLayer.x = offsetX;
            stage.glowLayer.y = offsetY;

            worldRenderer = createWorldRenderer(stage, arenaPxW, arenaPxH);
            hud = createHud(stage.hudLayer);
            appState = 'match';
          }
        }
      } else if (appState === 'match' && world !== null) {
        tickWorld(world, dt);

        // Match end: tear down play surface and show stats screen. The world
        // already finished its 'matchEnd' transition by this point — we just
        // need to swap the UI.
        if (world.state === 'matchEnd') {
          if (worldRenderer !== null) {
            worldRenderer.destroy();
            worldRenderer = null;
          }
          if (hud !== null) {
            hud.destroy();
            hud = null;
          }
          statsScreen = createStatsScreen(stage.hudLayer, world, {
            isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
            isGamepadButtonPressed: (idx: number, btn: number): boolean =>
              gamepad.buttonPressed(idx, btn),
          });
          appState = 'stats';
        }
      } else if (appState === 'stats' && statsScreen !== null) {
        statsScreen.update(VIEW_W, VIEW_H);
        if (statsScreen.wantsRestart()) {
          statsScreen.destroy();
          statsScreen = null;
          world = null;
          // Re-open the lobby with a fresh component so claims start clean.
          lobby = createLobby(stage.hudLayer, {
            isKeyPressed: (code: string): boolean => keyboard.wasPressed(code),
            isGamepadConnected: (idx: number): boolean => gamepad.isConnected(idx),
            isGamepadButtonPressed: (idx: number, btn: number): boolean =>
              gamepad.buttonPressed(idx, btn),
          });
          appState = 'lobby';
        }
      }

      // Edge-triggered keyboard state must be cleared once per tick AFTER all
      // consumers (menu/lobby/snapshot builder) have read it. Gamepad edges
      // are refreshed implicitly by the next poll() at the start of the next
      // frame; multi-tick frames will only see edges on the first tick, which
      // is acceptable for this MVP.
      keyboard.clearEdges();
    },
    onRender: (alpha: number): void => {
      updateFps();
      if (worldRenderer !== null && world !== null) {
        worldRenderer.render(world, alpha);
      }
      if (hud !== null && world !== null) {
        hud.update(world, VIEW_W, VIEW_H);
      }
      debug.update(lastFps, TICK_HZ, world !== null ? world.state : appState);
    },
  });

  // --- Resize: keep logical viewport at VIEW_W x VIEW_H, scale via CSS. ----
  const handleResize = (): void => {
    const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    const canvas = stage.app.canvas;
    canvas.style.width = `${VIEW_W * scale}px`;
    canvas.style.height = `${VIEW_H * scale}px`;
  };
  window.addEventListener('resize', handleResize);
  handleResize();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Beamfall failed to start:', err);
});
