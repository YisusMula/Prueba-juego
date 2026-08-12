/**
 * Persistencia de récords y preferencias.
 *
 * Todo acceso a `localStorage` va envuelto en try/catch: en el modo privado
 * de Safari y en iframes con cookies bloqueadas, `localStorage` existe pero
 * lanza al escribir. Un juego que revienta ahí está roto para una parte real
 * de sus jugadores, así que ante cualquier fallo se devuelven valores por
 * defecto y la partida sigue.
 */

import { DIFFICULTY_ORDER, type DifficultyId } from '../game/difficulty';
import { SCENARIO_LIST, type ScenarioId } from '../game/scenarios';

/**
 * La versión sube cada vez que cambia la forma del récord: primero al pasar de
 * "uno por dificultad" a "uno por escenario y dificultad", y ahora al añadir si
 * la partida se ganó. Con la clave anterior, un formato viejo se leería como
 * nuevo y las estrellas saldrían de datos que no dicen lo que aparentan.
 */
const RECORDS_KEY = 'tower-game:records:v3';
const MUTED_KEY = 'tower-game:muted:v1';

export interface RunRecord {
  bestWave: number;
  bestKills: number;
  /**
   * Si alguna vez se ganó en esta combinación.
   *
   * No basta con `bestWave`: perder en la oleada final la deja igual que
   * ganarla, y de hecho el simulador de balance muere justo ahí en Difícil.
   * Deducir la victoria de la oleada daría estrellas por perder en el último
   * asalto.
   */
  won: boolean;
}

/** Récords indexados por escenario y, dentro de cada uno, por dificultad. */
export type Records = Record<ScenarioId, Record<DifficultyId, RunRecord>>;

const EMPTY: RunRecord = { bestWave: 0, bestKills: 0, won: false };

export function emptyRecords(): Records {
  const records = {} as Records;
  for (const scene of SCENARIO_LIST) {
    const byDifficulty = {} as Record<DifficultyId, RunRecord>;
    for (const id of DIFFICULTY_ORDER) byDifficulty[id] = { ...EMPTY };
    records[scene.id] = byDifficulty;
  }
  return records;
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
    // Sin almacenamiento el juego sigue funcionando, solo que sin memoria.
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toRecord(entry: unknown): RunRecord {
  if (typeof entry !== 'object' || entry === null) return { ...EMPTY };
  const { bestWave, bestKills, won } = entry as Record<string, unknown>;
  return {
    bestWave: isFiniteNumber(bestWave) ? Math.max(0, Math.floor(bestWave)) : 0,
    bestKills: isFiniteNumber(bestKills) ? Math.max(0, Math.floor(bestKills)) : 0,
    won: won === true,
  };
}

export function loadRecords(): Records {
  const records = emptyRecords();
  const raw = readRaw(RECORDS_KEY);
  if (!raw) return records;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return records;

    for (const scene of SCENARIO_LIST) {
      const byScenario: unknown = (parsed as Record<string, unknown>)[scene.id];
      if (typeof byScenario !== 'object' || byScenario === null) continue;
      for (const id of DIFFICULTY_ORDER) {
        records[scene.id][id] = toRecord((byScenario as Record<string, unknown>)[id]);
      }
    }
  } catch {
    return emptyRecords();
  }

  return records;
}

export function saveRecords(records: Records): void {
  writeRaw(RECORDS_KEY, JSON.stringify(records));
}

/** Récord de un escenario y una dificultad concretos. */
export function recordFor(
  records: Records,
  scenarioId: ScenarioId,
  difficultyId: DifficultyId,
): RunRecord {
  return records[scenarioId]?.[difficultyId] ?? { ...EMPTY };
}

/**
 * Mejor marca de una dificultad entre todos los escenarios. Es lo que enseña el
 * menú principal, donde todavía no se ha elegido mapa.
 */
export function bestRecordFor(records: Records, difficultyId: DifficultyId): RunRecord {
  let best: RunRecord = { ...EMPTY };
  for (const scene of SCENARIO_LIST) {
    const entry = recordFor(records, scene.id, difficultyId);
    if (entry.bestWave > best.bestWave) best = entry;
  }
  return best;
}

/**
 * Registra el resultado de una partida. Solo mejora los récords, nunca los
 * empeora, y solo toca el escenario y la dificultad jugados. Devuelve los
 * récords ya actualizados y si se ha batido la marca.
 */
export function recordRun(
  records: Records,
  scenarioId: ScenarioId,
  difficultyId: DifficultyId,
  wave: number,
  kills: number,
  won = false,
): { records: Records; beatenWave: boolean } {
  const previous = recordFor(records, scenarioId, difficultyId);
  const beatenWave = wave > previous.bestWave;

  const updated: Records = {
    ...records,
    [scenarioId]: {
      ...records[scenarioId],
      [difficultyId]: {
        bestWave: Math.max(previous.bestWave, Math.max(0, Math.floor(wave))),
        bestKills: Math.max(previous.bestKills, Math.max(0, Math.floor(kills))),
        // Una victoria no se borra: jugar peor después no deshace lo logrado.
        won: previous.won || won,
      },
    },
  };

  return { records: updated, beatenWave };
}

export function loadMuted(): boolean {
  return readRaw(MUTED_KEY) === '1';
}

export function saveMuted(muted: boolean): void {
  writeRaw(MUTED_KEY, muted ? '1' : '0');
}
