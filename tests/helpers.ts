import { FIXED_DT, step } from '../src/game/step';
import {
  type Cell,
  PATH_CELLS,
  distanceAtPathIndex,
  isBuildableTerrain,
} from '../src/game/map';
import type { GameState } from '../src/game/state';

/** Avanza la simulación `seconds` segundos en pasos fijos. */
export function run(state: GameState, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i += 1) step(state, FIXED_DT);
}

/** Deja la partida en curso sin oleadas automáticas, para probar en aislado. */
export function quietRun(state: GameState): void {
  state.screen = 'playing';
  state.wavePhase = 'clearing';
  state.spawnQueue = [];
  state.enemies = [];
}

/**
 * Celda de prado junto a la celda de camino indicada, con la distancia de
 * recorrido correspondiente. Sirve para montar escenarios de disparo: los
 * enemigos solo se pueden posicionar moviéndolos por el recorrido, porque la
 * simulación recalcula sus coordenadas a partir de la distancia.
 */
export function grassBesidePath(index: number): { cell: Cell; distance: number } {
  const pathCell = PATH_CELLS[index];
  if (!pathCell) throw new Error(`Índice de camino fuera de rango: ${index}`);

  const candidates: Cell[] = [
    { col: pathCell.col, row: pathCell.row - 1 },
    { col: pathCell.col, row: pathCell.row + 1 },
    { col: pathCell.col - 1, row: pathCell.row },
    { col: pathCell.col + 1, row: pathCell.row },
  ];
  const grass = candidates.find((cell) => isBuildableTerrain(cell.col, cell.row));
  if (!grass) throw new Error(`Sin prado junto a la celda de camino ${index}`);

  return { cell: grass, distance: distanceAtPathIndex(index) };
}
