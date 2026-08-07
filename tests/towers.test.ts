import { describe, expect, it } from 'vitest';
import {
  TOWER_TYPES,
  TOWER_TYPE_LIST,
  type TowerTypeId,
  effectiveDps,
  statsAtLevel,
  upgradeCost,
} from '../src/game/towers';
import {
  type GameState,
  type Tower,
  createGameState,
  getSelectedTower,
  handleWorldTap,
  placeTower,
  selectShopTower,
  selectedTowerUpgradeCost,
  spawnEnemy,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { cellCenter } from '../src/game/map';
import { findTarget } from '../src/game/step';
import { grassBesidePath, quietRun, run } from './helpers';

function placeAt(state: GameState, typeId: TowerTypeId, col: number, row: number): Tower {
  state.gold = 10_000;
  state.shopSelection = typeId;
  if (!placeTower(state, col, row)) {
    throw new Error(`No se pudo colocar ${typeId} en ${col},${row}`);
  }
  return state.towers[state.towers.length - 1] as Tower;
}

/** Partida en curso, sin oleadas, con una torre junto al camino. */
function ambush(typeId: TowerTypeId, pathIndex = 20) {
  const state = createGameState();
  startGame(state);
  quietRun(state);
  const spot = grassBesidePath(pathIndex);
  const tower = placeAt(state, typeId, spot.cell.col, spot.cell.row);
  return { state, tower, distance: spot.distance };
}

describe('tower-system: catálogo', () => {
  it('el cañón solo ataca a tierra y las arqueras a tierra y aire', () => {
    expect(TOWER_TYPES.cannon.canTargetGround).toBe(true);
    expect(TOWER_TYPES.cannon.canTargetAir).toBe(false);
    expect(TOWER_TYPES.archer.canTargetGround).toBe(true);
    expect(TOWER_TYPES.archer.canTargetAir).toBe(true);
  });

  it('el cañón dispara bolas y las arqueras flechas', () => {
    expect(TOWER_TYPES.cannon.projectile).toBe('cannonball');
    expect(TOWER_TYPES.archer.projectile).toBe('arrow');
  });

  it('a mayor coste base, mayor daño por segundo efectivo', () => {
    for (const a of TOWER_TYPE_LIST) {
      for (const b of TOWER_TYPE_LIST) {
        if (a.cost < b.cost) expect(effectiveDps(a)).toBeLessThan(effectiveDps(b));
      }
    }
  });

  it('hay al menos una torre antiaérea y una de área', () => {
    expect(TOWER_TYPE_LIST.some((type) => type.canTargetAir)).toBe(true);
    expect(TOWER_TYPE_LIST.some((type) => type.splashRadius > 0)).toBe(true);
  });
});

describe('tower-system: niveles', () => {
  it('cada nivel cuesta estrictamente más que el anterior', () => {
    for (const type of TOWER_TYPE_LIST) {
      for (let level = 1; level < type.maxLevel - 1; level += 1) {
        const current = upgradeCost(type, level);
        const next = upgradeCost(type, level + 1);
        expect(current).not.toBeNull();
        expect(next).not.toBeNull();
        expect(next as number).toBeGreaterThan(current as number);
      }
    }
  });

  it('subir de nivel mejora daño y alcance', () => {
    for (const type of TOWER_TYPE_LIST) {
      for (let level = 1; level < type.maxLevel; level += 1) {
        const current = statsAtLevel(type, level);
        const next = statsAtLevel(type, level + 1);
        expect(next.damage).toBeGreaterThan(current.damage);
        expect(next.range).toBeGreaterThan(current.range);
      }
    }
  });

  it('en el nivel máximo no hay mejora disponible', () => {
    for (const type of TOWER_TYPE_LIST) {
      expect(upgradeCost(type, type.maxLevel)).toBeNull();
    }
  });
});

describe('tower-system: colocación y mejora', () => {
  it('colocar cobra el coste de la torre', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 100;
    selectShopTower(state, 'archer');
    expect(placeTower(state, 0, 0)).toBe(true);
    expect(state.gold).toBe(100 - TOWER_TYPES.archer.cost);
    expect(state.towers).toHaveLength(1);
  });

  it('sin oro suficiente no coloca ni cobra', () => {
    const state = createGameState();
    startGame(state);
    state.shopSelection = 'ballista';
    state.gold = 30;
    expect(placeTower(state, 0, 0)).toBe(false);
    expect(state.gold).toBe(30);
    expect(state.towers).toHaveLength(0);
  });

  it('pulsar una torre colocada la selecciona y muestra su coste de mejora', () => {
    const state = createGameState();
    startGame(state);
    const tower = placeAt(state, 'cannon', 1, 0);
    state.selectedTowerId = null;
    state.shopSelection = null;

    const center = cellCenter(1, 0);
    handleWorldTap(state, center.x, center.y);

    expect(getSelectedTower(state)?.id).toBe(tower.id);
    expect(selectedTowerUpgradeCost(state)).toBe(upgradeCost(TOWER_TYPES.cannon, 1));
  });

  it('mejorar sube el nivel, cobra el coste y mejora las estadísticas', () => {
    const state = createGameState();
    startGame(state);
    const tower = placeAt(state, 'archer', 1, 0);
    state.gold = 200;

    const before = statsAtLevel(TOWER_TYPES.archer, tower.level);
    const cost = selectedTowerUpgradeCost(state) as number;
    expect(upgradeSelectedTower(state)).toBe(true);

    expect(tower.level).toBe(2);
    expect(state.gold).toBe(200 - cost);
    expect(statsAtLevel(TOWER_TYPES.archer, tower.level).damage).toBeGreaterThan(before.damage);
  });

  it('no se puede mejorar más allá del nivel máximo', () => {
    const state = createGameState();
    startGame(state);
    const tower = placeAt(state, 'archer', 1, 0);
    tower.level = TOWER_TYPES.archer.maxLevel;
    state.gold = 10_000;

    expect(selectedTowerUpgradeCost(state)).toBeNull();
    expect(upgradeSelectedTower(state)).toBe(false);
    expect(tower.level).toBe(TOWER_TYPES.archer.maxLevel);
  });

  it('pulsar prado vacío sin torre de compra deselecciona', () => {
    const state = createGameState();
    startGame(state);
    placeAt(state, 'archer', 1, 0);
    state.shopSelection = null;

    const empty = cellCenter(3, 0);
    handleWorldTap(state, empty.x, empty.y);
    expect(getSelectedTower(state)).toBeNull();
  });
});

