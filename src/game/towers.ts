/**
 * Catálogo de torres y fórmulas de nivel.
 *
 * Las estadísticas de cada nivel y el coste de mejora salen de una fórmula
 * sobre las estadísticas base, de modo que "cada nivel cuesta más que el
 * anterior" se cumple por construcción y se puede verificar con un test
 * sobre todo el catálogo.
 */

import { type SpecialisationId, modifiersOf } from './specialisations';

export type TowerTypeId = 'archer' | 'cannon' | 'mortar' | 'ballista' | 'magic' | 'frost';

/** A cuál de los enemigos válidos dispara una torre. */
export type TargetPriority = 'first' | 'last' | 'strongest' | 'closest';

export const TARGET_PRIORITIES: readonly { id: TargetPriority; name: string }[] = [
  { id: 'first', name: 'Primero' },
  { id: 'last', name: 'Último' },
  { id: 'strongest', name: 'Más fuerte' },
  { id: 'closest', name: 'Más cercano' },
];

export type ProjectileKind = 'arrow' | 'cannonball' | 'shell' | 'bolt' | 'lightning' | 'frostbolt';

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
  /** Puntos de estructura base, antes del escalado por nivel. */
  baseHp: number;
  maxLevel: number;
  base: string;
  accent: string;
}

export const TOWER_MAX_LEVEL = 8;

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
    baseHp: 230,
    maxLevel: TOWER_MAX_LEVEL,
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
    baseHp: 280,
    maxLevel: TOWER_MAX_LEVEL,
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
    baseHp: 320,
    maxLevel: TOWER_MAX_LEVEL,
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
    baseHp: 280,
    maxLevel: TOWER_MAX_LEVEL,
    base: '#b98b5e',
    accent: '#5d3c22',
  },
  magic: {
    id: 'magic',
    name: 'Torre Mágica',
    blurb: 'Tierra y aire · rayos',
    cost: 260,
    damage: 70,
    range: 190,
    fireRate: 0.9,
    projectileSpeed: 900,
    projectile: 'lightning',
    canTargetGround: true,
    canTargetAir: true,
    splashRadius: 0,
    baseHp: 230,
    maxLevel: TOWER_MAX_LEVEL,
    base: '#6a4a9a',
    accent: '#2e1a52',
  },
  frost: {
    id: 'frost',
    name: 'Torre de Hielo',
    blurb: 'Tierra y aire · congela',
    cost: 150,
    damage: 4,
    range: 140,
    fireRate: 1.2,
    projectileSpeed: 380,
    projectile: 'frostbolt',
    canTargetGround: true,
    canTargetAir: true,
    splashRadius: 0,
    baseHp: 210,
    maxLevel: TOWER_MAX_LEVEL,
    base: '#a8d8e8',
    accent: '#3a6a8a',
  },
};

/** Orden de aparición en la barra de compra: de más barata a más cara. */
export const TOWER_TYPE_LIST: readonly TowerType[] = [
  TOWER_TYPES.archer,
  TOWER_TYPES.cannon,
  TOWER_TYPES.mortar,
  TOWER_TYPES.frost,
  TOWER_TYPES.ballista,
  TOWER_TYPES.magic,
];

export function towerType(id: TowerTypeId): TowerType {
  return TOWER_TYPES[id];
}

export interface TowerStats {
  damage: number;
  range: number;
  fireRate: number;
  splashRadius: number;
  maxHp: number;
  /** Los disparos ignoran la armadura del enemigo. */
  piercing: boolean;
  /** Saltos adicionales del disparo; 0 = sin cadena. */
  chainTargets: number;
  /** Daño que conserva cada salto respecto al anterior. */
  chainFalloff: number;
  /** Multiplicador de daño que reciben los enemigos que esta torre congela. */
  vulnerability: number;
}

const DAMAGE_PER_LEVEL = 1.32;
const RANGE_PER_LEVEL = 0.1;
const FIRE_RATE_PER_LEVEL = 0.06;
const SPLASH_PER_LEVEL = 0.08;
const HP_PER_LEVEL = 0.18;
const UPGRADE_COST_BASE = 0.75;
const UPGRADE_COST_GROWTH = 1.5;

