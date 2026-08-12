/**
 * Niveles de dificultad. Datos puros.
 *
 * La dificultad solo cambia la dureza, nunca el guion: la composición de
 * cada oleada (tipos y cantidades) es idéntica en las tres. Lo que varía son
 * los recursos con los que arranca el jugador y la vida de los enemigos.
 */

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** Texto corto para el selector del menú. */
  blurb: string;
  startingLives: number;
  startingGold: number;
  /** Multiplicador aplicado a la vida de los enemigos, sobre el de la oleada. */
  hpMultiplier: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = {
  easy: {
    id: 'easy',
    name: 'Fácil',
    blurb: 'Para aprender el terreno',
    startingLives: 30,
    startingGold: 220,
    hpMultiplier: 0.65,
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    blurb: 'La defensa como debe ser',
    startingLives: 20,
    startingGold: 150,
    hpMultiplier: 1,
  },
  hard: {
    id: 'hard',
    name: 'Difícil',
    blurb: 'Sin margen de error',
    startingLives: 12,
    startingGold: 120,
    hpMultiplier: 1.2,
  },
};

/** De más fácil a más difícil. El orden importa en el selector y en los tests. */
export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['easy', 'normal', 'hard'];

export const DIFFICULTY_LIST: readonly Difficulty[] = DIFFICULTY_ORDER.map(
  (id) => DIFFICULTIES[id],
);

export function difficulty(id: DifficultyId): Difficulty {
  return DIFFICULTIES[id];
}

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

/** Oleada que hay que superar para ganar la partida. */
export const FINAL_WAVE = 30;
