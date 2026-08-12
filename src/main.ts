/** Arranque: cablea estado, render, interfaz, audio y entrada, y corre el bucle. */

import './style.css';

import { createAudioEngine } from './audio/engine';
import { type AbilityId } from './game/abilities';
import {
  type Camera,
  type Viewport,
  clampCamera,
  fitCamera,
  initialCamera,
  zoomCameraAt,
} from './game/camera';
import { DEFAULT_DIFFICULTY, type DifficultyId } from './game/difficulty';
import { DEFAULT_SCENARIO, type ScenarioId } from './game/scenarios';
import type { SpecialisationId } from './game/specialisations';
import { currentTutorialStep } from './game/tutorial';
import { clearRun, loadRun, loadRunSummary, saveRun } from './storage/savegame';
import { isScenarioUnlocked, newlyUnlocked, starsFor } from './game/campaign';
import { cellCenter } from './game/map';
import {
  callNextWave,
  continueEndless,
  createGameState,
  currentScenario,
  displayedWave,
  drainSounds,
  exitToMenu,
  handleWorldTap,
  openScenarioPicker,
  pauseGame,
  repairSelectedTower,
  resumeGame,
  selectAbility,
  sellSelectedTower,
  setSelectedTowerPriority,
  restoreRun,
  specialiseSelectedTower,
  startGame,
  upgradeSelectedTower,
} from './game/state';
import { FIXED_DT, MAX_STEPS_PER_FRAME, step } from './game/step';
import type { TargetPriority } from './game/towers';
import { renderScene } from './render/scene';
import {
  loadMuted,
  loadRecords,
  loadTutorialSeen,
  recordRun,
  saveMuted,
  saveRecords,
  saveTutorialSeen,
} from './storage/records';
import { Hud, type HudView } from './ui/hud';
import { attachPointerControls } from './ui/pointer';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Falta el canvas #scene');

const stage = document.getElementById('stage');

const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Este navegador no soporta canvas 2D');

/** Velocidades de juego que ofrece el HUD. */
const SPEEDS = [1, 2, 3] as const;

const state = createGameState(DEFAULT_DIFFICULTY);
const audio = createAudioEngine(loadMuted());

const view: HudView = {
  speed: 1,
  muted: audio.isMuted(),
  menuDifficulty: DEFAULT_DIFFICULTY,
  records: loadRecords(),
  starsEarned: 0,
  unlockedByWin: null,
  tutorial: false,
  savedRun: loadRunSummary(),
};

/**
 * Si la próxima partida debe llevar la guía. Arranca a cierto la primera vez
 * que se juega y se reactiva desde el menú.
 */
let tutorialPending = !loadTutorialSeen();

/** Último escenario jugado: lo que se reintenta al perder. */
let lastScenarioId: ScenarioId = DEFAULT_SCENARIO;

let viewport: Viewport = { width: 1, height: 1 };
let camera: Camera = fitCamera(viewport);
let pointer: { x: number; y: number } | null = null;
let devicePixelRatioUsed = 1;
/** Vidas de la última comprobación, para sacudir la pantalla al perder una. */
let lastLives = state.lives;
/** La pantalla anterior, para registrar el récord justo al terminar la partida. */
let lastScreen = state.screen;

/** Vista de arranque de una partida: la entrada del camino, bien visible. */
function openingCamera(): Camera {
  // La primera entrada del escenario. Con dos portones da igual cuál: el
  // jugador va a desplazarse igualmente, y encuadrar una es más legible que
  // encuadrar el punto medio entre las dos, que no es nada en particular.
  const spawn = currentScenario(state).spawnCells[0];
  if (!spawn) return fitCamera(viewport);
  return initialCamera(viewport, cellCenter(spawn.col, spawn.row));
}

/**
 * Publica la altura real de los paneles en variables CSS.
 *
 * El HUD envuelve su contenido en pantallas estrechas, así que mide más que su
 * `min-height`. Sin esta medida, el aviso de oleada y el panel de torre se
 * colocan usando la altura de diseño y quedan tapados por el propio HUD.
 */
