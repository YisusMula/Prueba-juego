/**
 * Definición de oleadas. Se generan por fórmula en lugar de a mano para que
 * la dificultad crezca de forma estrictamente monótona y el juego no tenga
 * un final artificial.
 */

import { ENEMY_TYPES, type EnemyTypeId } from './enemies';

/** Primera oleada en la que aparecen criaturas aéreas. */
export const FIRST_AIR_WAVE = 4;
/** Primera oleada con criaturas resistentes. */
export const FIRST_BRUTE_WAVE = 6;
/** Cada cuántas oleadas aparece un jefe. */
export const BOSS_EVERY = 10;
/** Factor de crecimiento de la vida de los enemigos por oleada. */
export const HP_GROWTH = 1.13;

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
}

function positiveCount(value: number): number {
  return Math.max(0, Math.floor(value));
}

export function getWave(index: number): Wave {
  const n = Math.max(1, Math.floor(index));
  const groups: WaveGroup[] = [];

  groups.push({ typeId: 'grunt', count: 4 + positiveCount(n * 1.2) });

  if (n >= 2) {
    groups.push({ typeId: 'runner', count: 2 + positiveCount((n - 1) * 0.6) });
  }
  if (n >= FIRST_AIR_WAVE) {
    groups.push({ typeId: 'bat', count: 1 + positiveCount((n - FIRST_AIR_WAVE) * 0.7) });
  }
  if (n >= FIRST_BRUTE_WAVE) {
    groups.push({ typeId: 'brute', count: 1 + positiveCount((n - FIRST_BRUTE_WAVE) * 0.5) });
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
    spawnInterval: Math.max(0.32, 1.05 - n * 0.02),
    // Crecimiento geométrico: las torres tienen nivel máximo, así que un
    // escalado lineal acabaría siendo trivial de superar y la partida no
    // terminaría nunca.
    hpMultiplier: HP_GROWTH ** (n - 1),
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
