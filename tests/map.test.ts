import { describe, expect, it } from 'vitest';
import { COLS, ROWS, cellCenter, countTurns, worldToCell } from '../src/game/map';
import {
  SCENARIO_LIST,
  isBuildableTerrain,
  positionAtDistance,
  routeOf,
  scenario,
  terrainAt,
} from '../src/game/scenarios';
import { createGameState, canPlaceTower, placeTower, startGame } from '../src/game/state';
import { defaultScenario } from './helpers';

describe('battlefield-map: prado con camino sinuoso', () => {
  const meadow = defaultScenario();
  const route = routeOf(meadow, 0);

  it('el camino tiene al menos cuatro cambios de dirección', () => {
    expect(countTurns(route.cells)).toBeGreaterThanOrEqual(4);
  });

  it('el camino es continuo, sin saltos ni diagonales', () => {
    for (let i = 1; i < route.cells.length; i += 1) {
      const previous = route.cells[i - 1]!;
      const current = route.cells[i]!;
      const distance =
        Math.abs(current.col - previous.col) + Math.abs(current.row - previous.row);
      expect(distance).toBe(1);
    }
  });

  it('empieza en la entrada y acaba en la meta', () => {
    expect(terrainAt(meadow, route.spawn.col, route.spawn.row)).toBe('spawn');
    expect(terrainAt(meadow, route.goal.col, route.goal.row)).toBe('goal');
  });

  it('el recorrido cubre todas las celdas del camino y termina en la meta', () => {
    const goal = cellCenter(route.goal.col, route.goal.row);
    expect(positionAtDistance(route, route.length)).toEqual(goal);
    expect(positionAtDistance(route, route.length * 10)).toEqual(goal);

    // Muestreando el recorrido, todas las posiciones caen sobre camino.
    for (let d = 0; d <= route.length; d += 4) {
      const point = positionAtDistance(route, d);
      const cell = worldToCell(point.x, point.y);
      expect(['path', 'spawn', 'goal']).toContain(terrainAt(meadow, cell.col, cell.row));
    }
  });
});

describe('battlefield-map: catálogo de escenarios', () => {
  it('todo escenario tiene rutas continuas de entrada a meta', () => {
    expect(SCENARIO_LIST.length).toBeGreaterThanOrEqual(3);

    for (const scene of SCENARIO_LIST) {
      expect(scene.routes.length).toBeGreaterThanOrEqual(1);
      for (const route of scene.routes) {
        expect(terrainAt(scene, route.spawn.col, route.spawn.row)).toBe('spawn');
        expect(terrainAt(scene, route.goal.col, route.goal.row)).toBe('goal');

        for (let i = 1; i < route.cells.length; i += 1) {
          const previous = route.cells[i - 1]!;
          const current = route.cells[i]!;
          expect(
            Math.abs(current.col - previous.col) + Math.abs(current.row - previous.row),
          ).toBe(1);
        }
      }
    }
  });

  it('el catálogo cubre las tres formas de mapa', () => {
    const single = SCENARIO_LIST.filter((scene) => scene.routes.length === 1);
    expect(single.length).toBeGreaterThanOrEqual(1);

    // Bifurcación: misma entrada y misma meta, tramo intermedio distinto.
    const fork = SCENARIO_LIST.find(
      (scene) =>
        scene.routes.length > 1 && scene.spawnCells.length === 1 && scene.goalCells.length === 1,
    );
    expect(fork).toBeDefined();
    const keys = (cells: readonly { col: number; row: number }[]): string =>
      cells.map((cell) => `${cell.col},${cell.row}`).join('|');
    expect(keys(fork!.routes[0]!.cells)).not.toBe(keys(fork!.routes[1]!.cells));

    // Dos entradas: rutas con origen distinto.
    const twoGates = SCENARIO_LIST.find((scene) => scene.spawnCells.length > 1);
    expect(twoGates).toBeDefined();
  });

  it('las ramas de la bifurcación miden lo mismo', () => {
    const fork = scenario('crossroads');
    const lengths = fork.routes.map((route) => route.length);
    // Una rama más corta sería siempre la mejor y la bifurcación dejaría de
    // ser una decisión.
    expect(Math.abs((lengths[0] as number) - (lengths[1] as number))).toBeLessThan(1);
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
    const pathCell = defaultScenario().pathCells[10]!;

    expect(isBuildableTerrain(defaultScenario(), pathCell.col, pathCell.row)).toBe(false);
    expect(placeTower(state, pathCell.col, pathCell.row)).toBe(false);
    expect(state.gold).toBe(goldBefore);
    expect(state.towers).toHaveLength(0);
  });

  it('rechaza la entrada y la meta', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'archer';
    const route = routeOf(defaultScenario(), 0);
    expect(placeTower(state, route.spawn.col, route.spawn.row)).toBe(false);
    expect(placeTower(state, route.goal.col, route.goal.row)).toBe(false);
    expect(state.towers).toHaveLength(0);
  });

  it('rechaza tanto el tramo compartido como cada rama de una bifurcación', () => {
    const state = createGameState('normal', 'crossroads');
    startGame(state);

    const fork = scenario('crossroads');
    const [north, south] = fork.routes;
    const key = (cell: { col: number; row: number }): string => `${cell.col},${cell.row}`;
    const southKeys = new Set(south!.cells.map(key));

    const shared = north!.cells.find((cell) => southKeys.has(key(cell)));
    const onlyNorth = north!.cells.find((cell) => !southKeys.has(key(cell)));
    expect(shared).toBeDefined();
    expect(onlyNorth).toBeDefined();

    for (const cell of [shared!, onlyNorth!]) {
      state.shopSelection = 'archer';
      const goldBefore = state.gold;
      expect(placeTower(state, cell.col, cell.row)).toBe(false);
      expect(state.gold).toBe(goldBefore);
    }
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
