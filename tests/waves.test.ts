import { describe, expect, it } from 'vitest';
import {
  BOSS_EVERY,
  FIRST_AIR_WAVE,
  buildSpawnOrder,
  getWave,
  waveEnemyCount,
  waveTotalHp,
} from '../src/game/waves';
import { ENEMY_TYPES } from '../src/game/enemies';
import { WAVE_REST, createGameState, spawnEnemy, startGame } from '../src/game/state';
import { PATH_LENGTH } from '../src/game/map';
import { damageEnemy } from '../src/game/step';
import { run, quietRun } from './helpers';

describe('wave-system: progresión de oleadas', () => {
  it('la dificultad crece de forma estrictamente monótona', () => {
    for (let n = 1; n < 40; n += 1) {
      expect(waveTotalHp(getWave(n + 1))).toBeGreaterThan(waveTotalHp(getWave(n)));
    }
  });

  it('el número de enemigos nunca disminuye', () => {
    for (let n = 1; n < 40; n += 1) {
      expect(waveEnemyCount(getWave(n + 1))).toBeGreaterThanOrEqual(
        waveEnemyCount(getWave(n)),
      );
    }
  });

  it('las criaturas aéreas aparecen a partir de su oleada', () => {
    for (let n = 1; n < FIRST_AIR_WAVE; n += 1) {
      expect(getWave(n).groups.some((group) => group.typeId === 'bat')).toBe(false);
    }
    const wave = getWave(FIRST_AIR_WAVE);
    expect(wave.groups.some((group) => group.typeId === 'bat')).toBe(true);
  });

  it('hay un jefe cada varias oleadas', () => {
    expect(getWave(BOSS_EVERY).groups.some((group) => group.typeId === 'warlord')).toBe(true);
    expect(getWave(BOSS_EVERY - 1).groups.some((group) => group.typeId === 'warlord')).toBe(
      false,
    );
  });

  it('el orden de aparición contiene exactamente los enemigos de la oleada', () => {
    for (let n = 1; n <= 12; n += 1) {
      const wave = getWave(n);
      const order = buildSpawnOrder(wave);
      expect(order).toHaveLength(waveEnemyCount(wave));
      for (const group of wave.groups) {
        expect(order.filter((id) => id === group.typeId)).toHaveLength(group.count);
      }
    }
  });

  it('los enemigos aparecen escalonados según el intervalo de la oleada', () => {
    const state = createGameState();
    startGame(state);
    const wave = getWave(1);

    // La primera oleada no arranca hasta agotarse la preparación.
    run(state, 1);
    expect(state.enemies).toHaveLength(0);
    expect(state.waveIndex).toBe(0);

    run(state, 4.2);
    expect(state.waveIndex).toBe(1);
    const afterFirst = state.enemies.length;
    expect(afterFirst).toBeGreaterThan(0);

    run(state, wave.spawnInterval * 2);
    expect(state.enemies.length).toBeGreaterThan(afterFirst);
    expect(state.enemies.length).toBeLessThanOrEqual(waveEnemyCount(wave));
  });

  it('al limpiar la oleada, la siguiente empieza tras el descanso', () => {
    const state = createGameState();
    startGame(state);
    state.waveIndex = 1;
    quietRun(state);

    run(state, 0.1);
    expect(state.wavePhase).toBe('preparing');

    run(state, WAVE_REST + 0.2);
    expect(state.waveIndex).toBe(2);
    expect(state.wavePhase).not.toBe('preparing');
  });
});

describe('wave-system: tipos de enemigo', () => {
  it('el resistente tiene más vida y menos velocidad que el rápido', () => {
    expect(ENEMY_TYPES.brute.hp).toBeGreaterThan(ENEMY_TYPES.runner.hp);
    expect(ENEMY_TYPES.brute.speed).toBeLessThan(ENEMY_TYPES.runner.speed);
  });

  it('hay al menos un tipo aéreo y varios terrestres', () => {
    const types = Object.values(ENEMY_TYPES);
    expect(types.filter((type) => type.domain === 'air').length).toBeGreaterThanOrEqual(1);
    expect(types.filter((type) => type.domain === 'ground').length).toBeGreaterThanOrEqual(3);
  });

  it('el enemigo generado recibe los atributos de su tipo y el escalado de vida', () => {
    const state = createGameState();
    startGame(state);
    const enemy = spawnEnemy(state, 'brute', 2);

    expect(enemy.speed).toBe(ENEMY_TYPES.brute.speed);
    expect(enemy.reward).toBe(ENEMY_TYPES.brute.reward);
    expect(enemy.maxHp).toBe(ENEMY_TYPES.brute.hp * 2);
  });
});

describe('wave-system: muerte y meta', () => {
  it('un enemigo eliminado otorga el oro de su tipo y no resta vidas', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 0;

    const enemy = spawnEnemy(state, 'bat', 1);
    damageEnemy(state, enemy, enemy.hp);
    run(state, 1 / 60);

    expect(state.gold).toBe(ENEMY_TYPES.bat.reward);
    expect(state.lives).toBe(20);
    expect(state.enemies).toHaveLength(0);
    expect(state.stats.kills).toBe(1);
  });

  it('cada tipo otorga su propia recompensa al morir', () => {
    for (const type of Object.values(ENEMY_TYPES)) {
      const state = createGameState();
      startGame(state);
      quietRun(state);
      state.gold = 0;

      const enemy = spawnEnemy(state, type.id, 3);
      damageEnemy(state, enemy, enemy.hp);

      // La recompensa es la del tipo, no escala con la vida de la oleada.
      expect(state.gold).toBe(type.reward);
    }
  });

  it('un enemigo dañado sin morir no otorga oro', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 0;

    const enemy = spawnEnemy(state, 'brute', 1);
    damageEnemy(state, enemy, 10);

    expect(state.gold).toBe(0);
    expect(enemy.hp).toBe(ENEMY_TYPES.brute.hp - 10);
  });

  it('un enemigo en la meta resta una vida y no da oro', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 50;

    const enemy = spawnEnemy(state, 'warlord', 1);
    enemy.distance = PATH_LENGTH - 1;
    run(state, 0.5);

    expect(state.gold).toBe(50);
    expect(state.lives).toBe(19);
    expect(state.enemies).toHaveLength(0);
  });
});
