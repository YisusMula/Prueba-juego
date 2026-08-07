/** Catálogo de criaturas. Datos puros: sin lógica ni render. */

export type Domain = 'ground' | 'air';

export type EnemyTypeId = 'grunt' | 'runner' | 'brute' | 'bat' | 'warlord';

export interface EnemyType {
  id: EnemyTypeId;
  name: string;
  domain: Domain;
  /** Puntos de vida base, antes del escalado por oleada. */
  hp: number;
  /** Velocidad de avance en píxeles de mundo por segundo. */
  speed: number;
  /** Oro que otorga al ser eliminado. No escala con la oleada. */
  reward: number;
  radius: number;
  body: string;
  accent: string;
}

export const ENEMY_TYPES: Readonly<Record<EnemyTypeId, EnemyType>> = {
  grunt: {
    id: 'grunt',
    name: 'Duende',
    domain: 'ground',
    hp: 60,
    speed: 52,
    reward: 10,
    radius: 13,
    body: '#6aa84f',
    accent: '#31501f',
  },
  runner: {
    id: 'runner',
    name: 'Corredor',
    domain: 'ground',
    hp: 42,
    speed: 108,
    reward: 12,
    radius: 11,
    body: '#e0a33a',
    accent: '#6b4a10',
  },
  brute: {
    id: 'brute',
    name: 'Ogro',
    domain: 'ground',
    hp: 280,
    speed: 32,
    reward: 30,
    radius: 18,
    body: '#8f5b3c',
    accent: '#4a2b18',
  },
  bat: {
    id: 'bat',
    name: 'Murciélago',
    domain: 'air',
    hp: 85,
    speed: 92,
    reward: 20,
    radius: 12,
    body: '#7a5aa8',
    accent: '#3a2456',
  },
  warlord: {
    id: 'warlord',
    name: 'Señor de la Guerra',
    domain: 'ground',
    hp: 700,
    speed: 28,
    reward: 140,
    radius: 24,
    body: '#b03a3a',
    accent: '#5a1717',
  },
};

export function enemyType(id: EnemyTypeId): EnemyType {
  return ENEMY_TYPES[id];
}

export const ENEMY_TYPE_LIST: readonly EnemyType[] = Object.values(ENEMY_TYPES);
