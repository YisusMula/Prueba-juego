import { describe, expect, it } from 'vitest';
import {
  STARTING_GOLD,
  STARTING_LIVES,
  addGold,
  canAfford,
  createGameState,
  loseLife,
  placeTower,
  selectShopTower,
  spendGold,
  startGame,
  syncShopAffordability,
  upgradeSelectedTower,
} from '../src/game/state';
import { PATH_LENGTH } from '../src/game/map';
import { spawnEnemy } from '../src/game/state';
import { TOWER_TYPES } from '../src/game/towers';
import { run, quietRun } from './helpers';

describe('economy: vidas', () => {
  it('la partida empieza con 20 vidas', () => {
    const state = createGameState();
    startGame(state);
    expect(state.lives).toBe(20);
    expect(STARTING_LIVES).toBe(20);
  });

  it('cada enemigo que llega a la meta resta exactamente una vida', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    for (let i = 0; i < 3; i += 1) {
      const enemy = spawnEnemy(state, 'grunt', 1);
      enemy.distance = PATH_LENGTH - 1;
    }
    run(state, 0.5);

    expect(state.lives).toBe(17);
    expect(state.stats.leaked).toBe(3);
  });

  it('las vidas no bajan de cero', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.lives = 1;

    for (let i = 0; i < 2; i += 1) {
      const enemy = spawnEnemy(state, 'grunt', 1);
      enemy.distance = PATH_LENGTH - 1;
    }
    run(state, 0.5);

    expect(state.lives).toBe(0);
    expect(state.screen).toBe('defeat');
  });

  it('loseLife nunca deja las vidas en negativo', () => {
    const state = createGameState();
    loseLife(state, 999);
    expect(state.lives).toBe(0);
  });
});

describe('economy: oro', () => {
  it('la partida empieza con el oro inicial', () => {
    const state = createGameState();
    startGame(state);
    expect(state.gold).toBe(STARTING_GOLD);
  });

  it('el oro nunca queda en negativo', () => {
    const state = createGameState();
    state.gold = 10;
    expect(spendGold(state, 50)).toBe(false);
    expect(state.gold).toBe(10);
  });

  it('los enemigos que se escapan no dan oro', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 100;

    const enemy = spawnEnemy(state, 'brute', 1);
    enemy.distance = PATH_LENGTH - 1;
    run(state, 0.5);

    expect(state.gold).toBe(100);
    expect(state.lives).toBe(19);
  });

  it('gastar y ganar oro actualiza las estadísticas', () => {
    const state = createGameState();
    state.gold = 100;
    expect(spendGold(state, 40)).toBe(true);
    addGold(state, 25);
    expect(state.gold).toBe(85);
    expect(state.stats.goldSpent).toBe(40);
    expect(state.stats.goldEarned).toBe(25);
  });
});

describe('economy: asequibilidad en la barra de compra', () => {
  it('una torre inasequible no se puede seleccionar', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 40;

    expect(canAfford(state, TOWER_TYPES.ballista.cost)).toBe(false);
    expect(selectShopTower(state, 'ballista')).toBe(false);
    expect(state.shopSelection).toBeNull();
  });

  it('la torre pasa a ser seleccionable al reunir el oro', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 40;
    expect(selectShopTower(state, 'cannon')).toBe(false);

    addGold(state, 40);
    expect(selectShopTower(state, 'cannon')).toBe(true);
    expect(state.shopSelection).toBe('cannon');
  });

  it('la selección se cancela si el oro baja por debajo del coste', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 200;
    expect(selectShopTower(state, 'mortar')).toBe(true);

    state.gold = 30;
    syncShopAffordability(state);
    expect(state.shopSelection).toBeNull();
  });

  it('colocar una torre cara cancela la selección si ya no se puede repetir', () => {
    const state = createGameState();
    startGame(state);
    state.gold = TOWER_TYPES.mortar.cost;
    expect(selectShopTower(state, 'mortar')).toBe(true);
    expect(placeTower(state, 0, 0)).toBe(true);

    expect(state.gold).toBe(0);
    expect(state.shopSelection).toBeNull();
  });

  it('una mejora sin oro suficiente no cambia nada', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 100;
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);

    state.gold = 5;
    const tower = state.towers[0]!;
    expect(upgradeSelectedTower(state)).toBe(false);
    expect(tower.level).toBe(1);
    expect(state.gold).toBe(5);
  });
});
