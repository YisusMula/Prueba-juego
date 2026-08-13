/**
 * Guardado de la partida en curso.
 *
 * Serializar el estado entero es barato precisamente por cómo está hecho el
 * juego: `GameState` es un objeto de datos planos —sin funciones, sin clases,
 * sin `Map` ni `Set` y sin referencias circulares— porque toda la simulación se
 * diseñó para poder ejecutarse y probarse en Node.
 *
 * Como el resto del almacenamiento, todo va envuelto en try/catch: en el modo
 * privado de Safari `localStorage` existe pero lanza al escribir.
 */

import { DIFFICULTIES, type DifficultyId } from '../game/difficulty';
import { isScenarioId } from '../game/scenarios';
import type { GameState } from '../game/state';

const RUN_KEY = 'tower-game:run:v1';

/**
 * Versión del formato. Un guardado con otra versión se descarta en vez de
 * migrarse: una partida a medias puede tener enemigos con campos que ya no
 * existan, ramas renombradas y una oleada generada con otra fórmula. Eso no da
 * un error visible, da una partida sutilmente rota que el jugador no puede
 * detectar.
 */
const SAVE_VERSION = 1;

interface SavedRun {
  version: number;
  /** Momento del guardado, solo informativo. */
  savedAt: number;
  state: GameState;
}

/** Resumen para el botón de continuar, sin cargar la partida entera. */
export interface SavedRunSummary {
  scenarioId: GameState['scenarioId'];
  difficultyId: DifficultyId;
  wave: number;
  lives: number;
}

/**
 * JSON no sabe representar el infinito: `JSON.stringify(Infinity)` produce
 * `null`, y al volver a leerlo el número desaparece.
 *
 * Aquí importa de verdad: `breakawayDistance` vale `Infinity` en los enemigos
 * que nunca abandonan el camino, y con `null` la comparación
 * `distance >= breakawayDistance` se vuelve `distance >= 0`, es decir, cierta
 * desde el primer instante. Se etiquetan al escribir y se recuperan al leer,
 * en vez de arreglar solo ese campo: cualquier campo futuro caería en la misma
 * trampa.
 */
const INFINITY_TAG = '__Infinity';
const NEGATIVE_INFINITY_TAG = '__-Infinity';

function tagNonFinite(_key: string, value: unknown): unknown {
  if (typeof value !== 'number' || Number.isFinite(value)) return value;
  if (value === Number.POSITIVE_INFINITY) return INFINITY_TAG;
  if (value === Number.NEGATIVE_INFINITY) return NEGATIVE_INFINITY_TAG;
  // Un NaN en el estado ya sería un fallo anterior; se guarda como 0 para que
  // al menos la partida restaurada no arrastre el veneno.
  return 0;
}

function untagNonFinite(_key: string, value: unknown): unknown {
  if (value === INFINITY_TAG) return Number.POSITIVE_INFINITY;
  if (value === NEGATIVE_INFINITY_TAG) return Number.NEGATIVE_INFINITY;
  return value;
}

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Sin almacenamiento la partida sigue; solo que no se podrá reanudar.
  }
}

function removeRaw(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Nada que hacer: si no se puede borrar, tampoco se pudo escribir.
  }
}

/**
 * Copia del estado apta para guardar.
 *
 * Los efectos y la cola de sonidos se descartan. No es una optimización: son
 * presentación de un instante ya pasado, y restaurarlos haría aparecer números
 * de daño de impactos de hace media hora y sonar disparos que ya ocurrieron.
 * Vacíos es su estado correcto en el momento de volver.
 */
export function serialiseRun(state: GameState): GameState {
  return { ...state, effects: [], soundQueue: [] };
}

/** Guarda la partida en curso. Una partida terminada no se guarda. */
export function saveRun(state: GameState): void {
  if (state.screen !== 'playing' && state.screen !== 'paused') return;

  const payload: SavedRun = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state: serialiseRun(state),
  };
  writeRaw(RUN_KEY, JSON.stringify(payload, tagNonFinite));
}

export function clearRun(): void {
  removeRaw(RUN_KEY);
}

function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && value in DIFFICULTIES;
}

/**
 * Partida guardada, o null si no hay ninguna utilizable.
 *
 * Se descarta por versión, por contenido ilegible, por escenario o dificultad
 * que ya no existan en el catálogo, y por estar terminada: reanudar una derrota
 * no tiene sentido.
 */
export function loadRun(): GameState | null {
  const raw = readRaw(RUN_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw, untagNonFinite);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { version, state } = parsed as Record<string, unknown>;
    if (version !== SAVE_VERSION) return null;
    if (typeof state !== 'object' || state === null) return null;

    const candidate = state as Partial<GameState>;
    if (!isScenarioId(candidate.scenarioId)) return null;
    if (!isDifficultyId(candidate.difficultyId)) return null;
    if (candidate.screen !== 'playing' && candidate.screen !== 'paused') return null;
    if (!Array.isArray(candidate.towers) || !Array.isArray(candidate.enemies)) return null;
    if (typeof candidate.waveIndex !== 'number' || typeof candidate.lives !== 'number') return null;

    // Los efectos y los sonidos se restauran vacíos aunque el guardado los
    // trajera: un guardado manipulado no debe poder reinyectar presentación.
    return { ...(state as GameState), effects: [], soundQueue: [] };
  } catch {
    return null;
  }
}

/** Resumen de la partida guardada para el botón de continuar. */
export function loadRunSummary(): SavedRunSummary | null {
  const state = loadRun();
  if (!state) return null;
  return {
    scenarioId: state.scenarioId,
    difficultyId: state.difficultyId,
    wave: Math.max(1, state.waveIndex),
    lives: state.lives,
  };
}
