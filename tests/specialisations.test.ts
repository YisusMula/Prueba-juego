/**
 * Especializaciones de torre.
 *
 * Lo que se comprueba no es solo que los números cambien, sino las
 * consecuencias de diseño: que la elección sea una decisión (irreversible y a
 * mitad de la escalada), que no sea un peaje para seguir mejorando, y que cada
 * efecto nuevo haga lo que promete su descripción.
 */

import { describe, expect, it } from 'vitest';
import {
  SPECIALISATION_LEVEL,
  SPECIALISATIONS,
  specialisationsFor,
} from '../src/game/specialisations';
import {
  TOWER_MAX_LEVEL,
  TOWER_TYPE_LIST,
  frostFreezeCapacity,
  statsAtLevel,
  towerType,
} from '../src/game/towers';
import {
  createGameState,
  damageEnemy,
  placeTower,
  selectedTowerBranches,
  selectedTowerSpecialisation,
  sellSelectedTower,
  spawnEnemy,
  specialiseSelectedTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { FIXED_DT, step } from '../src/game/step';
import { grassBesidePath, quietRun, run } from './helpers';

/** Torre colocada junto al camino y seleccionada, subida al nivel indicado. */
function towerAtLevel(typeId: Parameters<typeof towerType>[0], level: number) {
  const state = createGameState();
  startGame(state);
  quietRun(state);
  state.gold = 500_000;

  const { cell } = grassBesidePath(6);
  state.shopSelection = typeId;
  expect(placeTower(state, cell.col, cell.row)).toBe(true);

  const tower = state.towers[0]!;
  state.selectedTowerId = tower.id;
  while (tower.level < level) upgradeSelectedTower(state);

  return { state, tower };
}

describe('tower-system: elección de especialización', () => {
  it('cada torre ofrece exactamente dos ramas', () => {
    for (const type of TOWER_TYPE_LIST) {
      expect(specialisationsFor(type.id), type.name).toHaveLength(2);
    }
    expect(SPECIALISATIONS).toHaveLength(TOWER_TYPE_LIST.length * 2);
  });

  it('por debajo del nivel no se puede especializar', () => {
    const { state, tower } = towerAtLevel('archer', SPECIALISATION_LEVEL - 1);

    expect(selectedTowerBranches(state)).toHaveLength(0);
    expect(specialiseSelectedTower(state, 'archer-needle')).toBe(false);
    expect(tower.specialisation).toBeNull();
  });

  it('al llegar al nivel se ofrecen las dos ramas', () => {
    const { state } = towerAtLevel('archer', SPECIALISATION_LEVEL);
    const branches = selectedTowerBranches(state);

    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch.name.length).toBeGreaterThan(0);
      expect(branch.blurb.length).toBeGreaterThan(0);
    }
  });

  it('la elección se conserva y deja de ofrecerse', () => {
    const { state, tower } = towerAtLevel('archer', SPECIALISATION_LEVEL);

    expect(specialiseSelectedTower(state, 'archer-needle')).toBe(true);
    expect(tower.specialisation).toBe('archer-needle');
    expect(selectedTowerSpecialisation(state)?.id).toBe('archer-needle');
    expect(selectedTowerBranches(state)).toHaveLength(0);
  });

  it('la elección es irreversible', () => {
    const { state, tower } = towerAtLevel('archer', SPECIALISATION_LEVEL);
    specialiseSelectedTower(state, 'archer-needle');

    expect(specialiseSelectedTower(state, 'archer-volley')).toBe(false);
    expect(tower.specialisation).toBe('archer-needle');
  });

  it('una rama de otro tipo de torre se rechaza', () => {
    const { state, tower } = towerAtLevel('archer', SPECIALISATION_LEVEL);

    expect(specialiseSelectedTower(state, 'cannon-piercer')).toBe(false);
    expect(tower.specialisation).toBeNull();
  });

  it('se puede llegar al nivel máximo sin especializarse', () => {
    const { tower } = towerAtLevel('archer', TOWER_MAX_LEVEL);

    expect(tower.level).toBe(TOWER_MAX_LEVEL);
    expect(tower.specialisation).toBeNull();
  });

  it('vender descarta la especialización', () => {
    const { state, tower } = towerAtLevel('archer', SPECIALISATION_LEVEL);
    specialiseSelectedTower(state, 'archer-needle');
    const { col, row } = tower;

    expect(sellSelectedTower(state)).toBe(true);

    state.shopSelection = 'archer';
    expect(placeTower(state, col, row)).toBe(true);
    const rebuilt = state.towers[0]!;
    expect(rebuilt.level).toBe(1);
    expect(rebuilt.specialisation).toBeNull();
  });
});

