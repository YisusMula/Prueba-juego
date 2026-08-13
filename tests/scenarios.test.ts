/**
 * Selección de escenario y reparto de enemigos entre rutas.
 */

import { describe, expect, it } from 'vitest';
import {
  SCENARIO_LIST,
  routeIndexFor,
  routeOf,
  scenario,
} from '../src/game/scenarios';
import {
  createGameState,
  currentScenario,
  exitToMenu,
  openScenarioPicker,
  spawnEnemy,
  startGame,
} from '../src/game/state';
import { run } from './helpers';

describe('game-shell: pantalla de selección de escenario', () => {
  it('comenzar desde el menú abre la selección y no la partida', () => {
    const state = createGameState();
    expect(state.screen).toBe('menu');

    openScenarioPicker(state, 'hard');

    expect(state.screen).toBe('scenarios');
    expect(state.difficultyId).toBe('hard');
    expect(state.enemies).toHaveLength(0);
  });

  it('en la selección no avanza la simulación', () => {
    const state = createGameState();
    openScenarioPicker(state);
    const timeBefore = state.time;

    run(state, 5);

    expect(state.time).toBe(timeBefore);
    expect(state.enemies).toHaveLength(0);
    expect(state.screen).toBe('scenarios');
  });

  it('elegir un escenario empieza la partida en ese escenario', () => {
    const state = createGameState();
    openScenarioPicker(state, 'normal');

    startGame(state, undefined, 'gates');

    expect(state.screen).toBe('playing');
    expect(state.scenarioId).toBe('gates');
    expect(currentScenario(state).id).toBe('gates');
    expect(state.lives).toBe(20);
  });

  it('volver desde la selección regresa al menú sin partida', () => {
    const state = createGameState();
    openScenarioPicker(state);

    exitToMenu(state);

    expect(state.screen).toBe('menu');
    expect(state.towers).toHaveLength(0);
    expect(state.enemies).toHaveLength(0);
  });

  it('el escenario no cambia a mitad de partida', () => {
    const state = createGameState('normal', 'crossroads');
    startGame(state);

    run(state, 30);

    expect(state.scenarioId).toBe('crossroads');
  });
});

describe('battlefield-map: reparto de enemigos entre rutas', () => {
  it('el reparto es determinista', () => {
    const first = createGameState('normal', 'crossroads');
    startGame(first);
    const second = createGameState('normal', 'crossroads');
    startGame(second);

    for (const state of [first, second]) {
      for (let i = 0; i < 6; i += 1) spawnEnemy(state, 'rat', 1);
    }

    expect(first.enemies.map((enemy) => enemy.routeIndex)).toEqual(
      second.enemies.map((enemy) => enemy.routeIndex),
    );
  });

  it('todas las rutas reciben enemigos', () => {
    for (const scene of SCENARIO_LIST) {
      const state = createGameState('normal', scene.id);
      startGame(state);
      for (let i = 0; i < scene.routes.length * 3; i += 1) spawnEnemy(state, 'rat', 1);

      const used = new Set(state.enemies.map((enemy) => enemy.routeIndex));
      expect(used.size, `${scene.name} no usa todas sus rutas`).toBe(scene.routes.length);
    }
  });

  it('cada enemigo aparece en la entrada de su ruta', () => {
    const state = createGameState('normal', 'gates');
    startGame(state);
    const gates = scenario('gates');

    for (let i = 0; i < 4; i += 1) {
      const enemy = spawnEnemy(state, 'rat', 1);
      const route = routeOf(gates, enemy.routeIndex);
      const spawn = route.waypoints[0]!;
      expect(enemy.x).toBe(spawn.x);
      expect(enemy.y).toBe(spawn.y);
    }
  });

  it('un enemigo no cambia de ruta mientras avanza', () => {
    const state = createGameState('normal', 'crossroads');
    startGame(state);
    const enemy = spawnEnemy(state, 'rat', 40);
    const route = enemy.routeIndex;

    run(state, 10);

    expect(enemy.routeIndex).toBe(route);
  });

  it('el reparto funciona con más de dos rutas', () => {
    const wide = SCENARIO_LIST.find((scene) => scene.routes.length >= 3);
    expect(wide).toBeDefined();

    const state = createGameState('normal', wide!.id);
    startGame(state);
    for (let i = 0; i < wide!.routes.length * 4; i += 1) spawnEnemy(state, 'rat', 1);

    const used = new Set(state.enemies.map((enemy) => enemy.routeIndex));
    expect(used.size).toBe(wide!.routes.length);
  });

  it('un escenario de una sola ruta manda a todos por ella', () => {
    const meadow = scenario('meadow');
    for (let id = 0; id < 10; id += 1) {
      expect(routeIndexFor(meadow, id)).toBe(0);
    }
  });
});
