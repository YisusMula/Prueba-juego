/**
 * Guardado y reanudación de la partida.
 *
 * En Node no hay `localStorage`, así que se monta uno mínimo en memoria: lo que
 * se quiere probar es la serialización y la validación, no el navegador.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRun,
  loadRun,
  loadRunSummary,
  saveRun,
  serialiseRun,
} from '../src/storage/savegame';
import {
  addEffect,
  createGameState,
  emitSound,
  placeTower,
  restoreRun,
  spawnEnemy,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { FIXED_DT, step } from '../src/game/step';
import { grassBesidePath } from './helpers';
import { scenario } from '../src/game/scenarios';

const RUN_KEY = 'tower-game:run:v1';

/** `localStorage` mínimo en memoria. */
function installStorage(): Map<string, string> {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  return data;
}

function removeStorage(): void {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
}

/** Partida avanzada: torres, enemigos y proyectiles en vuelo. */
function busyRun() {
  const state = createGameState('normal', 'crossroads');
  startGame(state);
  state.gold = 5_000;

  // Las celdas se buscan en el escenario de la partida: una casilla de prado
  // del mapa por defecto puede ser camino en este.
  const scene = scenario('crossroads');
  for (const index of [6, 14, 22]) {
    const { cell } = grassBesidePath(index, scene, 0);
    state.shopSelection = 'archer';
    if (placeTower(state, cell.col, cell.row)) {
      state.selectedTowerId = state.towers[state.towers.length - 1]!.id;
      upgradeSelectedTower(state);
    }
  }
  state.selectedTowerId = null;

  for (let i = 0; i < 6; i += 1) spawnEnemy(state, 'rat', 2);
  for (let i = 0; i < 120; i += 1) step(state, FIXED_DT);

  return state;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installStorage();
});

afterEach(() => {
  removeStorage();
});