describe('tower-system: efecto sobre las estadísticas', () => {
  it('sin especialización las estadísticas no cambian', () => {
    for (const type of TOWER_TYPE_LIST) {
      for (const level of [1, 4, TOWER_MAX_LEVEL]) {
        const plain = statsAtLevel(type, level);
        expect(statsAtLevel(type, level, null)).toEqual(plain);
        expect(plain.piercing).toBe(false);
        expect(plain.chainTargets).toBe(0);
        expect(plain.vulnerability).toBe(1);
      }
    }
  });

  it('la rama de ráfaga dispara más rápido que la torre base', () => {
    const archer = towerType('archer');
    const base = statsAtLevel(archer, 5);
    const volley = statsAtLevel(archer, 5, 'archer-volley');

    expect(volley.fireRate).toBeGreaterThan(base.fireRate);
    expect(volley.damage).toBeLessThan(base.damage);
  });

  it('la metralla estrena daño en área en una torre que no lo tenía', () => {
    const cannon = towerType('cannon');
    expect(statsAtLevel(cannon, 5).splashRadius).toBe(0);
    expect(statsAtLevel(cannon, 5, 'cannon-grapeshot').splashRadius).toBeGreaterThan(0);
  });

  it('la escalada por nivel se mantiene con especialización', () => {
    for (const spec of SPECIALISATIONS) {
      const type = towerType(spec.towerId);
      const low = statsAtLevel(type, SPECIALISATION_LEVEL, spec.id);
      const high = statsAtLevel(type, TOWER_MAX_LEVEL, spec.id);

      expect(high.damage, spec.name).toBeGreaterThan(low.damage);
      expect(high.range, spec.name).toBeGreaterThanOrEqual(low.range);
      expect(high.fireRate, spec.name).toBeGreaterThan(low.fireRate);
    }
  });

  it('ninguna rama domina a la otra en daño por segundo', () => {
    for (const type of TOWER_TYPE_LIST) {
      // La torre de hielo se excluye: su papel es el control, no el daño, y
      // sus dos ramas no se comparan por daño por segundo.
      if (type.id === 'frost') continue;

      const [a, b] = specialisationsFor(type.id);
      const dps = (id: (typeof SPECIALISATIONS)[number]['id']): number => {
        const stats = statsAtLevel(type, 6, id);
        return stats.damage * stats.fireRate * (1 + stats.splashRadius / 60);
      };

      const ratio = dps(a!.id) / dps(b!.id);
      // Un factor de 2 significaría que una rama es simplemente la buena.
      expect(ratio, `${type.name}: ${a!.name} vs ${b!.name}`).toBeGreaterThan(0.5);
      expect(ratio, `${type.name}: ${a!.name} vs ${b!.name}`).toBeLessThan(2);
    }
  });

  it('la ventisca amplía el cupo de congelación', () => {
    expect(frostFreezeCapacity(4, 'frost-blizzard')).toBeGreaterThan(frostFreezeCapacity(4));
  });

  it('la estructura no depende de la rama', () => {
    for (const spec of SPECIALISATIONS) {
      const type = towerType(spec.towerId);
      expect(statsAtLevel(type, 6, spec.id).maxHp, spec.name).toBe(statsAtLevel(type, 6).maxHp);
    }
  });
});

describe('tower-system: perforación', () => {
  it('cada torre de daño tiene una rama perforante', () => {
    for (const type of TOWER_TYPE_LIST) {
      // El hielo controla y la mágica pega fuerte por su cuenta: ninguna de las
      // dos necesita una rama antiarmadura.
      if (type.id === 'frost' || type.id === 'magic') continue;
      const piercing = specialisationsFor(type.id).filter((spec) => spec.piercing);
      expect(piercing, type.name).toHaveLength(1);
    }
  });

  it('la torre perforante ignora la armadura y la normal no', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const piercedTarget = spawnEnemy(state, 'golem', 30);
    const plainTarget = spawnEnemy(state, 'golem', 30);
    const armor = piercedTarget.armor;
    expect(armor).toBeGreaterThan(0);

    const before = piercedTarget.hp;
    damageEnemy(state, piercedTarget, 100, true);
    damageEnemy(state, plainTarget, 100, false);

    expect(before - piercedTarget.hp).toBe(100);
    expect(before - plainTarget.hp).toBe(100 - armor);
  });
});

