/**
 * Pruebas de balance: simulan partidas completas sin navegador para que un
 * ajuste de números no deje el juego trivial ni imposible.
 */

import { describe, expect, it } from 'vitest';
import {
  type GameState,
  createGameState,
  displayedWave,
  placeTower,
  repairSelectedTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { FIXED_DT, step } from '../src/game/step';
import { PATH_CELLS, isBuildableTerrain } from '../src/game/map';
import { TOWER_TYPE_LIST, effectiveDps } from '../src/game/towers';

/** Celdas de prado pegadas al camino, en orden de recorrido. */
function spotsAlongPath(): { col: number; row: number }[] {
  const spots: { col: number; row: number }[] = [];
  const seen = new Set<string>();

  for (let i = 2; i < PATH_CELLS.length; i += 1) {
    const cell = PATH_CELLS[i] as { col: number; row: number };
    const around = [
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col - 1, row: cell.row },
      { col: cell.col + 1, row: cell.row },
    ];
    for (const candidate of around) {
      const key = `${candidate.col},${candidate.row}`;
      if (seen.has(key) || !isBuildableTerrain(candidate.col, candidate.row)) continue;
      seen.add(key);
      spots.push(candidate);
    }
  }

  return spots;
}

interface Outcome {
  screen: GameState['screen'];
  wave: number;
  lives: number;
}

/**
 * Jugador automático: coloca torres junto al camino hasta su tope y luego
 * invierte el oro en mejoras.
 */
function autoPlay(options: { maxTowers: number; stopAtWave: number }): Outcome {
  const state = createGameState();
  startGame(state);
  const spots = spotsAlongPath();

  let spotIndex = 0;
  let ticks = 0;
  const maxTicks = 60 * 60 * 60; // una hora de juego simulada

  while (state.screen === 'playing' && state.waveIndex <= options.stopAtWave && ticks < maxTicks) {
    step(state, FIXED_DT);
    ticks += 1;
    if (ticks % 30 !== 0) continue;

    // Un jugador atento repara una torre inutilizada antes que cualquier otra cosa.
    const disabled = state.towers.find((tower) => tower.hp <= 0);
    if (disabled) {
      state.selectedTowerId = disabled.id;
      repairSelectedTower(state);
      state.selectedTowerId = null;
      continue;
    }

    // Entre las que puede pagar, la de mayor daño por segundo: nadie abre la
    // partida gastando todo el oro en la torre de hielo por ser "la más cara".
    const affordable = TOWER_TYPE_LIST.filter((type) => state.gold >= type.cost);
    const best = affordable.reduce<(typeof affordable)[number] | undefined>(
      (top, type) => (!top || effectiveDps(type) > effectiveDps(top) ? type : top),
      undefined,
    );
    if (best && spotIndex < spots.length && state.towers.length < options.maxTowers) {
      state.shopSelection = best.id;
      const spot = spots[spotIndex] as { col: number; row: number };
      if (placeTower(state, spot.col, spot.row)) spotIndex += 1;
      state.shopSelection = null;
      continue;
    }

    if (state.towers.length > 0) {
      const tower = state.towers[ticks % state.towers.length];
      if (tower) {
        state.selectedTowerId = tower.id;
        upgradeSelectedTower(state);
        state.selectedTowerId = null;
      }
    }
  }

  return { screen: state.screen, wave: displayedWave(state), lives: state.lives };
}

describe('balance de la partida', () => {
  it('quien no construye nada pierde pronto', () => {
    const state = createGameState();
    startGame(state);

    let ticks = 0;
    while (state.screen === 'playing' && ticks < 60 * 60 * 10) {
      step(state, FIXED_DT);
      ticks += 1;
    }

    expect(state.screen).toBe('defeat');
    expect(displayedWave(state)).toBeLessThanOrEqual(5);
  });

  it('un jugador modesto aguanta las primeras oleadas', () => {
    const outcome = autoPlay({ maxTowers: 8, stopAtWave: 10 });
    expect(outcome.screen).toBe('playing');
    expect(outcome.lives).toBeGreaterThan(10);
  });

  // Simula cerca de 40 minutos de partida: necesita más margen que el resto.
  it(
    'el juego termina cayendo aunque se llene el mapa de torres',
    () => {
      const outcome = autoPlay({ maxTowers: 999, stopAtWave: 45 });
      expect(outcome.screen).toBe('defeat');
      expect(outcome.wave).toBeGreaterThan(20);
    },
    30_000,
  );
});
