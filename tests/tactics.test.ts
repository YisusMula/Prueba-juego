import { describe, expect, it } from 'vitest';
import {
  callNextWave,
  callWaveBonus,
  createGameState,
  placeTower,
  sellSelectedTower,
  selectedTowerSellValue,
  setSelectedTowerPriority,
  spawnEnemy,
  startGame,
  upgradeSelectedTower,
  type GameState,
  type Tower,
} from '../src/game/state';
import { SELL_REFUND_FACTOR, TOWER_TYPES, sellRefund } from '../src/game/towers';
import { findTarget } from '../src/game/step';
import { describeWave } from '../src/game/waves';
import { FIRST_AIR_WAVE, FIRST_BOAR_WAVE } from '../src/game/waves';
import { grassBesidePath, quietRun, run } from './helpers';

function placeAt(state: GameState, typeId: Tower['typeId'], col: number, row: number): Tower {
  state.gold = 10_000;
  state.shopSelection = typeId;
  if (!placeTower(state, col, row)) throw new Error('No se pudo colocar la torre');
  return state.towers[state.towers.length - 1] as Tower;
}

/** Partida en curso, sin oleadas, con una torre junto al camino. */
function ambush(typeId: Tower['typeId'], pathIndex = 20) {
  const state = createGameState();
  startGame(state);
  quietRun(state);
  const spot = grassBesidePath(pathIndex);
  const tower = placeAt(state, typeId, spot.cell.col, spot.cell.row);
  return { state, tower, distance: spot.distance };
}

describe('economy: llamar a la siguiente oleada', () => {
  it('llamar antes da más oro que llamar tarde', () => {
    const early = createGameState();
    startGame(early);
    const late = createGameState();
    startGame(late);
    run(late, 3);

    const earlyBefore = early.gold;
    const lateBefore = late.gold;
    expect(callNextWave(early)).toBe(true);
    expect(callNextWave(late)).toBe(true);

    expect(early.gold - earlyBefore).toBeGreaterThan(late.gold - lateBefore);
  });

  it('llamar arranca la oleada de inmediato', () => {
    const state = createGameState();
    startGame(state);
    expect(state.wavePhase).toBe('preparing');

    callNextWave(state);
    expect(state.waveIndex).toBe(1);
    expect(state.wavePhase).not.toBe('preparing');
  });

  it('no se puede llamar a una oleada ya en marcha', () => {
    const state = createGameState();
    startGame(state);
    callNextWave(state);

    const goldBefore = state.gold;
    expect(callNextWave(state)).toBe(false);
    expect(state.gold).toBe(goldBefore);
  });

  it('el bonus anunciado es el que se cobra', () => {
    const state = createGameState();
    startGame(state);
    run(state, 1.5);

    const announced = callWaveBonus(state);
    const goldBefore = state.gold;
    callNextWave(state);

    expect(state.gold - goldBefore).toBe(announced);
  });

  it('con la oleada en marcha el bonus anunciado es cero', () => {
    const state = createGameState();
    startGame(state);
    callNextWave(state);
    expect(callWaveBonus(state)).toBe(0);
  });
});

describe('economy: vender torres', () => {
  it('vender devuelve parte de lo invertido, nunca todo', () => {
    const invested = 100;
    const refund = sellRefund(invested);
    expect(refund).toBeGreaterThan(0);
    expect(refund).toBeLessThan(invested);
    expect(SELL_REFUND_FACTOR).toBeLessThan(1);
  });

  it('vender retira la torre y libera la celda', () => {
    const state = createGameState();
    startGame(state);
    placeAt(state, 'archer', 0, 0);
    expect(state.towers).toHaveLength(1);

    expect(sellSelectedTower(state)).toBe(true);
    expect(state.towers).toHaveLength(0);
    expect(state.selectedTowerId).toBeNull();

    // La celda vuelve a admitir una torre nueva.
    state.shopSelection = 'archer';
    expect(placeTower(state, 0, 0)).toBe(true);
  });

  it('vender ingresa el reembolso anunciado', () => {
    const state = createGameState();
    startGame(state);
    placeAt(state, 'cannon', 0, 0);

    const announced = selectedTowerSellValue(state) as number;
    const goldBefore = state.gold;
    sellSelectedTower(state);

    expect(state.gold - goldBefore).toBe(announced);
  });

  it('la inversión crece con cada mejora y el reembolso también', () => {
    const plain = createGameState();
    startGame(plain);
    const plainTower = placeAt(plain, 'archer', 0, 0);
    const plainRefund = selectedTowerSellValue(plain) as number;
    expect(plainTower.invested).toBe(TOWER_TYPES.archer.cost);

    const upgraded = createGameState();
    startGame(upgraded);
    const upgradedTower = placeAt(upgraded, 'archer', 0, 0);
    upgraded.gold = 10_000;
    upgradeSelectedTower(upgraded);
    upgradeSelectedTower(upgraded);

    expect(upgradedTower.invested).toBeGreaterThan(plainTower.invested);
    expect(selectedTowerSellValue(upgraded) as number).toBeGreaterThan(plainRefund);
  });

  it('no se puede vender con la partida terminada', () => {
    const state = createGameState();
    startGame(state);
    placeAt(state, 'archer', 0, 0);
    state.screen = 'defeat';

    const goldBefore = state.gold;
    expect(sellSelectedTower(state)).toBe(false);
    expect(state.towers).toHaveLength(1);
    expect(state.gold).toBe(goldBefore);
  });
});

