import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/game/abilities';
import {
  abilitySlot,
  castAbility,
  createGameState,
  handleWorldTap,
  isAbilityReady,
  pauseGame,
  placeTower,
  selectAbility,
  selectShopTower,
  spawnEnemy,
  startGame,
} from '../src/game/state';
import { cellCenter } from '../src/game/map';
import { quietRun, run } from './helpers';

describe('hero-abilities: efectos', () => {
  it('el meteoro daña a los enemigos del área', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const enemy = spawnEnemy(state, 'orc', 1);
    const hpBefore = enemy.hp;

    expect(castAbility(state, 'meteor', enemy.x, enemy.y)).toBe(true);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('el meteoro no alcanza a quien está fuera de su radio', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const enemy = spawnEnemy(state, 'orc', 1);
    const hpBefore = enemy.hp;

    castAbility(state, 'meteor', enemy.x + ABILITIES.meteor.radius * 3, enemy.y);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('el meteoro alcanza a aéreos y terrestres por igual', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const ground = spawnEnemy(state, 'orc', 1);
    const air = spawnEnemy(state, 'vulture', 1);
    const groundBefore = ground.hp;
    const airBefore = air.hp;

    castAbility(state, 'meteor', ground.x, ground.y);
    expect(ground.hp).toBeLessThan(groundBefore);
    expect(air.hp).toBeLessThan(airBefore);
  });

  it('la ventisca congela a todos los enemigos del escenario', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    const a = spawnEnemy(state, 'orc', 1);
    const b = spawnEnemy(state, 'rat', 1);
    b.distance = 500;
    run(state, 1 / 60);

    expect(castAbility(state, 'blizzard')).toBe(true);
    expect(a.slowTimer).toBeGreaterThan(0);
    expect(b.slowTimer).toBeGreaterThan(0);
  });
});

describe('hero-abilities: recarga', () => {
  it('las habilidades empiezan disponibles', () => {
    const state = createGameState();
    startGame(state);
    expect(isAbilityReady(state, 'meteor')).toBe(true);
    expect(isAbilityReady(state, 'blizzard')).toBe(true);
  });

  it('una habilidad recién usada no se puede repetir', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    expect(castAbility(state, 'blizzard')).toBe(true);
    expect(isAbilityReady(state, 'blizzard')).toBe(false);
    expect(castAbility(state, 'blizzard')).toBe(false);
  });

  it('la habilidad vuelve al terminar su recarga', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    castAbility(state, 'blizzard');

    run(state, ABILITIES.blizzard.cooldown + 0.2);
    expect(isAbilityReady(state, 'blizzard')).toBe(true);
  });

  it('la recarga no avanza en pausa', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    castAbility(state, 'blizzard');

    const remaining = abilitySlot(state, 'blizzard')?.cooldown;
    pauseGame(state);
    run(state, 5);

    expect(abilitySlot(state, 'blizzard')?.cooldown).toBe(remaining);
  });

  it('reiniciar la partida deja las habilidades listas', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    castAbility(state, 'blizzard');
    expect(isAbilityReady(state, 'blizzard')).toBe(false);

    startGame(state);
    expect(isAbilityReady(state, 'blizzard')).toBe(true);
  });
});

describe('hero-abilities: apuntado', () => {
  it('seleccionar una habilidad dirigida entra en apuntado sin gastarla', () => {
    const state = createGameState();
    startGame(state);

    expect(selectAbility(state, 'meteor')).toBe(true);
    expect(state.aimingAbility).toBe('meteor');
    expect(isAbilityReady(state, 'meteor')).toBe(true);
  });

  it('seleccionar una habilidad inmediata la lanza ya', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);

    expect(selectAbility(state, 'blizzard')).toBe(true);
    expect(state.aimingAbility).toBeNull();
    expect(isAbilityReady(state, 'blizzard')).toBe(false);
  });

  it('apuntar y pulsar lanza la habilidad, no coloca torre', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    state.gold = 1000;

    selectShopTower(state, 'archer');
    selectAbility(state, 'meteor');
    expect(state.shopSelection).toBeNull();

    const center = cellCenter(0, 0);
    handleWorldTap(state, center.x, center.y);

    expect(state.towers).toHaveLength(0);
    expect(isAbilityReady(state, 'meteor')).toBe(false);
    expect(state.aimingAbility).toBeNull();
  });

  it('cancelar el apuntado no gasta la habilidad', () => {
    const state = createGameState();
    startGame(state);

    selectAbility(state, 'meteor');
    expect(selectAbility(state, 'meteor')).toBe(true);

    expect(state.aimingAbility).toBeNull();
    expect(isAbilityReady(state, 'meteor')).toBe(true);
  });

  it('elegir una torre en la tienda cancela el apuntado', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 1000;

    selectAbility(state, 'meteor');
    selectShopTower(state, 'archer');

    expect(state.aimingAbility).toBeNull();
    expect(state.shopSelection).toBe('archer');
  });

  it('una habilidad en recarga no entra en apuntado', () => {
    const state = createGameState();
    startGame(state);
    quietRun(state);
    castAbility(state, 'meteor', 100, 100);

    expect(selectAbility(state, 'meteor')).toBe(false);
    expect(state.aimingAbility).toBeNull();
  });
});

describe('hero-abilities: solo durante la partida', () => {
  it('no se usan con la partida terminada', () => {
    const state = createGameState();
    startGame(state);
    state.screen = 'defeat';

    expect(castAbility(state, 'blizzard')).toBe(false);
    expect(selectAbility(state, 'meteor')).toBe(false);
  });

  it('no se usan desde el menú', () => {
    const state = createGameState();
    expect(castAbility(state, 'blizzard')).toBe(false);
  });

  it('no se usan en pausa', () => {
    const state = createGameState();
    startGame(state);
    pauseGame(state);

    expect(castAbility(state, 'blizzard')).toBe(false);
  });
});

describe('interacción: colocar torre sigue funcionando con habilidades presentes', () => {
  it('sin apuntado, pulsar coloca como siempre', () => {
    const state = createGameState();
    startGame(state);
    state.gold = 1000;
    selectShopTower(state, 'archer');

    const center = cellCenter(0, 0);
    handleWorldTap(state, center.x, center.y);
    expect(state.towers).toHaveLength(1);
    expect(placeTower(state, 0, 0)).toBe(false);
  });
});
