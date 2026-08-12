/** Catálogo de criaturas. Datos puros: sin lógica ni render. */

export type Domain = 'ground' | 'air';

export type EnemyTypeId =
  | 'rat'
  | 'spider'
  | 'fox'
  | 'beetle'
  | 'dog'
  | 'boar'
  | 'slime'
  | 'slimeling'
  | 'bat'
  | 'eagle'
  | 'vulture'
  | 'goblin'
  | 'shaman'
  | 'orc'
  | 'golem'
  | 'warlord';

export interface EnemyType {
  id: EnemyTypeId;
  name: string;
  domain: Domain;
  /** Puntos de vida base, antes del escalado por oleada. */
  hp: number;
  /** Velocidad de avance en píxeles de mundo por segundo, antes del escalado por oleada. */
  speed: number;
  /** Oro que otorga al ser eliminado. No escala con la oleada. */
  reward: number;
  radius: number;
  body: string;
  accent: string;
  /** Puede detenerse junto a una torre en su alcance y dañar su estructura. */
  canDamageTowers: boolean;
  /** Puede abandonar el camino en algún punto y cruzar el prado en línea recta. */
  canSkipPath: boolean;
  /** Solo relevante si canDamageTowers. Alcance de golpe, en píxeles de mundo. */
  meleeRange: number;
  /** Solo relevante si canDamageTowers. Estructura restada por segundo mientras golpea. */
  meleeDps: number;
  /** Solo relevante si canDamageTowers. Segundos que el enemigo se detiene a golpear. */
  meleeDuration: number;
  /**
   * Daño que resta a cada impacto de torre. Resta fija, no porcentaje: así
   * distingue de verdad entre una torre de muchos golpes pequeños y otra de
   * pocos golpes grandes, que es lo que se quiere que el jugador note.
   */
  armor: number;
  /** Radio del aura de sanación. 0 significa que no cura. */
  healRadius: number;
  /** Vida que restaura por segundo a cada enemigo dentro del aura. */
  healPerSecond: number;
  /** Tipo de las crías que deja al morir, o null si no se divide. */
  splitsInto: EnemyTypeId | null;
  /** Número de crías que deja al morir. */
  splitCount: number;
}

function noMelee(): Pick<EnemyType, 'canDamageTowers' | 'meleeRange' | 'meleeDps' | 'meleeDuration'> {
  return { canDamageTowers: false, meleeRange: 0, meleeDps: 0, meleeDuration: 0 };
}

/** Rasgos del bestiario que la mayoría de criaturas no tiene. */
function plain(): Pick<EnemyType, 'armor' | 'healRadius' | 'healPerSecond' | 'splitsInto' | 'splitCount'> {
  return { armor: 0, healRadius: 0, healPerSecond: 0, splitsInto: null, splitCount: 0 };
}

