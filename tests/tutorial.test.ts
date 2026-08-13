/**
 * Guía de primeros pasos.
 *
 * Lo que importa comprobar es que la guía **observa** y no dirige: que avanza
 * sola cuando el jugador hace las cosas, que se salta lo ya hecho, que
 * retrocede si el jugador deshace, y sobre todo que no toca la simulación.
 */

import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  currentTutorialStep,
  tutorialStepCount,
  tutorialStepNumber,
} from '../src/game/tutorial';
import { SPECIALISATION_LEVEL } from '../src/game/specialisations';
import {
  createGameState,
  placeTower,
  sellSelectedTower,
  specialiseSelectedTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { grassBesidePath, quietRun } from './helpers';
import { FIXED_DT, step } from '../src/game/step';

function freshRun() {
  const state = createGameState();
  startGame(state);
  quietRun(state);
  state.gold = 500_000;
  return state;
}

/** Coloca una torre junto al camino y la deja seleccionada. */
function buildTower(state: ReturnType<typeof freshRun>) {
  const { cell } = grassBesidePath(6);
  state.shopSelection = 'archer';
  expect(placeTower(state, cell.col, cell.row)).toBe(true);
  const tower = state.towers[0]!;
  state.selectedTowerId = tower.id;
  return tower;
}

describe('hud-controls: contenido de la guía', () => {
  it('cubre la cadena de construcción y todos los pasos tienen texto', () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(ids).toEqual(['pick', 'place', 'upgrade', 'specialise']);
    expect(tutorialStepCount()).toBe(TUTORIAL_STEPS.length);

    for (const step of TUTORIAL_STEPS) {
      expect(step.text.trim().length, step.id).toBeGreaterThan(0);
    }
  });
});

describe('hud-controls: avance de la guía', () => {
  it('empieza por el primer paso', () => {
    const state = freshRun();
    expect(currentTutorialStep(state)?.id).toBe('pick');
    expect(tutorialStepNumber(state)).toBe(1);
  });

  it('elegir una torre avanza a colocarla', () => {
    const state = freshRun();
    state.shopSelection = 'archer';
    expect(currentTutorialStep(state)?.id).toBe('place');
  });

  it('colocar avanza a mejorar', () => {
    const state = freshRun();
    const { cell } = grassBesidePath(6);
    state.shopSelection = 'archer';
    placeTower(state, cell.col, cell.row);

    expect(currentTutorialStep(state)?.id).toBe('upgrade');
  });

  it('ningún paso está cumplido de antemano en una partida nueva', () => {
    // Si alguno lo estuviera, la guía se lo saltaría y el jugador nunca vería
    // esa parte: es lo que pasaba con el paso de seleccionar, que colocar una
    // torre ya cumplía.
    const state = freshRun();
    for (const step of TUTORIAL_STEPS) {
      expect(step.done(state), step.id).toBe(false);
    }
  });

  it('mejorar avanza a especializar, y especializar la termina', () => {
    const state = freshRun();
    const tower = buildTower(state);

    upgradeSelectedTower(state);
    expect(currentTutorialStep(state)?.id).toBe('specialise');

    while (tower.level < SPECIALISATION_LEVEL) upgradeSelectedTower(state);
    specialiseSelectedTower(state, 'archer-needle');

    expect(currentTutorialStep(state)).toBeNull();
    expect(tutorialStepNumber(state)).toBe(0);
  });

  it('un paso ya cumplido no se pide', () => {
    const state = freshRun();
    // Coloca sin haber "elegido" antes según la guía: el paso de elegir queda
    // cumplido por tener ya una torre, así que no se le vuelve a pedir.
    const { cell } = grassBesidePath(6);
    state.shopSelection = 'archer';
    placeTower(state, cell.col, cell.row);
    state.shopSelection = null;

    const current = currentTutorialStep(state);
    expect(current?.id).not.toBe('pick');
    expect(current?.id).not.toBe('place');
  });

  it('retrocede si el jugador deshace', () => {
    const state = freshRun();
    buildTower(state);
    upgradeSelectedTower(state);
    expect(currentTutorialStep(state)?.id).toBe('specialise');

    // Vende la única torre: la guía vuelve a pedir que coloque una en vez de
    // quedarse pidiendo que especialice algo que ya no existe.
    expect(sellSelectedTower(state)).toBe(true);
    expect(state.towers).toHaveLength(0);
    expect(currentTutorialStep(state)?.id).toBe('place');
  });
});

describe('hud-controls: la guía no dirige', () => {
  it('consultarla no altera el estado de la partida', () => {
    const state = freshRun();
    buildTower(state);

    const snapshot = JSON.stringify(state);
    for (let i = 0; i < 20; i += 1) currentTutorialStep(state);

    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('dos partidas idénticas avanzan igual se consulte o no', () => {
    const withGuide = createGameState();
    const without = createGameState();
    startGame(withGuide);
    startGame(without);

    for (let i = 0; i < 600; i += 1) {
      step(withGuide, FIXED_DT);
      // Solo en una de las dos se consulta la guía en cada paso.
      currentTutorialStep(withGuide);
      step(without, FIXED_DT);
    }

    expect(withGuide.lives).toBe(without.lives);
    expect(withGuide.gold).toBe(without.gold);
    expect(withGuide.waveIndex).toBe(without.waveIndex);
    expect(withGuide.enemies.length).toBe(without.enemies.length);
  });
});
