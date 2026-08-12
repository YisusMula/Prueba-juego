/** Habilidades activas del comandante. Datos puros: sin lógica ni render. */

export type AbilityId = 'meteor' | 'blizzard';

export interface Ability {
  id: AbilityId;
  name: string;
  icon: string;
  blurb: string;
  /** Segundos de recarga tras usarla. */
  cooldown: number;
  /** Si necesita que el jugador señale un punto del escenario. */
  targeted: boolean;
  /** Solo si es dirigida: radio del efecto en píxeles de mundo. */
  radius: number;
  /** Daño aplicado a cada enemigo alcanzado. */
  damage: number;
  /** Segundos de congelación aplicados a los enemigos alcanzados. */
  freezeDuration: number;
}

export const ABILITIES: Readonly<Record<AbilityId, Ability>> = {
  meteor: {
    id: 'meteor',
    name: 'Meteoro',
    icon: '☄️',
    blurb: 'Daño en área donde pulses',
    cooldown: 25,
    targeted: true,
    radius: 110,
    damage: 320,
    freezeDuration: 0,
  },
  blizzard: {
    id: 'blizzard',
    name: 'Ventisca',
    icon: '❄️',
    blurb: 'Congela a todo el escenario',
    cooldown: 40,
    targeted: false,
    radius: 0,
    damage: 20,
    freezeDuration: 4,
  },
};

export const ABILITY_ORDER: readonly AbilityId[] = ['meteor', 'blizzard'];

export const ABILITY_LIST: readonly Ability[] = ABILITY_ORDER.map((id) => ABILITIES[id]);

export function ability(id: AbilityId): Ability {
  return ABILITIES[id];
}
