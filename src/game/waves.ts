/**
 * Definición de oleadas. Se generan por fórmula en lugar de a mano para que
 * la dificultad crezca de forma estrictamente monótona y el juego no tenga
 * un final artificial.
 *
 * Cada tipo se introduce a partir de su propia oleada. Como un tipo con
 * capacidades especiales (dañar torres, abandonar el camino) simplemente no
 * existe antes de esa oleada, "nadie hace X antes de su oleada" se cumple
 * por construcción, sin necesitar una condición aparte por capacidad.
 */

import { ENEMY_TYPES, type EnemyTypeId } from './enemies';

/** Primera oleada de cada tipo, en el orden en que se introducen. */
export const FIRST_FOX_WAVE = 2;
export const FIRST_SPIDER_WAVE = 3;
export const FIRST_AIR_WAVE = 4;
export const FIRST_BEETLE_WAVE = 5;
export const FIRST_DOG_WAVE = 6;
export const FIRST_BOAR_WAVE = 7;
export const FIRST_SLIME_WAVE = 8;
export const FIRST_EAGLE_WAVE = 9;
export const FIRST_GOBLIN_WAVE = 11;
export const FIRST_VULTURE_WAVE = 13;
export const FIRST_SHAMAN_WAVE = 14;
export const FIRST_ORC_WAVE = 16;
export const FIRST_GOLEM_WAVE = 18;
/** Cada cuántas oleadas aparece un jefe. */
export const BOSS_EVERY = 10;

/** Factor de crecimiento de la vida de los enemigos por oleada. */
export const HP_GROWTH = 1.085;
/** Crecimiento de velocidad por oleada, acotado para no volverse absurdo. */
export const SPEED_GROWTH_PER_WAVE = 0.012;
export const MAX_SPEED_MULTIPLIER = 1.5;

export interface WaveGroup {
  typeId: EnemyTypeId;
  count: number;
}

export interface Wave {
  index: number;
  groups: WaveGroup[];
  /** Segundos entre dos apariciones consecutivas. */
  spawnInterval: number;
  /** Multiplicador de puntos de vida aplicado a los enemigos de la oleada. */
  hpMultiplier: number;
  /** Multiplicador de velocidad aplicado a los enemigos de la oleada. */
  speedMultiplier: number;
}

function positiveCount(value: number): number {
  return Math.max(0, Math.floor(value));
}

export function getWave(index: number): Wave {
  const n = Math.max(1, Math.floor(index));
  const groups: WaveGroup[] = [];

  groups.push({ typeId: 'rat', count: 5 + positiveCount(n * 1.3) });

  if (n >= FIRST_FOX_WAVE) {
    groups.push({ typeId: 'fox', count: 2 + positiveCount((n - FIRST_FOX_WAVE + 1) * 0.6) });
  }
  if (n >= FIRST_SPIDER_WAVE) {
    groups.push({ typeId: 'spider', count: 2 + positiveCount((n - FIRST_SPIDER_WAVE) * 0.5) });
  }
  if (n >= FIRST_AIR_WAVE) {
    groups.push({ typeId: 'bat', count: 1 + positiveCount((n - FIRST_AIR_WAVE) * 0.6) });
  }
  if (n >= FIRST_BEETLE_WAVE) {
    groups.push({ typeId: 'beetle', count: 1 + positiveCount((n - FIRST_BEETLE_WAVE) * 0.5) });
  }
  if (n >= FIRST_DOG_WAVE) {
    groups.push({ typeId: 'dog', count: 1 + positiveCount((n - FIRST_DOG_WAVE) * 0.5) });
  }
  if (n >= FIRST_BOAR_WAVE) {
    groups.push({ typeId: 'boar', count: 1 + positiveCount((n - FIRST_BOAR_WAVE) * 0.4) });
  }
  if (n >= FIRST_SLIME_WAVE) {
    groups.push({ typeId: 'slime', count: 1 + positiveCount((n - FIRST_SLIME_WAVE) * 0.35) });
  }
  if (n >= FIRST_EAGLE_WAVE) {
    groups.push({ typeId: 'eagle', count: 1 + positiveCount((n - FIRST_EAGLE_WAVE) * 0.4) });
  }
  if (n >= FIRST_GOBLIN_WAVE) {
    groups.push({ typeId: 'goblin', count: 1 + positiveCount((n - FIRST_GOBLIN_WAVE) * 0.4) });
  }
  if (n >= FIRST_VULTURE_WAVE) {
    groups.push({ typeId: 'vulture', count: 1 + positiveCount((n - FIRST_VULTURE_WAVE) * 0.35) });
  }
  if (n >= FIRST_SHAMAN_WAVE) {
    // Pocos y espaciados: el sanador es un problema de prioridades, no de
    // volumen. Con muchos a la vez el jugador no podría reaccionar.
    groups.push({ typeId: 'shaman', count: 1 + positiveCount((n - FIRST_SHAMAN_WAVE) * 0.2) });
  }
  if (n >= FIRST_ORC_WAVE) {
    groups.push({ typeId: 'orc', count: 1 + positiveCount((n - FIRST_ORC_WAVE) * 0.3) });
  }
  if (n >= FIRST_GOLEM_WAVE) {
    groups.push({ typeId: 'golem', count: 1 + positiveCount((n - FIRST_GOLEM_WAVE) * 0.3) });
  }
  // Los jefes son acumulativos: una vez aparecen, se quedan. Si solo salieran
  // en los múltiplos exactos, la oleada siguiente sería más fácil que la
  // anterior y la dificultad dejaría de crecer.
  if (n >= BOSS_EVERY) {
    groups.push({ typeId: 'warlord', count: Math.floor(n / BOSS_EVERY) });
  }

  return {
    index: n,
    groups,
    spawnInterval: Math.max(0.3, 1.05 - n * 0.02),
    // Crecimiento geométrico: las torres tienen nivel máximo, así que un
    // escalado lineal acabaría siendo trivial de superar y la partida no
    // terminaría nunca.
    hpMultiplier: HP_GROWTH ** (n - 1),
    speedMultiplier: Math.min(MAX_SPEED_MULTIPLIER, 1 + SPEED_GROWTH_PER_WAVE * (n - 1)),
  };
}

