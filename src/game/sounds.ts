/**
 * Eventos de sonido que emite la simulación.
 *
 * La simulación no reproduce nada: solo encola qué ha pasado. La capa de
 * presentación vacía la cola en cada frame y la traduce a sonido. Así
 * `src/game/` sigue siendo puro y ejecutable en Node, donde no hay
 * `AudioContext`, y los eventos se pueden comprobar en los tests.
 */

export type SoundId =
  | 'shoot-arrow'
  | 'shoot-cannon'
  | 'shoot-mortar'
  | 'shoot-bolt'
  | 'shoot-magic'
  | 'shoot-frost'
  | 'hit'
  | 'kill'
  | 'leak'
  | 'build'
  | 'upgrade'
  | 'sell'
  | 'repair'
  | 'ability-meteor'
  | 'ability-blizzard'
  | 'wave-start'
  | 'victory'
  | 'defeat';

/** Cuántos eventos se guardan como mucho antes de descartar los más antiguos. */
export const MAX_QUEUED_SOUNDS = 32;