/**
 * Estadísticas de una torre en un nivel dado (nivel 1 = las base).
 *
 * Los modificadores de la especialización se aplican **después** de la escalada
 * por nivel, de modo que subir de nivel siga mejorando lo mismo en una torre
 * especializada que en una que no lo está. Sin especialización, los
 * modificadores son la identidad y el resultado es idéntico al de antes de que
 * existieran las ramas.
 */
export function statsAtLevel(
  type: TowerType,
  level: number,
  specialisationId: SpecialisationId | null = null,
): TowerStats {
  const steps = Math.max(0, level - 1);
  const mod = modifiersOf(specialisationId);
  const splashByLevel = Math.round(type.splashRadius * (1 + SPLASH_PER_LEVEL * steps));
  // El bono fijo estrena el área en ramas cuyo tipo base no la tiene, así que
  // se suma antes de escalar por la rama y no se pierde con un factor sobre 0.
  const splashRadius = Math.round((splashByLevel + mod.splashBonus) * mod.splashFactor);

  return {
    damage: Math.max(1, Math.round(type.damage * DAMAGE_PER_LEVEL ** steps * mod.damageFactor)),
    range: Math.round(type.range * (1 + RANGE_PER_LEVEL * steps) * mod.rangeFactor),
    fireRate: type.fireRate * (1 + FIRE_RATE_PER_LEVEL * steps) * mod.fireRateFactor,
    splashRadius,
    // La estructura no la toca ninguna rama: repararla debe costar lo mismo
    // sea cual sea la especialización.
    maxHp: Math.round(type.baseHp * (1 + HP_PER_LEVEL * steps)),
    piercing: mod.piercing,
    chainTargets: mod.chainTargets,
    chainFalloff: mod.chainFalloff,
    vulnerability: mod.vulnerability,
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
 * La torre de hielo se excluye de esta comparación de potencia pura: su
 * papel es el control (congelar), no el daño.
 */
export function effectiveDps(type: TowerType, level = 1): number {
  const stats = statsAtLevel(type, level);
  const splashFactor = 1 + stats.splashRadius / 60;
  return stats.damage * stats.fireRate * splashFactor;
}

/**
 * Fracción de lo invertido que devuelve vender una torre. Menor que 1 para
 * que vender nunca sea una forma de ganar oro.
 */
export const SELL_REFUND_FACTOR = 0.6;

/** Reembolso por vender una torre con esa inversión acumulada. */
export function sellRefund(invested: number): number {
  if (invested <= 0) return 0;
  return Math.max(1, Math.floor(invested * SELL_REFUND_FACTOR));
}

/** Fracción del coste base de la torre que cuesta repararla desde 0 hasta el máximo. */
const REPAIR_COST_FACTOR = 0.45;

/** Coste de reparar una torre según cuánta estructura le falta. Sin daño, 0. */
export function repairCost(type: TowerType, hp: number, maxHp: number): number {
  if (maxHp <= 0 || hp >= maxHp) return 0;
  const missingRatio = (maxHp - hp) / maxHp;
  return Math.max(1, Math.ceil(missingRatio * type.cost * REPAIR_COST_FACTOR));
}

/** Oleadas de nivel en las que la torre de hielo amplía cuántos enemigos puede congelar a la vez. */
const FROST_CAPACITY_LEVEL_2 = 5;
const FROST_CAPACITY_LEVEL_3 = 8;

/**
 * Cuántos enemigos puede mantener congelados a la vez la torre de hielo en
 * un nivel dado. En sus primeros niveles solo uno; a partir de niveles altos,
 * más de uno.
 */
export function frostFreezeCapacity(
  level: number,
  specialisationId: SpecialisationId | null = null,
): number {
  const base = level >= FROST_CAPACITY_LEVEL_3 ? 3 : level >= FROST_CAPACITY_LEVEL_2 ? 2 : 1;
  return base + modifiersOf(specialisationId).freezeBonus;
}
