/**
 * Progreso de campaña: estrellas y desbloqueo de escenarios.
 *
 * Todo aquí es una **consulta pura sobre los récords**. No hay una lista de
 * escenarios desbloqueados guardada aparte: serían dos verdades sobre lo mismo,
 * y en cuanto una se escribiera sin la otra el jugador podría acabar con un
 * escenario abierto que no ha ganado, o cerrado uno que sí. Con una sola cosa
 * guardada —lo conseguido— no hay nada que sincronizar.
 */

import { DIFFICULTY_ORDER, type DifficultyId } from './difficulty';
import { SCENARIO_LIST, type ScenarioId } from './scenarios';
import { type Records, recordFor } from '../storage/records';

/** Estrellas que concede ganar en cada dificultad. */
export const STARS_BY_DIFFICULTY: Readonly<Record<DifficultyId, number>> = {
  easy: 1,
  normal: 2,
  hard: 3,
};

/** Estrellas máximas de un escenario. */
export const MAX_STARS_PER_SCENARIO = 3;

/**
 * Estrellas de un escenario: las de la **dificultad más alta ganada**, no la
 * suma de las ganadas.
 *
 * Sumando, ganar en Difícil dejaría pendientes repetirlo en Fácil y en Normal,
 * dos tareas que no enseñan nada y que solo se harían por completismo. Con la
 * más alta, las estrellas dicen cómo de bien has resuelto el escenario en vez
 * de cuántas veces lo has repetido.
 */
export function starsFor(records: Records, scenarioId: ScenarioId): number {
  let stars = 0;
  for (const difficultyId of DIFFICULTY_ORDER) {
    if (!recordFor(records, scenarioId, difficultyId).won) continue;
    stars = Math.max(stars, STARS_BY_DIFFICULTY[difficultyId]);
  }
  return stars;
}

/** Posición del escenario en el catálogo, o -1 si no está. */
function indexOf(scenarioId: ScenarioId): number {
  return SCENARIO_LIST.findIndex((scene) => scene.id === scenarioId);
}

/**
 * Un escenario está abierto si es el primero o si el anterior tiene al menos
 * una estrella.
 *
 * Una estrella es "lo has ganado en Fácil", que es exactamente el listón para
 * decir que has entendido el mapa. Pedir dos obligaría a jugar en Normal para
 * avanzar y convertiría la dificultad en un peaje en vez de en una elección.
 */
export function isScenarioUnlocked(records: Records, scenarioId: ScenarioId): boolean {
  const index = indexOf(scenarioId);
  if (index <= 0) return index === 0;
  const previous = SCENARIO_LIST[index - 1];
  return previous ? starsFor(records, previous.id) > 0 : true;
}

/** Escenario que hay que superar para abrir este, o null si ya está abierto. */
export function unlockRequirement(
  records: Records,
  scenarioId: ScenarioId,
): { name: string } | null {
  if (isScenarioUnlocked(records, scenarioId)) return null;
  const previous = SCENARIO_LIST[indexOf(scenarioId) - 1];
  return previous ? { name: previous.name } : null;
}

export function totalStars(records: Records): number {
  return SCENARIO_LIST.reduce((sum, scene) => sum + starsFor(records, scene.id), 0);
}

export function maxStars(): number {
  return SCENARIO_LIST.length * MAX_STARS_PER_SCENARIO;
}

/**
 * Escenario que una victoria acaba de abrir, si es que ha abierto alguno.
 * Se calcula comparando el antes y el después, que es lo único que distingue
 * "ya estaba abierto" de "lo acabas de abrir".
 */
export function newlyUnlocked(before: Records, after: Records): { name: string } | null {
  for (const scene of SCENARIO_LIST) {
    if (!isScenarioUnlocked(before, scene.id) && isScenarioUnlocked(after, scene.id)) {
      return { name: scene.name };
    }
  }
  return null;
}
