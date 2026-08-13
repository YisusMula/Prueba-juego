/**
 * Ramas de mejora de las torres.
 *
 * Una especialización es un puñado de modificadores que se aplican **sobre** el
 * tipo base, no un tipo de torre nuevo. Así el catálogo sigue teniendo seis
 * entradas, el balance por nivel se toca en un solo sitio, y una torre sin
 * especializar es literalmente el caso del modificador identidad.
 *
 * Cada par de ramas tiene que llevar la torre en direcciones distintas: si las
 * dos fueran "más daño" con distinto número, elegir no sería una decisión.
 */

import type { TowerTypeId } from './towers';

export type SpecialisationId =
  | 'archer-volley'
  | 'archer-needle'
  | 'cannon-grapeshot'
  | 'cannon-piercer'
  | 'mortar-siege'
  | 'mortar-breaker'
  | 'frost-blizzard'
  | 'frost-brittle'
  | 'ballista-watchtower'
  | 'ballista-steelbolt'
  | 'magic-chain'
  | 'magic-overload';

export interface Specialisation {
  id: SpecialisationId;
  towerId: TowerTypeId;
  name: string;
  /** Qué cambia, en una frase que sirva para decidir sin probar. */
  blurb: string;
  /** Multiplicadores sobre las estadísticas del nivel actual. */
  damageFactor: number;
  rangeFactor: number;
  fireRateFactor: number;
  splashFactor: number;
  /** Radio de área fijo para las ramas que lo estrenan (el tipo base no lo tiene). */
  splashBonus: number;
  /** Los disparos ignoran por completo la armadura del enemigo. */
  piercing: boolean;
  /** Saltos adicionales del disparo. 0 = sin cadena. */
  chainTargets: number;
  /** Fracción del daño que conserva cada salto respecto al anterior. */
  chainFalloff: number;
  /** Enemigos congelados por esta torre reciben este multiplicador de daño. */
  vulnerability: number;
  /** Enemigos adicionales que puede mantener congelados a la vez. */
  freezeBonus: number;
}

/** Nivel a partir del cual una torre puede especializarse. */
export const SPECIALISATION_LEVEL = 4;

/** Modificador identidad: lo que aplica una torre sin especializar. */
const NEUTRAL = {
  damageFactor: 1,
  rangeFactor: 1,
  fireRateFactor: 1,
  splashFactor: 1,
  splashBonus: 0,
  piercing: false,
  chainTargets: 0,
  chainFalloff: 1,
  vulnerability: 1,
  freezeBonus: 0,
} as const;

function branch(
  id: SpecialisationId,
  towerId: TowerTypeId,
  name: string,
  blurb: string,
  overrides: Partial<Omit<Specialisation, 'id' | 'towerId' | 'name' | 'blurb'>>,
): Specialisation {
  return { id, towerId, name, blurb, ...NEUTRAL, ...overrides };
}

export const SPECIALISATIONS: readonly Specialisation[] = [
  branch('archer-volley', 'archer', 'Ráfaga', 'Dispara mucho más rápido, aunque cada flecha pega menos.', {
    fireRateFactor: 1.9,
    damageFactor: 0.72,
  }),
  branch('archer-needle', 'archer', 'Aguja', 'Sus flechas atraviesan la armadura por completo.', {
    piercing: true,
    damageFactor: 1.05,
  }),

  branch('cannon-grapeshot', 'cannon', 'Metralla', 'La bola estalla y alcanza a los enemigos de alrededor.', {
    splashBonus: 52,
    damageFactor: 0.85,
  }),
  branch('cannon-piercer', 'cannon', 'Perforante', 'Atraviesa la armadura y pega bastante más fuerte.', {
    piercing: true,
    damageFactor: 1.3,
    fireRateFactor: 0.9,
  }),

  branch('mortar-siege', 'mortar', 'Asedio', 'Más radio de explosión y más alcance.', {
    splashFactor: 1.6,
    rangeFactor: 1.25,
    damageFactor: 0.9,
  }),
  branch('mortar-breaker', 'mortar', 'Demoledora', 'Atraviesa la armadura y pega mucho más, con menos radio.', {
    piercing: true,
    damageFactor: 1.55,
    splashFactor: 0.55,
  }),

  branch('frost-blizzard', 'frost', 'Ventisca', 'Mantiene congelados a muchos más enemigos a la vez.', {
    freezeBonus: 4,
    rangeFactor: 1.15,
  }),
  branch('frost-brittle', 'frost', 'Fragilidad', 'Lo que congela recibe más daño de todas tus torres.', {
    vulnerability: 1.45,
  }),

  branch('ballista-watchtower', 'ballista', 'Vigía', 'Alcance enorme: cubre medio escenario.', {
    rangeFactor: 1.5,
    damageFactor: 0.9,
  }),
  branch('ballista-steelbolt', 'ballista', 'Virote de acero', 'El virote atraviesa cualquier armadura.', {
    piercing: true,
    damageFactor: 1.1,
  }),

  branch('magic-chain', 'magic', 'Cadena', 'El rayo salta a dos enemigos más, con menos daño en cada salto.', {
    chainTargets: 2,
    chainFalloff: 0.6,
    damageFactor: 0.9,
  }),
  branch('magic-overload', 'magic', 'Sobrecarga', 'Un golpe demoledor, pero tarda más entre disparos.', {
    damageFactor: 1.75,
    fireRateFactor: 0.65,
  }),
];

const BY_ID = new Map<SpecialisationId, Specialisation>(
  SPECIALISATIONS.map((spec) => [spec.id, spec] as const),
);

export function specialisation(id: SpecialisationId): Specialisation | null {
  return BY_ID.get(id) ?? null;
}

/** Las dos ramas de un tipo de torre, en el orden en que se ofrecen. */
export function specialisationsFor(towerId: TowerTypeId): readonly Specialisation[] {
  return SPECIALISATIONS.filter((spec) => spec.towerId === towerId);
}

/** Modificadores efectivos: los de la rama, o los neutros si no hay ninguna. */
export function modifiersOf(id: SpecialisationId | null): Omit<
  Specialisation,
  'id' | 'towerId' | 'name' | 'blurb'
> {
  return (id && BY_ID.get(id)) || { ...NEUTRAL };
}
