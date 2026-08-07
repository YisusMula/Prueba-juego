import { describe, expect, it } from 'vitest';
import {
  COLS,
  GOAL_CELL,
  PATH_CELLS,
  PATH_LENGTH,
  ROWS,
  SPAWN_CELL,
  countPathTurns,
  isBuildableTerrain,
  positionAtDistance,
  terrainAt,
  worldToCell,
  cellCenter,
} from '../src/game/map';
import { createGameState, canPlaceTower, placeTower, startGame } from '../src/game/state';

describe('battlefield-map: prado con camino sinuoso', () => {
  it('el camino tiene al menos cuatro cambios de dirección', () => {
    expect(countPathTurns()).toBeGreaterThanOrEqual(4);
  });

  it('el camino es continuo, sin saltos ni diagonales', () => {
    for (let i = 1; i < PATH_CELLS.length; i += 1) {
      const previous = PATH_CELLS[i - 1]!;
      const current = PATH_CELLS[i]!;
      const distance =
        Math.abs(current.col - previous.col) + Math.abs(current.row - previous.row);
      expect(distance).toBe(1);
    }
  });

  it('empieza en la entrada y acaba en la meta', () => {
    expect(terrainAt(SPAWN_CELL.col, SPAWN_CELL.row)).toBe('spawn');
    expect(terrainAt(GOAL_CELL.col, GOAL_CELL.row)).toBe('goal');
    expect(PATH_CELLS[0]).toEqual(SPAWN_CELL);
    expect(PATH_CELLS[PATH_CELLS.length - 1]).toEqual(GOAL_CELL);
  });

  it('el recorrido cubre todas las celdas del camino y termina en la meta', () => {
    const goal = cellCenter(GOAL_CELL.col, GOAL_CELL.row);
    expect(positionAtDistance(PATH_LENGTH)).toEqual(goal);
    expect(positionAtDistance(PATH_LENGTH * 10)).toEqual(goal);

    // Muestreando el recorrido, todas las posiciones caen sobre camino.
    for (let d = 0; d <= PATH_LENGTH; d += 4) {
      const point = positionAtDistance(d);
      const cell = worldToCell(point.x, point.y);
      expect(['path', 'spawn', 'goal']).toContain(terrainAt(cell.col, cell.row));
    }
  });
});

describe('battlefield-map: construcción restringida al prado', () => {
  it('acepta prado libre', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    expect(canPlaceTower(state, 0, 0)).toBe(true);
    expect(placeTower(state, 0, 0)).toBe(true);
  });

  it('rechaza el camino sin cobrar oro', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    const goldBefore = state.gold;
    const pathCell = PATH_CELLS[10]!;

    expect(isBuildableTerrain(pathCell.col, pathCell.row)).toBe(false);
    expect(placeTower(state, pathCell.col, pathCell.row)).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.towers).toHaveLength(0);
  });

  it('rechaza la entrada y la meta', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    expect(placeTower(state, SPAWN_CELL.col, SPAWN_CELL.row)).toBe(false);
    expect(placeTower(state, GOAL_CELL.col, GOAL_CELL.row)).toBe(false);
    expect(state.towers).toHaveLength(0);
  });

  it('rechaza una celda ya ocupada sin cobrar oro', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    expect(placeTower(state, 0, 0)).toBe(true);

    state.shopSelection = 'archer';
    const goldBefore = state.gold;
    expect(placeTower(state, 0, 0)).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.towers).toHaveLength(1);
  });

  it('rechaza posiciones fuera del mapa', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    const goldBefore = state.gold;

    expect(placeTower(state, -1, 3)).toBe(false);
    expect(placeTower(state, COLS, 3)).toBe(false);
    expect(placeTower(state, 3, ROWS)).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.towers).toHaveLength(0);
  });
});