describe('run-progression: guardado de la partida', () => {
  it('la ida y vuelta conserva la partida', () => {
    const state = busyRun();
    expect(state.towers.length).toBeGreaterThan(0);

    saveRun(state);
    const loaded = loadRun();

    expect(loaded).not.toBeNull();
    expect(loaded!.waveIndex).toBe(state.waveIndex);
    expect(loaded!.wavePhase).toBe(state.wavePhase);
    expect(loaded!.gold).toBe(state.gold);
    expect(loaded!.lives).toBe(state.lives);
    expect(loaded!.scenarioId).toBe(state.scenarioId);
    expect(loaded!.difficultyId).toBe(state.difficultyId);
    expect(loaded!.towers).toEqual(state.towers);
    expect(loaded!.enemies).toEqual(state.enemies);
    expect(loaded!.projectiles).toEqual(state.projectiles);
    expect(loaded!.abilities).toEqual(state.abilities);
    expect(loaded!.stats).toEqual(state.stats);
  });

  it('el infinito sobrevive a la ida y vuelta', () => {
    // `JSON.stringify(Infinity)` produce `null`. Con eso, la distancia de fuga
    // de un enemigo que nunca abandona el camino pasaría a valer 0 y la
    // comparación `distance >= breakawayDistance` sería cierta desde el primer
    // instante.
    const state = busyRun();
    const never = state.enemies.find((enemy) => enemy.breakawayDistance === Infinity);
    expect(never, 'ningún enemigo con fuga infinita en el montaje').toBeDefined();

    saveRun(state);
    const loaded = loadRun()!;

    expect(loaded.enemies.some((enemy) => enemy.breakawayDistance === Infinity)).toBe(true);
    expect(loaded.enemies.some((enemy) => enemy.breakawayDistance === null as never)).toBe(false);
  });

  it('los efectos y los sonidos no se restauran', () => {
    const state = busyRun();
    addEffect(state, 'gold', 10, 10, { text: '+5' });
    emitSound(state, 'kill');
    expect(state.effects.length).toBeGreaterThan(0);
    expect(state.soundQueue.length).toBeGreaterThan(0);

    saveRun(state);
    const loaded = loadRun()!;

    expect(loaded.effects).toEqual([]);
    expect(loaded.soundQueue).toEqual([]);
  });

  it('la partida restaurada continúa igual que la original', () => {
    const original = busyRun();
    saveRun(original);

    const resumed = createGameState();
    restoreRun(resumed, loadRun()!);

    for (let i = 0; i < 300; i += 1) {
      step(original, FIXED_DT);
      step(resumed, FIXED_DT);
    }

    expect(resumed.waveIndex).toBe(original.waveIndex);
    expect(resumed.lives).toBe(original.lives);
    expect(resumed.gold).toBe(original.gold);
    expect(resumed.stats.kills).toBe(original.stats.kills);
    expect(resumed.enemies.map((enemy) => enemy.id)).toEqual(
      original.enemies.map((enemy) => enemy.id),
    );
  });

  it('guardar no altera la partida', () => {
    const state = busyRun();
    const before = JSON.stringify(state);

    saveRun(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('el resumen dice escenario, oleada y vidas', () => {
    const state = busyRun();
    saveRun(state);

    const summary = loadRunSummary()!;
    expect(summary.scenarioId).toBe('crossroads');
    expect(summary.wave).toBe(Math.max(1, state.waveIndex));
    expect(summary.lives).toBe(state.lives);
  });

  it('restaurar descarta el apuntado y la compra a medias', () => {
    const state = busyRun();
    state.aimingAbility = 'meteor';
    state.shopSelection = 'cannon';
    saveRun(state);

    const resumed = createGameState();
    restoreRun(resumed, loadRun()!);

    expect(resumed.aimingAbility).toBeNull();
    expect(resumed.shopSelection).toBeNull();
  });

  it('serialiseRun deja el original intacto', () => {
    const state = busyRun();
    addEffect(state, 'hit', 5, 5);
    const copy = serialiseRun(state);

    expect(copy.effects).toEqual([]);
    expect(state.effects.length).toBeGreaterThan(0);
  });
});

describe('run-progression: validez del guardado', () => {
  it('sin guardado no hay nada que reanudar', () => {
    expect(loadRun()).toBeNull();
    expect(loadRunSummary()).toBeNull();
  });

  it('una versión distinta se descarta', () => {
    const state = busyRun();
    saveRun(state);

    const payload = JSON.parse(storage.get(RUN_KEY) as string) as Record<string, unknown>;
    payload.version = 99;
    storage.set(RUN_KEY, JSON.stringify(payload));

    expect(loadRun()).toBeNull();
  });

  it('un escenario inexistente se descarta', () => {
    const state = busyRun();
    saveRun(state);

    const payload = JSON.parse(storage.get(RUN_KEY) as string) as {
      state: Record<string, unknown>;
    };
    payload.state.scenarioId = 'un-mapa-que-ya-no-existe';
    storage.set(RUN_KEY, JSON.stringify(payload));

    expect(loadRun()).toBeNull();
  });

  it('una dificultad inexistente se descarta', () => {
    const state = busyRun();
    saveRun(state);

    const payload = JSON.parse(storage.get(RUN_KEY) as string) as {
      state: Record<string, unknown>;
    };
    payload.state.difficultyId = 'imposible';
    storage.set(RUN_KEY, JSON.stringify(payload));

    expect(loadRun()).toBeNull();
  });

  it('un contenido ilegible se descarta sin fallar', () => {
    storage.set(RUN_KEY, 'esto no es json {{{');
    expect(loadRun()).toBeNull();
  });

  it('una partida terminada no se guarda ni se reanuda', () => {
    const state = busyRun();
    saveRun(state);
    expect(loadRun()).not.toBeNull();

    // Una derrota posterior no debe sobrescribir con algo reanudable...
    state.screen = 'defeat';
    saveRun(state);
    expect(loadRun()!.screen).toBe('playing');

    // ...y un guardado manipulado a "derrota" tampoco se ofrece.
    const payload = JSON.parse(storage.get(RUN_KEY) as string) as {
      state: Record<string, unknown>;
    };
    payload.state.screen = 'defeat';
    storage.set(RUN_KEY, JSON.stringify(payload));
    expect(loadRun()).toBeNull();
  });

  it('un guardado en pausa sí se reanuda', () => {
    const state = busyRun();
    state.screen = 'paused';
    saveRun(state);

    expect(loadRun()?.screen).toBe('paused');
  });

  it('descartar deja el menú sin nada que continuar', () => {
    saveRun(busyRun());
    expect(loadRun()).not.toBeNull();

    clearRun();
    expect(loadRun()).toBeNull();
  });

  it('sin almacenamiento no revienta', () => {
    removeStorage();

    const state = busyRun();
    expect(() => saveRun(state)).not.toThrow();
    expect(loadRun()).toBeNull();
    expect(() => clearRun()).not.toThrow();
  });
});