describe('tower-system: objetivos y disparo', () => {
  it('el cañón ignora a los enemigos aéreos', () => {
    const { state, tower, distance } = ambush('cannon');
    const bat = spawnEnemy(state, 'bat', 1);
    bat.distance = distance;
    bat.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.cannon.range)).toBeNull();
    run(state, 2);
    expect(bat.hp).toBe(bat.maxHp);
    expect(state.projectiles).toHaveLength(0);
  });

  it('las arqueras sí alcanzan a los enemigos aéreos', () => {
    const { state, tower, distance } = ambush('archer');
    const bat = spawnEnemy(state, 'bat', 1);
    bat.distance = distance;
    bat.speed = 0;
    run(state, 1 / 60);

    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(bat.id);
    run(state, 1.5);
    expect(bat.hp).toBeLessThan(bat.maxHp);
  });

  it('sin enemigos válidos en alcance no dispara', () => {
    const { state } = ambush('archer', 20);
    const far = spawnEnemy(state, 'grunt', 1);
    far.distance = 0;
    far.speed = 0;

    run(state, 2);
    expect(state.projectiles).toHaveLength(0);
    expect(far.hp).toBe(far.maxHp);
  });

  it('prioriza al enemigo más avanzado en el recorrido', () => {
    const { state, tower, distance } = ambush('archer');

    const behind = spawnEnemy(state, 'grunt', 1);
    behind.distance = distance - 20;
    behind.speed = 0;

    const ahead = spawnEnemy(state, 'grunt', 1);
    ahead.distance = distance + 20;
    ahead.speed = 0;

    run(state, 1 / 60);
    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(ahead.id);
  });

  it('respeta la cadencia de disparo', () => {
    const { state, tower, distance } = ambush('cannon');
    const target = spawnEnemy(state, 'warlord', 60);
    target.distance = distance;
    target.speed = 0;

    const seconds = 2.5;
    const rate = statsAtLevel(TOWER_TYPES.cannon, 1).fireRate;
    let shots = 0;
    let previousCooldown = tower.cooldown;

    for (let i = 0; i < Math.round(seconds * 60); i += 1) {
      run(state, 1 / 60);
      if (tower.cooldown > previousCooldown) shots += 1;
      previousCooldown = tower.cooldown;
    }

    // Con cadencia r, en t segundos caben como mucho floor(t*r)+1 disparos.
    expect(shots).toBeLessThanOrEqual(Math.floor(seconds * rate) + 1);
    expect(shots).toBeGreaterThanOrEqual(Math.floor(seconds * rate));
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('el proyectil aplica su daño al impactar', () => {
    const { state, distance } = ambush('archer');
    const target = spawnEnemy(state, 'brute', 1);
    target.distance = distance;
    target.speed = 0;

    run(state, 1.2);
    const damage = statsAtLevel(TOWER_TYPES.archer, 1).damage;
    expect(target.maxHp - target.hp).toBeGreaterThanOrEqual(damage);
    expect((target.maxHp - target.hp) % damage).toBe(0);
  });

  it('el daño de área alcanza a varios enemigos juntos', () => {
    const { state, distance } = ambush('mortar');

    const first = spawnEnemy(state, 'brute', 1);
    first.distance = distance + 15;
    first.speed = 0;

    const second = spawnEnemy(state, 'brute', 1);
    second.distance = distance - 15;
    second.speed = 0;

    run(state, 3);
    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
  });
});