export const ENEMY_TYPES: Readonly<Record<EnemyTypeId, EnemyType>> = {
  rat: {
    id: 'rat',
    name: 'Rata',
    domain: 'ground',
    hp: 22,
    speed: 62,
    reward: 5,
    radius: 9,
    body: '#8a7a68',
    accent: '#4a3f34',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  spider: {
    id: 'spider',
    name: 'Araña',
    domain: 'ground',
    hp: 34,
    // El enjambre: poca vida, mucha velocidad y muchas a la vez. Castiga a las
    // defensas de golpes lentos y espaciados.
    speed: 128,
    reward: 4,
    radius: 9,
    body: '#3f3a4a',
    accent: '#171420',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  fox: {
    id: 'fox',
    name: 'Zorro',
    domain: 'ground',
    hp: 46,
    speed: 100,
    reward: 10,
    radius: 11,
    body: '#d9702e',
    accent: '#7a3814',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  beetle: {
    id: 'beetle',
    name: 'Escarabajo',
    domain: 'ground',
    hp: 70,
    speed: 46,
    reward: 11,
    radius: 12,
    body: '#3d5a4a',
    accent: '#16241d',
    canSkipPath: false,
    ...plain(),
    // Poca vida pero 5 de armadura: una arquera de 9 de daño le hace 4 por
    // flecha, mientras que un cañón apenas lo nota.
    armor: 5,
    ...noMelee(),
  },
  dog: {
    id: 'dog',
    name: 'Perro',
    domain: 'ground',
    hp: 90,
    speed: 58,
    reward: 14,
    radius: 13,
    body: '#a68a5c',
    accent: '#5a4826',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  boar: {
    id: 'boar',
    name: 'Jabalí',
    domain: 'ground',
    hp: 190,
    speed: 50,
    reward: 24,
    radius: 16,
    body: '#4a4038',
    accent: '#241d17',
    canSkipPath: false,
    ...plain(),
    // El alcance de golpe supera el ancho de una celda de prado (64 px) para
    // que un jabalí alcance de verdad a una torre en la celda contigua al
    // camino, que es donde suele estar la mayoría.
    canDamageTowers: true,
    meleeRange: 72,
    meleeDps: 20,
    meleeDuration: 1.4,
  },
  slime: {
    id: 'slime',
    name: 'Limo',
    domain: 'ground',
    hp: 160,
    speed: 54,
    reward: 15,
    radius: 15,
    body: '#4aa88f',
    accent: '#1d4d40',
    canSkipPath: false,
    ...plain(),
    // Las crías son de otro tipo, no copias: así la división no puede
    // encadenarse y la recompensa no se multiplica.
    splitsInto: 'slimeling',
    splitCount: 2,
    ...noMelee(),
  },
  slimeling: {
    id: 'slimeling',
    name: 'Limillo',
    domain: 'ground',
    hp: 45,
    speed: 84,
    reward: 2,
    radius: 9,
    body: '#7ad0b8',
    accent: '#2d6b5a',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  bat: {
    id: 'bat',
    name: 'Murciélago',
    domain: 'air',
    hp: 55,
    speed: 95,
    reward: 12,
    radius: 11,
    body: '#7a5aa8',
    accent: '#3a2456',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  eagle: {
    id: 'eagle',
    name: 'Águila',
    domain: 'air',
    hp: 130,
    speed: 118,
    reward: 26,
    radius: 13,
    body: '#8a6a3a',
    accent: '#4a3818',
    canSkipPath: false,
    ...plain(),
    ...noMelee(),
  },
  vulture: {
    id: 'vulture',
    name: 'Buitre',
    domain: 'air',
    hp: 220,
    speed: 78,
    reward: 38,
    radius: 15,
    body: '#5a534a',
    accent: '#2a2620',
    canSkipPath: false,
    ...plain(),
    canDamageTowers: true,
    meleeRange: 68,
    meleeDps: 22,
    meleeDuration: 1.2,
  },
  goblin: {
    id: 'goblin',
    name: 'Goblin',
    domain: 'ground',
    hp: 150,
    speed: 72,
    reward: 30,
    radius: 14,
    body: '#5f8f4a',
    accent: '#2c4520',
    canSkipPath: true,
    ...plain(),
    ...noMelee(),
  },
  shaman: {
    id: 'shaman',
    name: 'Chamán',
    domain: 'ground',
    hp: 240,
    speed: 58,
    reward: 32,
    radius: 14,
    body: '#8a5ac8',
    accent: '#3d2160',
    canSkipPath: false,
    ...plain(),
    // Cura por área en vez de elegir objetivo: el jugador ve el grupo entero
    // recuperándose y entiende solo que el problema es este bicho.
    healRadius: 110,
    healPerSecond: 26,
    ...noMelee(),
  },
  orc: {
    id: 'orc',
    name: 'Orco',
    domain: 'ground',
    hp: 420,
    speed: 42,
    reward: 55,
    radius: 19,
    body: '#5a7a4a',
    accent: '#2c3f22',
    canSkipPath: false,
    ...plain(),
    canDamageTowers: true,
    meleeRange: 76,
    meleeDps: 42,
    meleeDuration: 1.6,
  },
  golem: {
    id: 'golem',
    name: 'Gólem',
    domain: 'ground',
    hp: 620,
    speed: 32,
    reward: 68,
    radius: 21,
    body: '#6b6459',
    accent: '#2f2b25',
    canSkipPath: false,
    ...plain(),
    // 14 de armadura deja a las arqueras casi sin efecto: contra un gólem hay
    // que traer ballesta, mortero o magia.
    armor: 14,
    canDamageTowers: true,
    meleeRange: 78,
    meleeDps: 38,
    meleeDuration: 1.8,
  },
  warlord: {
    id: 'warlord',
    name: 'Jefe Orco',
    domain: 'ground',
    hp: 1300,
    speed: 34,
    reward: 160,
    radius: 25,
    body: '#7a3a3a',
    accent: '#3a1414',
    canSkipPath: true,
    ...plain(),
    canDamageTowers: true,
    meleeRange: 80,
    meleeDps: 55,
    meleeDuration: 1.6,
  },
};

export function enemyType(id: EnemyTypeId): EnemyType {
  return ENEMY_TYPES[id];
}

export const ENEMY_TYPE_LIST: readonly EnemyType[] = Object.values(ENEMY_TYPES);
