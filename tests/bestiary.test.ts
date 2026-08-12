/**
 * Rasgos del bestiario: armadura, sanación y división.
 *
 * Cada uno existe para forzar un contrajuego distinto, así que lo que se
 * comprueba no es solo que el número cambie, sino que la consecuencia de
 * diseño se cumpla: que la armadura distinga entre torres, que matar al
 * sanador resuelva el problema y que la división no se encadene.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES } from '../src/game/enemies';
import {
  castAbility,
  createGameState,
  damageAfterArmor,
  damageEnemy,
  spawnEnemy,
  startGame,
} from '../src/game/state';
import { describeWave } from '../src/game/waves';
import { quietRun, run } from './helpers';

function armouredState() {
  const state = createGameState();
  startGame(state);
  quietRun(state);
  return state;
}

describe('wave-system: armadura', () => {
  it('la armadura resta una cantidad fija al daño de torre', () => {
    const state = armouredState();
    const enemy = spawnEnemy(state, 'beetle', 10);
    enemy.armor = 6;
    const before = enemy.hp;

    damageEnemy(state, enemy, 20);
    expect(before - enemy.hp).toBe(14);
  });

  it('la armadura nunca vuelve inmune al enemigo', () => {
    const state = armouredState();
    const enemy = spawnEnemy(state, 'beetle', 10);
    enemy.armor = 6;
    const before = enemy.hp;

    damageEnemy(state, enemy, 2);
    expect(before - enemy.hp).toBe(1);
  });

  it('un enemigo sin armadura recibe el daño íntegro', () => {
    const state = armouredState();
    const enemy = spawnEnemy(state, 'rat', 10);
    const before = enemy.hp;

    damageEnemy(state, enemy, 20);
    expect(before - enemy.hp).toBe(20);
  });

  it('las habilidades atraviesan la armadura', () => {
    const state = createGameState();
    startGame(state);
    state.wavePhase = 'clearing';
    state.spawnQueue = [];
    state.enemies = [];

    const enemy = spawnEnemy(state, 'golem', 20);
    enemy.armor = 14;
    const before = enemy.hp;

    // El meteoro cae justo encima.
    castAbility(state, 'meteor', enemy.x, enemy.y);
    expect(before - enemy.hp).toBe(320);
  });

  it('la torre de cadencia alta rinde peor contra un acorazado', () => {
    // Mismo daño por segundo nominal: 30 golpes de 10 frente a 3 de 100.
    const enemy = { armor: 8 } as { armor: number };
    const manySmall = 30 * damageAfterArmor(enemy as never, 10);
    const fewLarge = 3 * damageAfterArmor(enemy as never, 100);

    expect(fewLarge).toBeGreaterThan(manySmall);
  });
});

describe('wave-system: sanación', () => {
  it('el aura cura a los enemigos cercanos sin pasar del máximo', () => {
    const state = armouredState();
    const healer = spawnEnemy(state, 'shaman', 1);
    const hurt = spawnEnemy(state, 'rat', 10);
    const intact = spawnEnemy(state, 'rat', 10);

    // Los dos, pegados al sanador.
    for (const enemy of [hurt, intact]) {
      enemy.x = healer.x;
      enemy.y = healer.y;
      enemy.distance = healer.distance;
    }
    hurt.hp = Math.floor(hurt.maxHp / 2);
    const before = hurt.hp;

    run(state, 1);

    expect(hurt.hp).toBeGreaterThan(before);
    expect(intact.hp).toBe(intact.maxHp);
    expect(hurt.hp).toBeLessThanOrEqual(hurt.maxHp);
  });

  it('fuera del radio no hay cura', () => {
    const state = armouredState();
    const healer = spawnEnemy(state, 'shaman', 1);
    const far = spawnEnemy(state, 'rat', 10);
    // Se separa por distancia de recorrido, no por coordenadas: la simulación
    // recalcula x/y a partir de la distancia en cada paso.
    far.distance = healer.distance + healer.healRadius * 6;
    far.hp = 5;

    run(state, 1);
    expect(far.hp).toBe(5);
  });

  it('matar al sanador detiene la cura', () => {
    const state = armouredState();
    const healer = spawnEnemy(state, 'shaman', 1);
    const hurt = spawnEnemy(state, 'rat', 10);
    hurt.x = healer.x;
    hurt.y = healer.y;
    hurt.hp = 5;

    damageEnemy(state, healer, healer.hp + healer.armor);
    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);

    run(state, 1);
    expect(hurt.hp).toBe(5);
  });
});

describe('wave-system: división', () => {
  it('al morir deja dos crías donde cayó', () => {
    const state = armouredState();
    const slime = spawnEnemy(state, 'slime', 1);
    slime.distance = 400;
    const { x, y } = slime;

    damageEnemy(state, slime, slime.hp + slime.armor);
    const children = state.enemies.filter((enemy) => enemy.typeId === 'slimeling');

    expect(children).toHaveLength(ENEMY_TYPES.slime.splitCount);
    for (const child of children) {
      expect(child.x).toBe(x);
      expect(child.y).toBe(y);
      expect(child.distance).toBe(slime.distance);
      expect(child.routeIndex).toBe(slime.routeIndex);
    }
  });

  it('las crías no se vuelven a dividir', () => {
    const state = armouredState();
    const child = spawnEnemy(state, 'slimeling', 1);
    const before = state.enemies.length;

    damageEnemy(state, child, child.hp + child.armor);
    expect(state.enemies.length).toBe(before);
  });

  it('un divisor que llega a la meta no deja crías', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const slime = spawnEnemy(state, 'slime', 1);
    slime.distance = Number.MAX_SAFE_INTEGER;
    const livesBefore = state.lives;

    run(state, 1 / 60);

    expect(state.lives).toBe(livesBefore - 1);
    expect(state.enemies.filter((enemy) => enemy.typeId === 'slimeling')).toHaveLength(0);
  });
});

describe('wave-system: aviso de rasgos', () => {
  it('la primera oleada no anuncia ningún rasgo especial', () => {
    const first = describeWave(1);
    expect(first.hasArmored).toBe(false);
    expect(first.hasHealers).toBe(false);
    expect(first.hasSplitters).toBe(false);
  });

  it('cada rasgo se anuncia desde su oleada de entrada', () => {
    expect(describeWave(30).hasArmored).toBe(true);
    expect(describeWave(30).hasHealers).toBe(true);
    expect(describeWave(30).hasSplitters).toBe(true);
  });

  it('las criaturas nuevas se quedan una vez aparecen', () => {
    const introduced = new Map<string, number>();
    for (let wave = 1; wave <= 30; wave += 1) {
      for (const group of describeWave(wave).groups) {
        if (!introduced.has(group.typeId)) introduced.set(group.typeId, wave);
      }
    }

    for (const typeId of ['spider', 'beetle', 'slime', 'shaman', 'golem']) {
      const first = introduced.get(typeId);
      expect(first, `${typeId} no aparece nunca`).toBeDefined();

      for (let wave = first as number; wave <= 30; wave += 1) {
        const present = describeWave(wave).groups.some((group) => group.typeId === typeId);
        expect(present, `${typeId} falta en la oleada ${wave}`).toBe(true);
      }
    }
  });
});
