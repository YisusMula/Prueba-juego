/**
 * Guía de primeros pasos.
 *
 * Cada paso es un **predicado puro sobre el estado**. La guía no llama a
 * ninguna acción, no pausa nada y no deshabilita nada: solo mira la partida y
 * decide qué pista enseñar. La simulación no se entera de que existe.
 *
 * De ahí salen tres cosas que valen mucho:
 *
 * - el jugador puede ignorarla por completo y seguir jugando;
 * - un paso que ya está cumplido al llegarle el turno se salta solo, así que
 *   quien construye antes de leer no ve luego "coloca una torre";
 * - se prueba en Node sobre un `GameState` montado a mano.
 */

import { SPECIALISATION_LEVEL } from './specialisations';
import type { GameState } from './state';

export interface TutorialStep {
  id: string;
  /** Qué hacer, en una frase. */
  text: string;
  /** Cierto cuando el jugador ya ha hecho lo que pide el paso. */
  done: (state: GameState) => boolean;
}

/**
 * La cadena mínima que lleva de "no sé qué hacer" a "sé cómo crece un puesto",
 * y que termina en la decisión más interesante del juego.
 *
 * Quedan fuera a propósito las habilidades, las prioridades, la reparación, la
 * venta y la llamada anticipada: todas son respuestas a una situación que el
 * jugador todavía no ha vivido en la oleada 1, y explicarlas antes es ruido.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'pick',
    text: 'Toca una torre en la barra de abajo para elegirla.',
    done: (state) => state.shopSelection !== null || state.towers.length > 0,
  },
  {
    id: 'place',
    text: 'Ahora toca el prado, junto al camino, para colocarla. Sobre el camino no se puede.',
    done: (state) => state.towers.length > 0,
  },
  {
    id: 'upgrade',
    // No hay un paso aparte para seleccionarla: colocar una torre ya abre su
    // panel. Pedir algo que el juego acaba de hacer solo sería un paso vacío,
    // así que la forma de reabrirlo se cuenta aquí.
    text: 'Su panel ya está abierto —y se reabre tocando la torre—. Súbela de nivel con Mejorar.',
    done: (state) => state.towers.some((tower) => tower.level > 1),
  },
  {
    id: 'specialise',
    text: `En el nivel ${SPECIALISATION_LEVEL} podrás especializarla en una de dos ramas. Es para siempre: elige con cabeza.`,
    done: (state) => state.towers.some((tower) => tower.specialisation !== null),
  },
];

/**
 * Paso que toca enseñar: el primero cuya condición aún no se cumple, o null si
 * están todos.
 *
 * No hay índice guardado. Además de no tener nada que sincronizar, esto hace la
 * guía robusta ante lo inesperado: si el jugador vende la torre que acababa de
 * poner, la guía vuelve sola a pedirle que coloque una en vez de quedarse
 * pidiendo que mejore algo que ya no existe.
 */
export function currentTutorialStep(state: GameState): TutorialStep | null {
  return TUTORIAL_STEPS.find((step) => !step.done(state)) ?? null;
}

/** Posición del paso en la secuencia, empezando en 1. 0 si ya no hay ninguno. */
export function tutorialStepNumber(state: GameState): number {
  const step = currentTutorialStep(state);
  if (!step) return 0;
  return TUTORIAL_STEPS.findIndex((other) => other.id === step.id) + 1;
}

export function tutorialStepCount(): number {
  return TUTORIAL_STEPS.length;
}