describe('tower-system: prioridad de objetivo', () => {
  it('una torre nueva empieza en "primero"', () => {
    const state = createGameState();
    startGame(state);
    const tower = placeAt(state, 'archer', 0, 0);
    expect(tower.priority).toBe('first');
  });

  it('"último" elige al menos avanzado', () => {
    const { state, tower, distance } = ambush('archer');
    setSelectedTowerPriority(state, 'last');

    const behind = spawnEnemy(state, 'rat', 1);
    behind.distance = distance - 25;
    behind.speed = 0;
    const ahead = spawnEnemy(state, 'rat', 1);
    ahead.distance = distance + 25;
    ahead.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(behind.id);
  });

  it('"primero" elige al más avanzado', () => {
    const { state, tower, distance } = ambush('archer');

    const behind = spawnEnemy(state, 'rat', 1);
    behind.distance = distance - 25;
    behind.speed = 0;
    const ahead = spawnEnemy(state, 'rat', 1);
    ahead.distance = distance + 25;
    ahead.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(ahead.id);
  });

  it('"más fuerte" elige al de más vida actual', () => {
    const { state, tower, distance } = ambush('archer');
    setSelectedTowerPriority(state, 'strongest');

    const weak = spawnEnemy(state, 'rat', 1);
    weak.distance = distance + 25;
    weak.speed = 0;
    const strong = spawnEnemy(state, 'orc', 1);
    strong.distance = distance - 25;
    strong.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(strong.id);
  });

  it('"más cercano" elige por distancia a la torre', () => {
    const { state, tower } = ambush('archer');
    setSelectedTowerPriority(state, 'closest');

    const near = spawnEnemy(state, 'rat', 1);
    near.speed = 0;
    near.x = tower.x + 10;
    near.y = tower.y;
    const far = spawnEnemy(state, 'rat', 1);
    far.speed = 0;
    far.x = tower.x + 100;
    far.y = tower.y;
    far.distance = 9999;

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(near.id);
  });

  it('la prioridad no salta las reglas de dominio', () => {
    const { state, tower, distance } = ambush('cannon');
    setSelectedTowerPriority(state, 'strongest');

    const bat = spawnEnemy(state, 'bat', 1);
    bat.distance = distance;
    bat.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.cannon.range)).toBeNull();
  });
});

describe('wave-system: consultar una oleada', () => {
  it('consultar no genera enemigos', () => {
    const state = createGameState();
    startGame(state);
    const before = state.enemies.length;

    describeWave(10);
    expect(state.enemies).toHaveLength(before);
  });

  it('la descripción enumera tipos y cantidades', () => {
    const description = describeWave(1);
    expect(description.groups.length).toBeGreaterThan(0);
    expect(description.total).toBeGreaterThan(0);
    for (const group of description.groups) {
      expect(group.count).toBeGreaterThan(0);
      expect(group.name.length).toBeGreaterThan(0);
    }
  });

  it('detecta las amenazas aéreas', () => {
    expect(describeWave(1).hasAir).toBe(false);
    expect(describeWave(FIRST_AIR_WAVE).hasAir).toBe(true);
  });

  it('detecta a los que dañan torres', () => {
    expect(describeWave(1).hasTowerAttackers).toBe(false);
    expect(describeWave(FIRST_BOAR_WAVE).hasTowerAttackers).toBe(true);
  });
});