export interface WaveDescription {
  index: number;
  groups: { typeId: EnemyTypeId; name: string; count: number }[];
  total: number;
  /** La oleada trae criaturas voladoras. */
  hasAir: boolean;
  /** La oleada trae criaturas capaces de dañar torres. */
  hasTowerAttackers: boolean;
  /** La oleada trae criaturas capaces de abandonar el camino. */
  hasPathSkippers: boolean;
  /** La oleada trae criaturas con armadura. */
  hasArmored: boolean;
  /** La oleada trae criaturas que curan a las demás. */
  hasHealers: boolean;
  /** La oleada trae criaturas que se dividen al morir. */
  hasSplitters: boolean;
}

/**
 * Composición de una oleada sin generarla. Es una consulta pura: no toca el
 * estado de la partida, así que la interfaz puede llamarla libremente para
 * enseñar al jugador lo que le viene encima.
 */
export function describeWave(index: number): WaveDescription {
  const wave = getWave(index);
  const groups = wave.groups.map((group) => ({
    typeId: group.typeId,
    name: ENEMY_TYPES[group.typeId].name,
    count: group.count,
  }));

  return {
    index: wave.index,
    groups,
    total: waveEnemyCount(wave),
    hasAir: wave.groups.some((group) => ENEMY_TYPES[group.typeId].domain === 'air'),
    hasTowerAttackers: wave.groups.some(
      (group) => ENEMY_TYPES[group.typeId].canDamageTowers,
    ),
    hasPathSkippers: wave.groups.some((group) => ENEMY_TYPES[group.typeId].canSkipPath),
    hasArmored: wave.groups.some((group) => ENEMY_TYPES[group.typeId].armor > 0),
    hasHealers: wave.groups.some((group) => ENEMY_TYPES[group.typeId].healRadius > 0),
    hasSplitters: wave.groups.some((group) => ENEMY_TYPES[group.typeId].splitsInto !== null),
  };
}

/** Vida total de la oleada; se usa para comprobar la progresión de dificultad. */
export function waveTotalHp(wave: Wave): number {
  return wave.groups.reduce(
    (total, group) => total + group.count * ENEMY_TYPES[group.typeId].hp * wave.hpMultiplier,
    0,
  );
}

/** Número de enemigos de la oleada. */
export function waveEnemyCount(wave: Wave): number {
  return wave.groups.reduce((total, group) => total + group.count, 0);
}

/**
 * Orden de aparición de la oleada. Los grupos se intercalan para que la
 * oleada no llegue como bloques monótonos de un solo tipo.
 */
export function buildSpawnOrder(wave: Wave): EnemyTypeId[] {
  const queues = wave.groups.map((group) => ({
    typeId: group.typeId,
    remaining: group.count,
  }));
  const total = queues.reduce((sum, queue) => sum + queue.remaining, 0);
  const order: EnemyTypeId[] = [];

  let index = 0;
  while (order.length < total) {
    const queue = queues[index % queues.length];
    if (queue && queue.remaining > 0) {
      order.push(queue.typeId);
      queue.remaining -= 1;
    }
    index += 1;
    if (index > total * queues.length + queues.length) break;
  }

  return order;
}
