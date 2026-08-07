/**
 * Catálogo de torres y fórmulas de nivel.
 *
 * Las estadísticas de cada nivel y el coste de mejora salen de una fórmula
 * sobre las estadísticas base, de modo que "cada nivel cuesta más que el
 * anterior" se cumple por construcción y se puede verificar con un test
 * sobre todo el catálogo.
 */

export type TowerTypeId = 'archer' | 'cannon' | 'mortar' | 'ballista';

export type ProjectileKind = 'arrow' | 'cannonball' | 'shell' | 'bolt';

export interface TowerType {
  id: TowerTypeId;
  name: string;
  /** Texto corto para la barra de compra. */
  blurb: string;
  cost: number;
  damage: number;
  /** Alcance en píxeles de mundo. */
  range: number;
  /** Disparos por segundo. */
  fireRate: number;
  projectileSpeed: number;
  projectile: ProjectileKind;
  canTargetGround: boolean;
  canTargetAir: boolean;
  /** Radio de daño en área; 0 = impacto simple. */
  splashRadius: number;
  maxLevel: number;
  base: string;
  accent: string;
}

export const TOWER_TYPES: Readonly<Record<TowerTypeId, TowerType>> = {
  archer: {
    id: 'archer',
    name: 'Arqueras',
    blurb: 'Tierra y aire',
    cost: 45,
    damage: 9,
    range: 150,
    fireRate: 1.8,
    projectileSpeed: 460,
    projectile: 'arrow',
    canTargetGround: true,
    canTargetAir: true,
    splashRadius: 0,
    maxLevel: 5,
    base: '#c8b18a',
    accent: '#3f7d4a',
  },
  cannon: {
    id: 'cannon',
    name: 'Cañón',
    blurb: 'Solo tierra',
    cost: 60,
    damage: 22,
    range: 130,
    fireRate: 0.8,
    projectileSpeed: 320,
    projectile: 'cannonball',
    canTargetGround: true,
    canTargetAir: false,
    splashRadius: 0,
    maxLevel: 5,
    base: '#9aa1a8',
    accent: '#40474d',
  },
  mortar: {
    id: 'mortar',
    name: 'Mortero',
    blurb: 'Tierra · área',
    cost: 140,
    damage: 40,
    range: 200,
    fireRate: 0.45,
    projectileSpeed: 220,
    projectile: 'shell',
    canTargetGround: true,
    canTargetAir: false,
    splashRadius: 60,
    maxLevel: 5,
    base: '#8a7d6b',
    accent: '#4a3f31',
  },
  ballista: {
    id: 'ballista',
    name: 'Ballesta',
    blurb: 'Tierra y aire · largo alcance',
    cost: 190,
    damage: 55,
    range: 260,
    fireRate: 0.75,
    projectileSpeed: 620,
    projectile: 'bolt',
    canTargetGround: true,
    canTargetAir: true,
    splashRadius: 0,
    maxLevel: 5,
    base: '#b98b5e',
    accent: '#5d3c22',
  },
};

/** Orden de aparición en la barra de compra: de más barata a más cara. */
export const TOWER_TYPE_LIST: readonly TowerType[] = [
  TOWER_TYPES.archer,
  TOWER_TYPES.cannon,
  TOWER_TYPES.mortar,
  TOWER_TYPES.ballista,
];

export function towerType(id: TowerTypeId): TowerType {
  return TOWER_TYPES[id];
}

export interface TowerStats {
  damage: number;
  range: number;
  fireRate: number;
  splashRadius: number;
}

const DAMAGE_PER_LEVEL = 1.6;
const RANGE_PER_LEVEL = 0.1;
const FIRE_RATE_PER_LEVEL = 0.06;
const SPLASH_PER_LEVEL = 0.08;
const UPGRADE_COST_BASE = 0.75;
const UPGRADE_COST_GROWTH = 1.85;

/** Estadísticas de una torre en un nivel dado (nivel 1 = las base). */
export function statsAtLevel(type: TowerType, level: number): TowerStats {
  const steps = Math.max(0, level - 1);
  return {
    damage: Math.round(type.damage * DAMAGE_PER_LEVEL ** steps),
    range: Math.round(type.range * (1 + RANGE_PER_LEVEL * steps)),
    fireRate: type.fireRate * (1 + FIRE_RATE_PER_LEVEL * steps),
    splashRadius: Math.round(type.splashRadius * (1 + SPLASH_PER_LEVEL * steps)),
  };
}

/**
 * Coste de pasar del nivel indicado al siguiente. Devuelve null cuando la
 * torre ya está en su nivel máximo.
 */
export function upgradeCost(type: TowerType, currentLevel: number): number | null {
  if (currentLevel >= type.maxLevel) return null;
  const steps = Math.max(0, currentLevel - 1);
  return Math.round(type.cost * UPGRADE_COST_BASE * UPGRADE_COST_GROWTH ** steps);
}

/**
 * Daño por segundo efectivo, teniendo en cuenta que el daño en área alcanza
 * a varios enemigos a la vez. Sirve para comparar torres del catálogo.
 */
export function effectiveDps(type: TowerType, level = 1): number {
  const stats = statsAtLevel(type, level);
  const splashFactor = 1 + stats.splashRadius / 60;
  return stats.damage * stats.fireRate * splashFactor;
}
