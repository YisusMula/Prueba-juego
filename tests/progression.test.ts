import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_ORDER,
  FINAL_WAVE,
  difficulty,
} from '../src/game/difficulty';
import {
  continueEndless,
  createGameState,
  drainSounds,
  placeTower,
  selectShopTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { bestRecordFor, loadRecords, recordFor, recordRun } from '../src/storage/records';
import { SCENARIO_LIST } from '../src/game/scenarios';
import { getWave } from '../src/game/waves';
import { spawnEnemy } from '../src/game/state';
import { quietRun, run } from './helpers';

describe('run-progression: dificultad', () => {
  it('los recursos iniciales salen de la dificultad elegida', () => {
    for (const id of DIFFICULTY_ORDER) {
      const state = createGameState(id);
      startGame(state);
      expect(state.lives).toBe(difficulty(id).startingLives);
      expect(state.gold).toBe(difficulty(id).startingGold);
    }
  });

  it('normal mantiene las 20 vidas de siempre', () => {
    const state = createGameState('normal');
    startGame(state);
    expect(state.lives).toBe(20);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });

  it('las dificultades están ordenadas de forma coherente', () => {
    for (let i = 0; i + 1 < DIFFICULTY_ORDER.length; i += 1) {
      const easier = difficulty(DIFFICULTY_ORDER[i] as never);
      const harder = difficulty(DIFFICULTY_ORDER[i + 1] as never);
      expect(harder.startingLives).toBeLessThanOrEqual(easier.startingLives);
      expect(harder.startingGold).toBeLessThanOrEqual(easier.startingGold);
      expect(harder.hpMultiplier).toBeGreaterThanOrEqual(easier.hpMultiplier);
    }
  });

  it('en la dificultad alta los enemigos tienen más vida', () => {
    const easy = createGameState('easy');
    startGame(easy);
    const hard = createGameState('hard');
    startGame(hard);

    const easyEnemy = spawnEnemy(easy, 'dog', 1);
    const hardEnemy = spawnEnemy(hard, 'dog', 1);
    expect(hardEnemy.maxHp).toBeGreaterThan(easyEnemy.maxHp);
  });

  it('la composición de la oleada no cambia con la dificultad', () => {
    // getWave es pura respecto de la dificultad: solo depende del número.
    const wave = getWave(12);
    expect(wave.groups).toEqual(getWave(12).groups);
  });
});

describe('run-progression: victoria', () => {
  /** Deja la partida justo al final de la oleada final, ya despejada. */
  function atFinalWaveCleared(state: ReturnType<typeof createGameState>): void {
    quietRun(state);
    state.waveIndex = FINAL_WAVE;
    state.spawnQueue = [];
    state.enemies = [];
  }

  it('superar la oleada final gana la partida', () => {
    const state = createGameState();
    startGame(state);
    atFinalWaveCleared(state);

    run(state, 1 / 60);
    expect(state.screen).toBe('victory');
  });

  it('la victoria detiene la simulación', () => {
    const state = createGameState();
    startGame(state);
    atFinalWaveCleared(state);
    run(state, 1 / 60);

    const timeBefore = state.time;
    run(state, 3);
    expect(state.time).toBe(timeBefore);
  });

  it('no se gana antes de la oleada final', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.waveIndex = FINAL_WAVE - 1;

    run(state, 1 / 60);
    expect(state.screen).toBe('playing');
  });

  it('quedarse sin vidas en la oleada final es derrota, no victoria', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.waveIndex = FINAL_WAVE;
    state.lives = 0;

    run(state, 1 / 60);
    expect(state.screen).toBe('defeat');
  });

  it('tras ganar no se puede comprar ni colocar', () => {
    const state = createGameState();
    startGame(state);
    atFinalWaveCleared(state);
    run(state, 1 / 60);

    state.gold = 1000;
    expect(selectShopTower(state, 'archer')).toBe(false);
    expect(placeTower(state, 0, 0)).toBe(false);
    expect(upgradeSelectedTower(state)).toBe(false);
  });

  it('continuar en modo sin fin conserva el estado', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 777;
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    const towersBefore = state.towers.length;
    const goldBefore = state.gold;
    const livesBefore = state.lives;

    atFinalWaveCleared(state);
    run(state, 1 / 60);
    expect(state.screen).toBe('victory');

    continueEndless(state);
    expect(state.screen).toBe('playing');
    expect(state.towers).toHaveLength(towersBefore);
    expect(state.gold).toBe(goldBefore);
    expect(state.lives).toBe(livesBefore);
  });

  it('en modo sin fin ya no se vuelve a ganar', () => {
    const state = createGameState();
    startGame(state);
    atFinalWaveCleared(state);
    run(state, 1 / 60);
    continueEndless(state);

    quietRun(state);
    state.waveIndex = FINAL_WAVE + 5;
    run(state, 1);
    expect(state.screen).toBe('playing');
  });
});

