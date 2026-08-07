import { describe, expect, it } from 'vitest';
import {
  TOWER_TYPES,
  TOWER_TYPE_LIST,
  type TowerTypeId,
  effectiveDps,
  frostFreezeCapacity,
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
  repairSelectedTower,
  selectShopTower,
  selectedTowerRepairCost,
  selectedTowerUpgradeCost,
  spawnEnemy,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { cellCenter } from '../src/game/map';
import { FREEZE_SLOW_FACTOR, findTarget } from '../src/game/step';
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

  it('a mayor coste base, mayor daño por segundo efectivo (torres de daño directo)', () => {
    const damageFocused = TOWER_TYPE_LIST.filter((type) => type.id !== 'frost');
    for (const a of damageFocused) {
      for (const b of damageFocused) {
        if (a.cost < b.cost) expect(effectiveDps(a)).toBeLessThan(effectiveDps(b));
      }
    }
  });

  it('la torre de hielo prioriza el control sobre el daño', () => {
    for (const type of TOWER_TYPE_LIST) {
      if (type.id === 'frost') continue;
      expect(TOWER_TYPES.frost.damage).toBeLessThan(type.damage);
    }
  });

  it('hay al menos una torre antiaérea y una de área', () => {
    expect(TOWER_TYPE_LIST.some((type) => type.canTargetAir)).toBe(true);
    expect(TOWER_TYPE_LIST.some((type) => type.splashRadius > 0)).toBe(true);
  });

  it('la torre mágica y la de hielo atacan a tierra y aire', () => {
    expect(TOWER_TYPES.magic.canTargetGround).toBe(true);
    expect(TOWER_TYPES.magic.canTargetAir).toBe(true);
    expect(TOWER_TYPES.frost.canTargetGround).toBe(true);
    expect(TOWER_TYPES.frost.canTargetAir).toBe(true);
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

  it('pulsar una torre existente con una compra activa la selecciona sin cobrar', () => {
    const state = createGameState();
    startGame(state);
    const tower = placeAt(state, 'cannon', 1, 0);
    state.selectedTowerId = null;
    state.gold = 500;
    state.shopSelection = 'archer';

    const center = cellCenter(1, 0);
    handleWorldTap(state, center.x, center.y);

    expect(getSelectedTower(state)?.id).toBe(tower.id);
    expect(state.towers).toHaveLength(1);
    expect(state.gold).toBe(500);
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
    const far = spawnEnemy(state, 'rat', 1);
    far.distance = 0;
    far.speed = 0;

    run(state, 2);
    expect(state.projectiles).toHaveLength(0);
    expect(far.hp).toBe(far.maxHp);
  });

  it('prioriza al enemigo más avanzado en el recorrido', () => {
    const { state, tower, distance } = ambush('archer');

    const behind = spawnEnemy(state, 'rat', 1);
    behind.distance = distance - 20;
    behind.speed = 0;

    const ahead = spawnEnemy(state, 'rat', 1);
    ahead.distance = distance + 20;
    ahead.speed = 0;

    run(state, 1 / 60);
    expect(findTarget(state, tower, TOWER_TYPES.archer.range)?.id).toBe(ahead.id);
  });

  it('respeta la cadencia de disparo', () => {
    const { state, tower, distance } = ambush('cannon');
    const target = spawnEnemy(state, 'dog', 40);
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
    const target = spawnEnemy(state, 'dog', 1);
    target.distance = distance;
    target.speed = 0;

    run(state, 1.2);
    const damage = statsAtLevel(TOWER_TYPES.archer, 1).damage;
    expect(target.maxHp - target.hp).toBeGreaterThanOrEqual(damage);
    expect((target.maxHp - target.hp) % damage).toBe(0);
  });

  it('el daño de área alcanza a varios enemigos juntos', () => {
    const { state, distance } = ambush('mortar');

    const first = spawnEnemy(state, 'dog', 1);
    first.distance = distance + 15;
    first.speed = 0;

    const second = spawnEnemy(state, 'dog', 1);
    second.distance = distance - 15;
    second.speed = 0;

    run(state, 3);
    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
  });
});

describe('tower-system: enemigos que dañan torres', () => {
  it('un enemigo capaz reduce la estructura de una torre cercana', () => {
    const { state, tower, distance } = ambush('archer');

    const boar = spawnEnemy(state, 'boar', 1);
    boar.distance = distance;
    boar.speed = 0;

    const maxHp = statsAtLevel(TOWER_TYPES.archer, 1).maxHp;
    expect(tower.hp).toBe(maxHp);

    run(state, 1);
    expect(tower.hp).toBeLessThan(maxHp);
  });

  it('un enemigo sin esa capacidad no daña torres', () => {
    const { state, tower, distance } = ambush('archer');
    const maxHp = statsAtLevel(TOWER_TYPES.archer, 1).maxHp;

    const rat = spawnEnemy(state, 'rat', 1);
    rat.distance = distance;
    rat.speed = 0;

    run(state, 2);
    expect(tower.hp).toBe(maxHp);
  });

  it('una torre sin estructura no dispara', () => {
    const { state, tower, distance } = ambush('archer');
    tower.hp = 0;

    const enemy = spawnEnemy(state, 'rat', 1);
    enemy.distance = distance;
    enemy.speed = 0;

    run(state, 2);
    expect(state.projectiles).toHaveLength(0);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('el enemigo reanuda su avance tras terminar el golpe', () => {
    const { state, distance } = ambush('archer');
    const boar = spawnEnemy(state, 'boar', 1);
    boar.distance = distance;

    run(state, 0.3);
    expect(boar.meleeTimer).toBeGreaterThan(0);

    run(state, 2.5);
    expect(boar.meleeTimer).toBe(0);
    // Habiendo dejado de estar clavado, ha avanzado desde el punto del golpe.
    expect(boar.distance).toBeGreaterThan(distance);
  });
});

describe('tower-system: reparación', () => {
  it('reparar restaura la estructura y cobra su coste', () => {
    const { state, tower } = ambush('cannon');
    const maxHp = statsAtLevel(TOWER_TYPES.cannon, 1).maxHp;
    tower.hp = Math.round(maxHp * 0.4);
    state.selectedTowerId = tower.id;
    state.gold = 10_000;

    const cost = selectedTowerRepairCost(state) as number;
    expect(cost).toBeGreaterThan(0);

    const goldBefore = state.gold;
    expect(repairSelectedTower(state)).toBe(true);
    expect(tower.hp).toBe(maxHp);
    expect(state.gold).toBe(goldBefore - cost);
  });

  it('reparar sin oro suficiente no hace nada', () => {
    const { state, tower } = ambush('cannon');
    const maxHp = statsAtLevel(TOWER_TYPES.cannon, 1).maxHp;
    tower.hp = Math.round(maxHp * 0.2);
    state.selectedTowerId = tower.id;
    state.gold = 0;

    expect(repairSelectedTower(state)).toBe(false);
    expect(tower.hp).toBe(Math.round(maxHp * 0.2));
    expect(state.gold).toBe(0);
  });

  it('una torre a máxima estructura no ofrece reparar', () => {
    const { state, tower } = ambush('cannon');
    state.selectedTowerId = tower.id;
    expect(selectedTowerRepairCost(state)).toBeNull();
  });

  it('una torre reparada vuelve a disparar', () => {
    const { state, tower, distance } = ambush('archer');
    tower.hp = 0;
    state.selectedTowerId = tower.id;
    state.gold = 10_000;
    expect(repairSelectedTower(state)).toBe(true);

    const enemy = spawnEnemy(state, 'rat', 1);
    enemy.distance = distance;
    enemy.speed = 0;

    run(state, 2);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('tower-system: efecto de congelación', () => {
  it('un enemigo congelado avanza mucho más lento', () => {
    const { state, distance } = ambush('frost');
    const enemy = spawnEnemy(state, 'dog', 1);
    enemy.distance = distance;

    run(state, 2);
    expect(enemy.slowTimer).toBeGreaterThan(0);

    const before = enemy.distance;
    run(state, 1 / 60);
    const advanced = enemy.distance - before;
    const normalAdvance = enemy.speed * (1 / 60);
    expect(advanced).toBeCloseTo(normalAdvance * FREEZE_SLOW_FACTOR, 5);
  });

  it('en nivel bajo, la torre de hielo no congela a un segundo enemigo', () => {
    expect(frostFreezeCapacity(1)).toBe(1);

    const { state, tower, distance } = ambush('frost');
    const first = spawnEnemy(state, 'dog', 1);
    first.distance = distance - 20;
    first.speed = 0;
    const second = spawnEnemy(state, 'dog', 1);
    second.distance = distance + 20;
    second.speed = 0;

    run(state, 3);

    const frozenCount = [first, second].filter((enemy) => enemy.slowTimer > 0).length;
    expect(frozenCount).toBeLessThanOrEqual(1);
    expect(tower.frozenTargets.length).toBeLessThanOrEqual(1);
  });

  it('en nivel alto, la torre de hielo congela a varios enemigos', () => {
    // La torre solo dispara al más avanzado de los dos, así que para
    // congelar a ambos hace falta que cada uno lo sea en su momento: primero
    // `a`, luego se adelanta `b` y pasa a recibir el siguiente impacto.
    const { state, tower, distance } = ambush('frost');
    tower.level = 5;
    expect(frostFreezeCapacity(tower.level)).toBe(2);

    const a = spawnEnemy(state, 'dog', 1);
    a.distance = distance + 20;
    a.speed = 0;
    const b = spawnEnemy(state, 'dog', 1);
    b.distance = distance - 20;
    b.speed = 0;

    run(state, 1.8);
    expect(a.slowTimer).toBeGreaterThan(0);
    expect(tower.frozenTargets).toContain(a.id);

    b.distance = distance + 40;
    run(state, 1);

    expect(a.slowTimer).toBeGreaterThan(0);
    expect(b.slowTimer).toBeGreaterThan(0);
    expect(tower.frozenTargets).toContain(a.id);
    expect(tower.frozenTargets).toContain(b.id);
  });
});
