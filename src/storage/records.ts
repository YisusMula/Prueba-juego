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

const RECORDS_KEY = 'tower-game:records:v1';
const MUTED_KEY = 'tower-game:muted:v1';

export interface DifficultyRecord {
  bestWave: number;
  bestKills: number;
}

export type Records = Record<DifficultyId, DifficultyRecord>;

function emptyRecords(): Records {
  return {
    easy: { bestWave: 0, bestKills: 0 },
    normal: { bestWave: 0, bestKills: 0 },
    hard: { bestWave: 0, bestKills: 0 },
  };
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

export function loadRecords(): Records {
  const records = emptyRecords();
  const raw = readRaw(RECORDS_KEY);
  if (!raw) return records;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return records;

    for (const id of DIFFICULTY_ORDER) {
      const entry: unknown = (parsed as Record<string, unknown>)[id];
      if (typeof entry !== 'object' || entry === null) continue;
      const { bestWave, bestKills } = entry as Record<string, unknown>;
      records[id] = {
        bestWave: isFiniteNumber(bestWave) ? Math.max(0, Math.floor(bestWave)) : 0,
        bestKills: isFiniteNumber(bestKills) ? Math.max(0, Math.floor(bestKills)) : 0,
      };
    }
  } catch {
    return emptyRecords();
  }

  return records;
}

export function saveRecords(records: Records): void {
  writeRaw(RECORDS_KEY, JSON.stringify(records));
}

/**
 * Registra el resultado de una partida. Solo mejora los récords, nunca los
 * empeora, y solo toca la dificultad jugada. Devuelve los récords ya
 * actualizados y si alguno ha batido su marca.
 */
export function recordRun(
  records: Records,
  difficultyId: DifficultyId,
  wave: number,
  kills: number,
): { records: Records; beatenWave: boolean } {
  const previous = records[difficultyId];
  const beatenWave = wave > previous.bestWave;

  const updated: Records = {
    ...records,
    [difficultyId]: {
      bestWave: Math.max(previous.bestWave, Math.max(0, Math.floor(wave))),
      bestKills: Math.max(previous.bestKills, Math.max(0, Math.floor(kills))),
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
