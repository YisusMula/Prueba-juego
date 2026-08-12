import { describe, expect, it } from 'vitest';
import {
  BOSS_EVERY,
  FIRST_AIR_WAVE,
  FIRST_BOAR_WAVE,
  FIRST_GOBLIN_WAVE,
  MAX_SPEED_MULTIPLIER,
  buildSpawnOrder,
  getWave,
  waveEnemyCount,
  waveTotalHp,
} from '../src/game/waves';
import { ENEMY_TYPES, ENEMY_TYPE_LIST } from '../src/game/enemies';
import { WAVE_REST, createGameState, placeTower, spawnEnemy, startGame } from '../src/game/state';
import { routeOf } from '../src/game/scenarios';
import { defaultScenario } from './helpers';
import { damageEnemy, findTarget } from '../src/game/step';
import { grassBesidePath, run, quietRun } from './helpers';
import { TOWER_TYPES } from '../src/game/towers';

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

  it('hay un jefe cada varias oleadas, y es acumulativo', () => {
    expect(getWave(BOSS_EVERY).groups.some((group) => group.typeId === 'warlord')).toBe(true);
    expect(getWave(BOSS_EVERY - 1).groups.some((group) => group.typeId === 'warlord')).toBe(
      false,
    );
    expect(getWave(BOSS_EVERY + 5).groups.some((group) => group.typeId === 'warlord')).toBe(true);
  });

  it('los enemigos son cada vez más rápidos, hasta un tope', () => {
    for (let n = 1; n < 60; n += 1) {
      expect(getWave(n + 1).speedMultiplier).toBeGreaterThanOrEqual(getWave(n).speedMultiplier);
    }
    expect(getWave(1).speedMultiplier).toBe(1);
    expect(getWave(200).speedMultiplier).toBe(MAX_SPEED_MULTIPLIER);
  });

  it('el orden de aparición contiene exactamente los enemigos de la oleada', () => {
    for (let n = 1; n <= 20; n += 1) {
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
  it('progresión de resistencia terrestre: rata, perro y jabalí', () => {
    expect(ENEMY_TYPES.dog.hp).toBeGreaterThan(ENEMY_TYPES.rat.hp);
    expect(ENEMY_TYPES.dog.speed).toBeLessThanOrEqual(ENEMY_TYPES.rat.speed);
    expect(ENEMY_TYPES.boar.hp).toBeGreaterThan(ENEMY_TYPES.dog.hp);
    expect(ENEMY_TYPES.boar.speed).toBeLessThanOrEqual(ENEMY_TYPES.dog.speed);
  });

  it('progresión de resistencia aérea: murciélago, águila y buitre', () => {
    expect(ENEMY_TYPES.eagle.hp).toBeGreaterThan(ENEMY_TYPES.bat.hp);
    expect(ENEMY_TYPES.vulture.hp).toBeGreaterThan(ENEMY_TYPES.eagle.hp);
  });

  it('el jabalí (resistente) frente al zorro (rápido)', () => {
    expect(ENEMY_TYPES.boar.hp).toBeGreaterThan(ENEMY_TYPES.fox.hp);
    expect(ENEMY_TYPES.boar.speed).toBeLessThan(ENEMY_TYPES.fox.speed);
  });

  it('solo la gama alta amenaza a las torres o abandona el camino', () => {
    for (const id of ['rat', 'fox', 'dog', 'bat', 'eagle'] as const) {
      expect(ENEMY_TYPES[id].canDamageTowers).toBe(false);
      expect(ENEMY_TYPES[id].canSkipPath).toBe(false);
    }
  });

  it('hay al menos un tipo aéreo y varios terrestres', () => {
    expect(ENEMY_TYPE_LIST.filter((type) => type.domain === 'air').length).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      ENEMY_TYPE_LIST.filter((type) => type.domain === 'ground').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('el enemigo generado recibe los atributos de su tipo, el escalado de vida y de velocidad', () => {
    const state = createGameState();
    startGame(state);
    const enemy = spawnEnemy(state, 'boar', 2, 1.2);

    expect(enemy.speed).toBeCloseTo(ENEMY_TYPES.boar.speed * 1.2, 6);
    expect(enemy.reward).toBe(ENEMY_TYPES.boar.reward);
    expect(enemy.maxHp).toBe(ENEMY_TYPES.boar.hp * 2);
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
    for (const type of ENEMY_TYPE_LIST) {
      const state = createGameState();
      startGame(state);
      quietRun(state);
      state.gold = 0;

      const enemy = spawnEnemy(state, type.id, 3);
      // Con margen para la armadura: un acorazado no muere con un golpe
      // exactamente igual a su vida, porque parte se queda en la coraza.
      damageEnemy(state, enemy, enemy.hp + enemy.armor);

      // La recompensa es la del tipo, no escala con la vida de la oleada.
      expect(state.gold).toBe(type.reward);
    }
  });

  it('un enemigo dañado sin morir no otorga oro', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 0;

    const enemy = spawnEnemy(state, 'dog', 1);
    damageEnemy(state, enemy, 10);

    expect(state.gold).toBe(0);
    expect(enemy.hp).toBe(ENEMY_TYPES.dog.hp - 10);
  });

  it('un enemigo en la meta resta una vida y no da oro', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 50;

    const enemy = spawnEnemy(state, 'dog', 1);
    enemy.distance = routeOf(defaultScenario(), 0).length - 1;
    run(state, 0.5);

    expect(state.gold).toBe(50);
    expect(state.lives).toBe(19);
    expect(state.enemies).toHaveLength(0);
  });
});

describe('wave-system: enemigos que abandonan el camino', () => {
  it('un enemigo capaz abandona el trazado en su oleada', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const enemy = spawnEnemy(state, 'goblin', 1);
    enemy.distance = enemy.breakawayDistance + 1;
    run(state, 1 / 60);

    expect(enemy.offPath).toBe(true);
  });

  it('nadie abandona el camino antes de su oleada de introducción', () => {
    for (let n = 1; n < FIRST_GOBLIN_WAVE; n += 1) {
      expect(getWave(n).groups.some((group) => group.typeId === 'goblin')).toBe(false);
    }
  });

  it('un enemigo fuera de camino sigue siendo objetivo válido para las torres', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const spot = grassBesidePath(20);
    state.gold = 10_000;
    state.shopSelection = 'archer';
    if (!placeTower(state, spot.cell.col, spot.cell.row)) {
      throw new Error('No se pudo colocar la torre de prueba');
    }
    const tower = state.towers[0]!;

    const enemy = spawnEnemy(state, 'goblin', 1);
    enemy.offPath = true;
    enemy.x = tower.x + 15;
    enemy.y = tower.y;

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(enemy.id);
  });

  it('un enemigo fuera de camino sigue siendo objetivo válido y puede llegar a la meta', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 0;

    const enemy = spawnEnemy(state, 'goblin', 1);
    // Fuerza el punto de fuga justo delante y una velocidad alta para llegar rápido.
    enemy.breakawayDistance = 10;
    enemy.speed = 4000;
    run(state, 2);

    expect(state.lives).toBe(19);
    expect(state.enemies).toHaveLength(0);
  });
});

describe('wave-system: enemigos que dañan torres', () => {
  it('nadie daña torres antes de su oleada de introducción', () => {
    for (let n = 1; n < FIRST_BOAR_WAVE; n += 1) {
      expect(getWave(n).groups.some((group) => group.typeId === 'boar')).toBe(false);
    }
  });
});