describe('tower-system: cadena', () => {
  /** Deja una torre mágica encadenada disparando a un grupo apretado. */
  function chainSetup(domain: 'ground' | 'air') {
    const { state, tower } = towerAtLevel('magic', SPECIALISATION_LEVEL);
    specialiseSelectedTower(state, 'magic-chain');
    state.selectedTowerId = null;

    const spot = grassBesidePath(6);
    const targets = [0, 1, 2].map(() => {
      const enemy = spawnEnemy(state, domain === 'air' ? 'bat' : 'rat', 400);
      enemy.distance = spot.distance;
      return enemy;
    });
    return { state, tower, targets };
  }

  it('el rayo salta a los enemigos cercanos, cada vez con menos daño', () => {
    const { state, targets } = chainSetup('ground');
    const maxHp = targets[0]!.maxHp;

    // Tiempo suficiente para un disparo y su impacto.
    for (let i = 0; i < 240; i += 1) step(state, FIXED_DT);

    const damage = targets.map((enemy) => maxHp - enemy.hp);
    const hit = damage.filter((value) => value > 0);
    expect(hit.length, 'la cadena no alcanzó a varios enemigos').toBeGreaterThanOrEqual(2);

    const sorted = [...damage].sort((a, b) => b - a);
    expect(sorted[0]).toBeGreaterThan(sorted[1] as number);
  });

  it('la cadena respeta el dominio de la torre', () => {
    const { state, tower } = towerAtLevel('cannon', SPECIALISATION_LEVEL);
    state.selectedTowerId = null;
    // El cañón no tiene rama de cadena; se le fuerza para aislar la regla de
    // dominio del catálogo de ramas.
    tower.specialisation = 'magic-chain';

    const spot = grassBesidePath(6);
    const ground = spawnEnemy(state, 'rat', 400);
    ground.distance = spot.distance;
    const air = spawnEnemy(state, 'bat', 400);
    air.distance = spot.distance;
    const airHp = air.hp;

    for (let i = 0; i < 240; i += 1) step(state, FIXED_DT);

    expect(ground.hp).toBeLessThan(ground.maxHp);
    expect(air.hp).toBe(airHp);
  });

  it('un enemigo no recibe dos impactos del mismo disparo', () => {
    const { state } = chainSetup('ground');
    const pair = state.enemies.slice(0, 2);
    for (const enemy of state.enemies.slice(2)) enemy.hp = 0;
    state.enemies = pair;

    const maxHp = pair[0]!.maxHp;
    const damageSoFar = (): number => pair.reduce((sum, enemy) => sum + (maxHp - enemy.hp), 0);

    // Se para en el primer impacto: la cadena entera se resuelve dentro de un
    // solo paso, así que ese instante es exactamente el daño de un disparo.
    // Dejarlo correr más mediría dos disparos y no diría nada de la cadena.
    for (let i = 0; i < 300 && damageSoFar() === 0; i += 1) step(state, FIXED_DT);
    expect(damageSoFar(), 'la torre no llegó a disparar').toBeGreaterThan(0);

    // Con dos enemigos y dos saltos disponibles, repetir objetivo daría un
    // salto extra: el daño de un disparo se pasaría de impacto más un salto.
    const stats = statsAtLevel(towerType('magic'), SPECIALISATION_LEVEL, 'magic-chain');
    expect(damageSoFar()).toBeLessThanOrEqual(stats.damage * (1 + stats.chainFalloff) + 1);
  });
});

describe('tower-system: fragilidad', () => {
  /** Enemigo congelado por una torre de hielo con la rama indicada. */
  function frozenBy(branch: 'frost-brittle' | null) {
    const { state, tower } = towerAtLevel('frost', SPECIALISATION_LEVEL);
    if (branch) specialiseSelectedTower(state, branch);
    state.selectedTowerId = null;

    const spot = grassBesidePath(6);
    const enemy = spawnEnemy(state, 'dog', 900);
    enemy.distance = spot.distance;

    // Tiempo para que la torre dispare y congele.
    for (let i = 0; i < 240 && enemy.slowTimer <= 0; i += 1) step(state, FIXED_DT);
    expect(enemy.slowTimer, 'el enemigo no llegó a congelarse').toBeGreaterThan(0);

    return { state, tower, enemy };
  }

  it('otra torre aprovecha la fragilidad', () => {
    const brittle = frozenBy('frost-brittle');
    const plain = frozenBy(null);

    const beforeBrittle = brittle.enemy.hp;
    const beforePlain = plain.enemy.hp;
    damageEnemy(brittle.state, brittle.enemy, 100);
    damageEnemy(plain.state, plain.enemy, 100);

    expect(beforeBrittle - brittle.enemy.hp).toBeGreaterThan(beforePlain - plain.enemy.hp);
    expect(beforePlain - plain.enemy.hp).toBe(100);
  });

  it('la fragilidad se acaba con la congelación', () => {
    const { state, enemy } = frozenBy('frost-brittle');
    // Se retira la torre para que no vuelva a congelarlo mientras se espera.
    state.towers = [];
    run(state, 6);
    expect(enemy.slowTimer).toBe(0);

    const before = enemy.hp;
    damageEnemy(state, enemy, 100);
    expect(before - enemy.hp).toBe(100);
  });
});
