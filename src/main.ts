/** Arranque: cablea estado, render, interfaz y entrada, y corre el bucle. */

import './style.css';

import {
  type Camera,
  type Viewport,
  clampCamera,
  fitCamera,
  initialCamera,
  zoomCameraAt,
} from './game/camera';
import {
  createGameState,
  exitToMenu,
  handleWorldTap,
  pauseGame,
  resumeGame,
  startGame,
  upgradeSelectedTower,
} from './game/state';
import { FIXED_DT, MAX_STEPS_PER_FRAME, step } from './game/step';
import { SPAWN_CELL, cellCenter } from './game/map';
import { renderScene } from './render/scene';
import { Hud } from './ui/hud';
import { attachPointerControls } from './ui/pointer';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Falta el canvas #scene');

const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Este navegador no soporta canvas 2D');

const state = createGameState();
let viewport: Viewport = { width: 1, height: 1 };
let camera: Camera = fitCamera(viewport);

/** Vista de arranque de una partida: la entrada del camino, bien visible. */
function openingCamera(): Camera {
  return initialCamera(viewport, cellCenter(SPAWN_CELL.col, SPAWN_CELL.row));
}
let pointer: { x: number; y: number } | null = null;
let devicePixelRatioUsed = 1;

function resize(): void {
  const rect = canvas!.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  viewport = { width, height };
  devicePixelRatioUsed = dpr;
  canvas!.width = Math.round(width * dpr);
  canvas!.height = Math.round(height * dpr);

  camera = clampCamera(camera, viewport);
}

const hud = new Hud(state, {
  onStart: () => {
    startGame(state);
    camera = openingCamera();
    hud.sync();
  },
  onPause: () => {
    pauseGame(state);
    hud.sync();
  },
  onResume: () => {
    resumeGame(state);
    hud.sync();
  },
  onQuit: () => {
    exitToMenu(state);
    hud.sync();
  },
  onRetry: () => {
    startGame(state);
    camera = openingCamera();
    hud.sync();
  },
  onUpgrade: () => {
    upgradeSelectedTower(state);
    hud.sync();
  },
  onCloseTowerPanel: () => {
    state.selectedTowerId = null;
    hud.sync();
  },
  onZoomIn: () => {
    camera = zoomCameraAt(camera, viewport, 1.25, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
  },
  onZoomOut: () => {
    camera = zoomCameraAt(camera, viewport, 0.8, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
  },
  onZoomFit: () => {
    camera = fitCamera(viewport);
  },
});

attachPointerControls(canvas, {
  getCamera: () => camera,
  setCamera: (next) => {
    camera = next;
  },
  getViewport: () => viewport,
  onTap: (worldX, worldY) => {
    handleWorldTap(state, worldX, worldY);
    hud.sync();
  },
  onHover: (position) => {
    pointer = position;
  },
  onPanStateChange: (panning) => {
    canvas.classList.toggle('is-panning', panning);
  },
});

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

// Pausa automática al perder el foco: nadie quiere volver y encontrarse sin vidas.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame(state);
    hud.sync();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.screen === 'playing') pauseGame(state);
    else if (state.screen === 'paused') resumeGame(state);
    hud.sync();
  }
});

let previousTime = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - previousTime) / 1000, 0.5);
  previousTime = now;
  accumulator += elapsed;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    step(state, FIXED_DT);
    accumulator -= FIXED_DT;
    steps += 1;
  }
  // Si el navegador estuvo parado mucho tiempo, descarta el retraso acumulado.
  if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;

  canvas!.classList.toggle('is-placing', state.shopSelection !== null);

  renderScene(ctx!, state, camera, viewport, devicePixelRatioUsed, { pointer });
  hud.sync();

  requestAnimationFrame(frame);
}

resize();
camera = openingCamera();
hud.sync();
requestAnimationFrame(frame);
