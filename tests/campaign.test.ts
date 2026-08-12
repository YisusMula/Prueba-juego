/**
 * Campaña: estrellas y desbloqueo.
 *
 * Todo el progreso se deriva de los récords, así que los tests trabajan sobre
 * récords construidos a mano y comprueban las consultas puras.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_STARS_PER_SCENARIO,
  isScenarioUnlocked,
  maxStars,
  newlyUnlocked,
  starsFor,
  totalStars,
  unlockRequirement,
} from '../src/game/campaign';
import { FINAL_WAVE } from '../src/game/difficulty';
import { SCENARIO_LIST, type ScenarioId } from '../src/game/scenarios';
import { createGameState, startGame } from '../src/game/state';
import {
  type Records,
  emptyRecords,
  recordFor,
  recordRun,
} from '../src/storage/records';

const [FIRST, SECOND, THIRD] = SCENARIO_LIST.map((scene) => scene.id) as [
  ScenarioId,
  ScenarioId,
  ScenarioId,
];

/** Récords con una victoria registrada en esa combinación. */
function won(
  records: Records,
  scenarioId: ScenarioId,
  difficultyId: 'easy' | 'normal' | 'hard',
): Records {
  return recordRun(records, scenarioId, difficultyId, FINAL_WAVE, 500, true).records;
}

describe('run-progression: estrellas', () => {
  it('sin victorias no hay estrellas', () => {
    const records = emptyRecords();
    for (const scene of SCENARIO_LIST) expect(starsFor(records, scene.id)).toBe(0);
    expect(totalStars(records)).toBe(0);
  });

  it('cada dificultad concede sus estrellas', () => {
    expect(starsFor(won(emptyRecords(), FIRST, 'easy'), FIRST)).toBe(1);
    expect(starsFor(won(emptyRecords(), FIRST, 'normal'), FIRST)).toBe(2);
    expect(starsFor(won(emptyRecords(), FIRST, 'hard'), FIRST)).toBe(3);
  });

  it('cuenta la dificultad más alta ganada, no la suma', () => {
    let records = won(emptyRecords(), FIRST, 'easy');
    records = won(records, FIRST, 'normal');
    // Dos victorias, pero la más alta es Normal: dos estrellas, no tres.
    expect(starsFor(records, FIRST)).toBe(2);
  });

  it('llegar a la oleada final sin ganar no da estrellas', () => {
    // Es el caso real del simulador: en Difícil muere justo en la oleada 30.
    const records = recordRun(emptyRecords(), FIRST, 'hard', FINAL_WAVE, 800, false).records;

    expect(recordFor(records, FIRST, 'hard').bestWave).toBe(FINAL_WAVE);
    expect(starsFor(records, FIRST)).toBe(0);
  });

  it('una partida posterior peor no quita estrellas', () => {
    let records = won(emptyRecords(), FIRST, 'hard');
    records = recordRun(records, FIRST, 'hard', 4, 10, false).records;

    expect(starsFor(records, FIRST)).toBe(MAX_STARS_PER_SCENARIO);
    expect(recordFor(records, FIRST, 'hard').won).toBe(true);
  });

  it('las estrellas son independientes por escenario', () => {
    const records = won(emptyRecords(), FIRST, 'hard');

    expect(starsFor(records, FIRST)).toBe(3);
    expect(starsFor(records, SECOND)).toBe(0);
  });

  it('el total suma las de cada escenario y el máximo son tres por escenario', () => {
    let records = won(emptyRecords(), FIRST, 'normal');
    records = won(records, SECOND, 'hard');

    expect(totalStars(records)).toBe(5);
    expect(maxStars()).toBe(SCENARIO_LIST.length * MAX_STARS_PER_SCENARIO);
  });
});

describe('run-progression: desbloqueo', () => {
  it('el primero está siempre abierto y el resto empieza bloqueado', () => {
    const records = emptyRecords();

    expect(isScenarioUnlocked(records, FIRST)).toBe(true);
    expect(isScenarioUnlocked(records, SECOND)).toBe(false);
    expect(isScenarioUnlocked(records, THIRD)).toBe(false);
  });

  it('ganar abre el siguiente, sin saltarse ninguno', () => {
    const records = won(emptyRecords(), FIRST, 'easy');

    expect(isScenarioUnlocked(records, SECOND)).toBe(true);
    expect(isScenarioUnlocked(records, THIRD)).toBe(false);
  });

  it('perder no abre nada', () => {
    const records = recordRun(emptyRecords(), FIRST, 'normal', 22, 300, false).records;
    expect(isScenarioUnlocked(records, SECOND)).toBe(false);
  });

  it('el bloqueado dice qué hace falta para abrirlo', () => {
    const records = emptyRecords();
    const requirement = unlockRequirement(records, SECOND);

    expect(requirement?.name).toBe(SCENARIO_LIST[0]!.name);
    expect(unlockRequirement(records, FIRST)).toBeNull();
  });

  it('detecta qué escenario acaba de abrirse', () => {
    const before = emptyRecords();
    const after = won(before, FIRST, 'easy');

    expect(newlyUnlocked(before, after)?.name).toBe(SCENARIO_LIST[1]!.name);
    // Volver a ganar lo mismo no abre nada nuevo.
    expect(newlyUnlocked(after, won(after, FIRST, 'hard'))).toBeNull();
  });

  it('un escenario bloqueado no empieza partida', () => {
    const state = createGameState();

    expect(startGame(state, 'normal', THIRD, false)).toBe(false);
    expect(state.screen).toBe('menu');

    expect(startGame(state, 'normal', FIRST, true)).toBe(true);
    expect(state.screen).toBe('playing');
    expect(state.scenarioId).toBe(FIRST);
  });
});

describe('run-progression: victoria registrada', () => {
  it('la victoria queda marcada y una derrota posterior no la borra', () => {
    let records = won(emptyRecords(), SECOND, 'normal');
    expect(recordFor(records, SECOND, 'normal').won).toBe(true);

    records = recordRun(records, SECOND, 'normal', 3, 5, false).records;
    expect(recordFor(records, SECOND, 'normal').won).toBe(true);
  });

  it('una derrota sola no marca la victoria', () => {
    const records = recordRun(emptyRecords(), SECOND, 'normal', 12, 90, false).records;
    expect(recordFor(records, SECOND, 'normal').won).toBe(false);
  });

  it('la victoria es independiente por dificultad', () => {
    const records = won(emptyRecords(), FIRST, 'easy');

    expect(recordFor(records, FIRST, 'easy').won).toBe(true);
    expect(recordFor(records, FIRST, 'normal').won).toBe(false);
  });
});
