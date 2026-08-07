/**
 * Reglas para distinguir una pulsación de un arrastre. En móvil es imposible
 * tocar sin mover algo el dedo, así que hace falta un umbral: sin él, el
 * jugador colocaría torres al intentar desplazar la vista.
 */

/** Desplazamiento máximo, en píxeles de pantalla, que sigue siendo pulsación. */
export const TAP_MOVE_THRESHOLD = 10;
/** Duración máxima, en milisegundos, de una pulsación. */
export const TAP_TIME_THRESHOLD = 400;

export interface GestureSample {
  /** Desplazamiento total acumulado desde que se apoyó el puntero. */
  movedX: number;
  movedY: number;
  /** Milisegundos transcurridos desde que se apoyó el puntero. */
  elapsedMs: number;
}

export function isTap(sample: GestureSample): boolean {
  const distance = Math.hypot(sample.movedX, sample.movedY);
  return distance <= TAP_MOVE_THRESHOLD && sample.elapsedMs <= TAP_TIME_THRESHOLD;
}