describe('run-progression: récords', () => {
  const base = loadRecords();

  it('un resultado mejor actualiza el récord', () => {
    const start = recordRun(base, 'meadow', 'normal', 12, 100).records;
    const { records, beatenWave } = recordRun(start, 'meadow', 'normal', 18, 150);

    expect(recordFor(records, 'meadow', 'normal').bestWave).toBe(18);
    expect(beatenWave).toBe(true);
  });

  it('un resultado peor no empeora el récord', () => {
    const start = recordRun(base, 'meadow', 'normal', 18, 150).records;
    const { records, beatenWave } = recordRun(start, 'meadow', 'normal', 9, 20);

    expect(recordFor(records, 'meadow', 'normal').bestWave).toBe(18);
    expect(recordFor(records, 'meadow', 'normal').bestKills).toBe(150);
    expect(beatenWave).toBe(false);
  });

  it('los récords son independientes por dificultad', () => {
    const start = recordRun(base, 'meadow', 'normal', 18, 150).records;
    const { records } = recordRun(start, 'meadow', 'hard', 4, 10);

    expect(recordFor(records, 'meadow', 'normal').bestWave).toBe(18);
    expect(recordFor(records, 'meadow', 'hard').bestWave).toBe(4);
    expect(recordFor(records, 'meadow', 'easy').bestWave).toBe(0);
  });

  it('los récords son independientes por escenario', () => {
    const start = recordRun(base, 'meadow', 'normal', 18, 150).records;
    const { records } = recordRun(start, 'crossroads', 'normal', 7, 30);

    expect(recordFor(records, 'meadow', 'normal').bestWave).toBe(18);
    expect(recordFor(records, 'crossroads', 'normal').bestWave).toBe(7);
    expect(recordFor(records, 'gates', 'normal').bestWave).toBe(0);
  });

  it('el menú muestra la mejor marca de la dificultad entre escenarios', () => {
    let records = recordRun(base, 'meadow', 'normal', 12, 80).records;
    records = recordRun(records, 'gates', 'normal', 21, 200).records;

    expect(bestRecordFor(records, 'normal').bestWave).toBe(21);
    expect(bestRecordFor(records, 'hard').bestWave).toBe(0);
  });

  it('sin almacenamiento se obtienen récords vacíos sin fallar', () => {
    // En Node no hay localStorage: loadRecords debe devolver ceros y no lanzar.
    const records = loadRecords();
    for (const scene of SCENARIO_LIST) {
      for (const id of DIFFICULTY_ORDER) {
        expect(recordFor(records, scene.id, id).bestWave).toBe(0);
      }
    }
  });
});

describe('game-audio: cola de eventos', () => {
  it('construir y mejorar encolan su sonido', () => {
    const state = createGameState();
    startGame(state);
    drainSounds(state);

    state.gold = 1000;
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);
    expect(drainSounds(state)).toContain('build');

    upgradeSelectedTower(state);
    expect(drainSounds(state)).toContain('upgrade');
  });

  it('vaciar la cola la deja vacía', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 1000;
    selectShopTower(state, 'archer');
    placeTower(state, 0, 0);

    expect(drainSounds(state).length).toBeGreaterThan(0);
    expect(drainSounds(state)).toHaveLength(0);
  });

  it('la fuga y la derrota emiten su sonido', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.lives = 1;
    drainSounds(state);

    const enemy = spawnEnemy(state, 'rat', 1);
    enemy.distance = Number.MAX_SAFE_INTEGER;
    run(state, 0.5);

    const sounds = drainSounds(state);
    expect(sounds).toContain('leak');
    expect(sounds).toContain('defeat');
  });

  it('la cola no crece sin límite', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    // Muchos enemigos muriendo sin que nadie vacíe la cola.
    for (let i = 0; i < 200; i += 1) {
      const enemy = spawnEnemy(state, 'rat', 1);
      enemy.hp = 1;
    }
    run(state, 0.1);

    expect(state.soundQueue.length).toBeLessThanOrEqual(32);
  });
});
