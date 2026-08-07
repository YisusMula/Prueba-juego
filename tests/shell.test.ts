import { describe, expect, it } from 'vitest';
import {
  STARTING_GOLD,
  createGameState,
  displayedWave,
  exitToMenu,
  handleWorldTap,
  pauseGame,
  placeTower,
  resumeGame,
  selectShopTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { PATH_LENGTH, cellCenter } from '../src/game/map';
import { spawnEnemy } from '../src/game/state';
import { quietRun, run } from './helpers';

describe('game-shell: menú principal', () => {
  it('arranca en el menú, sin simular nada', () => {
    const state = createGameState();
    expect(state.screen).toBe('menu');

    run(state, 10);
    expect(state.enemies).toHaveLength(0);
    expect(state.waveIndex).toBe(0);
    expect(state.time).toBe(0);
  });

  it('comenzar deja la partida lista con 20 vidas y la oleada 1', () => {
    const state = createGameState();
    startGame(state);

    expect(state.screen).toBe('playing');
    expect(state.lives).toBe(20);
    expect(state.gold).toBe(STARTING_GOLD);
    expect(displayedWave(state)).toBe(1);
  });
});

describe('game-shell: pausa', () => {
  it('pausar congela la simulación', () => {
    const state = createGameState();
    startGame(state);
    run(state, 6);

    const enemiesBefore = state.enemies.length;
    const timeBefore = state.time;
    pauseGame(state);
    expect(state.screen).toBe('paused');

    run(state, 5);
    expect(state.time).toBe(timeBefore);
    expect(state.enemies).toHaveLength(enemiesBefore);
  });

  it('reanudar continúa desde el mismo estado', () => {
    const state = createGameState();
    startGame(state);
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    run(state, 6);

    const snapshot = {
      lives: state.lives,
      gold: state.gold,
      towers: state.towers.length,
      wave: state.waveIndex,
    };

    pauseGame(state);
    run(state, 3);
    resumeGame(state);

    expect(state.screen).toBe('playing');
    expect(state.lives).toBe(snapshot.lives);
    expect(state.gold).toBe(snapshot.gold);
    expect(state.towers).toHaveLength(snapshot.towers);
    expect(state.waveIndex).toBe(snapshot.wave);

    run(state, 1);
    expect(state.time).toBeGreaterThan(0);
  });

  it('salir al menú descarta la partida', () => {
    const state = createGameState();
    startGame(state);
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    run(state, 8);

    pauseGame(state);
    exitToMenu(state);

    expect(state.screen).toBe('menu');
    expect(state.towers).toHaveLength(0);
    expect(state.enemies).toHaveLength(0);
    expect(state.gold).toBe(STARTING_GOLD);
    expect(state.waveIndex).toBe(0);
  });
});

describe('game-shell: derrota', () => {
  function loseAll(state: ReturnType<typeof createGameState>): void {
    quietRun(state);
    state.lives = 1;
    const enemy = spawnEnemy(state, 'grunt', 1);
    enemy.distance = PATH_LENGTH - 1;
    run(state, 0.5);
  }

  it('llegar a 0 vidas muestra la derrota y detiene la simulación', () => {
    const state = createGameState();
    startGame(state);
    loseAll(state);

    expect(state.screen).toBe('defeat');
    expect(state.lives).toBe(0);

    const timeBefore = state.time;
    run(state, 5);
    expect(state.time).toBe(timeBefore);
  });

  it('tras perder no se pueden comprar ni colocar torres', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 500;
    loseAll(state);

    const goldBefore = state.gold;
    expect(selectShopTower(state, 'archer')).toBe(false);
    expect(placeTower(state, 0, 0)).toBe(false);

    const center = cellCenter(0, 0);
    handleWorldTap(state, center.x, center.y);

    expect(state.towers).toHaveLength(0);
    expect(state.gold).toBe(goldBefore);
  });

  it('tras perder no se pueden mejorar torres', () => {
    const state = createGameState();
    startGame(state);
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    state.gold = 500;
    loseAll(state);

    const goldBefore = state.gold;
    expect(upgradeSelectedTower(state)).toBe(false);
    expect(state.towers[0]?.level).toBe(1);
    expect(state.gold).toBe(goldBefore);
  });

  it('reintentar arranca una partida limpia', () => {
    const state = createGameState();
    startGame(state);
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    loseAll(state);

    startGame(state);

    expect(state.screen).toBe('playing');
    expect(state.lives).toBe(20);
    expect(state.gold).toBe(STARTING_GOLD);
    expect(state.towers).toHaveLength(0);
    expect(state.enemies).toHaveLength(0);
    expect(displayedWave(state)).toBe(1);
    expect(state.stats.leaked).toBe(0);
  });
});