function measurePanels(): void {
  const root = document.documentElement;
  const hud = document.getElementById('hud');
  const shop = document.getElementById('shop');
  if (hud) root.style.setProperty('--hud-actual', `${hud.offsetHeight}px`);
  if (shop) root.style.setProperty('--shop-actual', `${shop.offsetHeight}px`);
}

function resize(): void {
  measurePanels();
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

/** Cualquier interacción sirve para desbloquear el audio del navegador. */
function unlockAudio(): void {
  audio.unlock();
}

/** Guarda la partida y refresca lo que el menú enseñará al volver. */
function persistRun(): void {
  saveRun(state);
  view.savedRun = loadRunSummary();
}

/** Descarta la partida guardada: ya no hay nada que reanudar. */
function forgetRun(): void {
  clearRun();
  view.savedRun = null;
  hud.setView(view);
}

function beginRun(difficultyId: DifficultyId, scenarioId: ScenarioId): void {
  // Un escenario bloqueado no arranca partida: la comprobación va aquí, donde
  // se conocen los récords, y no dentro de la simulación.
  if (!startGame(state, difficultyId, scenarioId, isScenarioUnlocked(view.records, scenarioId))) {
    return;
  }
  lastScenarioId = scenarioId;
  view.tutorial = tutorialPending;
  // La partida nueva sustituye a la guardada desde el primer instante: si el
  // jugador cierra ahora, lo que reanude debe ser esta, no la anterior.
  persistRun();
  camera = openingCamera();
  lastLives = state.lives;
  lastScreen = state.screen;
  drainSounds(state);
  hud.setView(view);
  hud.sync();
}

const hud = new Hud(state, view, {
  onStart: () => {
    unlockAudio();
    openScenarioPicker(state, view.menuDifficulty);
    hud.sync();
  },
  onPickScenario: (scenarioId: ScenarioId) => {
    unlockAudio();
    beginRun(view.menuDifficulty, scenarioId);
  },
  onBackToMenu: () => {
    exitToMenu(state);
    hud.sync();
  },
  onContinueRun: () => {
    unlockAudio();
    const saved = loadRun();
    if (!saved) return;

    restoreRun(state, saved);
    // Se reanuda **en pausa**. Volver una hora después y encontrarse la oleada
    // 22 ya en marcha no da tiempo a reconocer el tablero; el jugador ve dónde
    // estaba y arranca cuando quiere.
    pauseGame(state);
    lastScenarioId = state.scenarioId;
    // Reanudar no activa la guía: en una partida a medias sus primeros pasos
    // ya están cumplidos y solo enseñaría el último fuera de contexto.
    view.tutorial = false;
    camera = openingCamera();
    lastLives = state.lives;
    lastScreen = state.screen;
    hud.setView(view);
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
    // Salir al menú descarta: es una decisión explícita de abandonar, y
    // conservarlo haría reaparecer Continuar justo después de irse.
    exitToMenu(state);
    forgetRun();
    hud.sync();
  },
  onRetry: () => {
    unlockAudio();
    beginRun(state.difficultyId, lastScenarioId);
  },
  onUpgrade: () => {
    upgradeSelectedTower(state);
    hud.sync();
  },
  onRepair: () => {
    repairSelectedTower(state);
    hud.sync();
  },
  onSell: () => {
    sellSelectedTower(state);
    hud.sync();
  },
  onSetPriority: (priority: TargetPriority) => {
    setSelectedTowerPriority(state, priority);
    hud.sync();
  },
  onSpecialise: (id: SpecialisationId) => {
    specialiseSelectedTower(state, id);
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
  onSetSpeed: (speed: number) => {
    view.speed = SPEEDS.includes(speed as (typeof SPEEDS)[number]) ? speed : 1;
    hud.setView(view);
    hud.sync();
  },
  onCallWave: () => {
    unlockAudio();
    callNextWave(state);
    hud.sync();
  },
  onToggleMute: () => {
    const muted = !audio.isMuted();
    audio.setMuted(muted);
    saveMuted(muted);
    view.muted = muted;
    if (!muted) audio.unlock();
    hud.setView(view);
    hud.sync();
  },
  onSelectAbility: (id: AbilityId) => {
    unlockAudio();
    selectAbility(state, id);
    hud.sync();
  },
  onSelectDifficulty: (id: DifficultyId) => {
    view.menuDifficulty = id;
    hud.setView(view);
    hud.sync();
  },
  onContinueEndless: () => {
    continueEndless(state);
    hud.sync();
  },
  onSkipTutorial: () => {
    // Saltarla cuenta como haberla visto: quien la salta ha decidido que no la
    // necesita, y volver a ofrecérsela sería insistir.
    view.tutorial = false;
    tutorialPending = false;
    saveTutorialSeen(true);
    hud.setView(view);
    hud.sync();
  },
  onReplayTutorial: () => {
    tutorialPending = true;
    saveTutorialSeen(false);
    hud.setView(view);
    hud.sync();
  },
});

attachPointerControls(canvas, {
  getCamera: () => camera,
  setCamera: (next) => {
    camera = next;
  },
  getViewport: () => viewport,
  onTap: (worldX, worldY) => {
    unlockAudio();
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

// El hueco del escenario también cambia sin que haya `resize`: al aplicarse
// una media query, al cargar una fuente o al aparecer la barra del navegador.
// Los paneles se vigilan aparte porque su contenido se reorganiza en varias
// filas según el ancho, y de ahí sale la altura que usa todo lo demás.
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(resize);
  for (const id of ['stage', 'hud', 'shop']) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

// Pausa automática al perder el foco: nadie quiere volver y encontrarse sin vidas.
// Pausar y **guardar** al ocultarse la pestaña. En un móvil este es el último
// aviso antes de que el sistema pueda reciclarla, así que es el guardado que
// de verdad importa.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame(state);
    persistRun();
    hud.sync();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.screen === 'playing') pauseGame(state);
    else if (state.screen === 'paused') resumeGame(state);
    hud.sync();
    return;
  }

  if (state.screen !== 'playing') return;

  // Atajos de velocidad y habilidades para quien juega con teclado.
  if (event.key === '1' || event.key === '2' || event.key === '3') {
    view.speed = Number(event.key);
    hud.setView(view);
    hud.sync();
    return;
  }
  if (event.key.toLowerCase() === 'q') {
    unlockAudio();
    selectAbility(state, 'meteor');
    hud.sync();
    return;
  }
  if (event.key.toLowerCase() === 'w') {
    unlockAudio();
    selectAbility(state, 'blizzard');
    hud.sync();
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    unlockAudio();
    callNextWave(state);
    hud.sync();
  }
});

/** Reproduce lo que la simulación haya encolado en este frame. */
function playQueuedSounds(): void {
  for (const id of drainSounds(state)) audio.play(id);
}

/** Sacude el escenario cuando el jugador acaba de perder una vida. */
function reactToLifeLoss(): void {
  if (state.lives < lastLives && stage) {
    stage.classList.remove('is-shaking');
    // Reiniciar la animación exige forzar un reflow entre quitar y poner.
    void stage.offsetWidth;
    stage.classList.add('is-shaking');
  }
  lastLives = state.lives;
}

/** Registra el récord justo en la transición a victoria o derrota. */
function reactToRunEnd(): void {
  const ended = state.screen === 'defeat' || state.screen === 'victory';
  const justEnded = ended && lastScreen !== state.screen;

  if (justEnded) {
    const before = view.records;
    const { records } = recordRun(
      before,
      state.scenarioId,
      state.difficultyId,
      displayedWave(state),
      state.stats.kills,
      state.screen === 'victory',
    );
    view.records = records;
    // La partida ha terminado: ya no hay nada que reanudar.
    forgetRun();
    view.starsEarned = starsFor(records, state.scenarioId);
    view.unlockedByWin = newlyUnlocked(before, records);
    saveRecords(records);
    hud.setView(view);
  }

  lastScreen = state.screen;
}

/**
 * Completar la guía cuenta como haberla visto. Se comprueba en el bucle porque
 * el último paso se cumple al especializar una torre, y no hay un evento de
 * "guía terminada" que escuchar: el paso actual es una consulta sobre el
 * estado, así que su desaparición también lo es.
 */
function reactToTutorial(): void {
  if (!view.tutorial) return;
  if (currentTutorialStep(state) !== null) return;

  view.tutorial = false;
  tutorialPending = false;
  saveTutorialSeen(true);
  hud.setView(view);
}

/**
 * Cada cuánto se guarda la partida en curso. No se guarda en cada paso: sesenta
 * escrituras síncronas por segundo a `localStorage` se notarían en los
 * fotogramas y no compran nada frente a hacerlo cada pocos segundos, porque el
 * guardado que de verdad salva la partida es el de `visibilitychange`.
 */
const AUTOSAVE_SECONDS = 4;

let previousTime = performance.now();
let accumulator = 0;
let sinceSave = 0;

function autosave(elapsed: number): void {
  if (state.screen !== 'playing') return;
  sinceSave += elapsed;
  if (sinceSave < AUTOSAVE_SECONDS) return;
  sinceSave = 0;
  persistRun();
}

function frame(now: number): void {
  const elapsed = Math.min((now - previousTime) / 1000, 0.5);
  previousTime = now;
  accumulator += elapsed;

  // La velocidad multiplica cuántos pasos fijos se ejecutan, nunca el `dt`:
  // así una partida a 3x produce exactamente los mismos estados que a 1x,
  // solo que en un tercio de tiempo real.
  const maxSteps = MAX_STEPS_PER_FRAME * view.speed;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < maxSteps) {
    for (let repeat = 0; repeat < view.speed && accumulator >= FIXED_DT; repeat += 1) {
      step(state, FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }
  }
  // Si el navegador estuvo parado mucho tiempo, descarta el retraso acumulado.
  if (steps >= maxSteps) accumulator = 0;

  playQueuedSounds();
  reactToLifeLoss();
  reactToRunEnd();
  reactToTutorial();
  autosave(elapsed);

  canvas!.classList.toggle('is-placing', state.shopSelection !== null);
  canvas!.classList.toggle('is-aiming', state.aimingAbility !== null);

  renderScene(ctx!, state, camera, viewport, devicePixelRatioUsed, { pointer });
  hud.sync();

  requestAnimationFrame(frame);
}

/**
 * Registra el service worker que hace el juego jugable sin conexión.
 *
 * Va después de `load` y envuelto: instalarlo compite por ancho de banda con lo
 * que hace falta para empezar a jugar, y un juego que no arrancara porque no
 * pudo instalarse el modo sin conexión sería mucho peor que uno que
 * simplemente no lo tiene.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void (async () => {
      try {
        await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href, {
          scope: './',
        });
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: 'cache-shell', urls: loadedResources() });
      } catch {
        // Sin modo sin conexión, pero jugable: es la situación de siempre.
      }
    })();
  });
}

/**
 * Lo que esta página ha cargado de verdad, para que el service worker lo
 * guarde. Él no controló la primera carga, así que sin esta lista la caché se
 * quedaría vacía y el juego no arrancaría sin red.
 */
function loadedResources(): string[] {
  const urls = new Set<string>([document.baseURI, location.href]);
  try {
    for (const entry of performance.getEntriesByType('resource')) {
      const url = new URL(entry.name, location.href);
      if (url.origin === location.origin) urls.add(url.href);
    }
  } catch {
    // `performance` incompleto: con el documento en la caché ya se gana algo.
  }
  return [...urls];
}

registerServiceWorker();

resize();
camera = openingCamera();
hud.sync();
requestAnimationFrame(frame);
