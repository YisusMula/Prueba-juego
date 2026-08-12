/**
 * Pruebas de balance: simulan partidas completas sin navegador para que un
 * ajuste de números no deje el juego trivial ni imposible.
 *
 * El jugador automático imita lo que hace uno real: repara lo que se rompe,
 * compra la torre de más daño por segundo que puede pagar, **concentra** las
 * mejoras en sus puestos en vez de repartirlas a voleo, y gasta las
 * habilidades cuando hay enemigos agrupados.
 */

import { describe, expect, it } from 'vitest';
import {
  type GameState,
  castAbility,
  createGameState,
  displayedWave,
  isAbilityReady,
  placeTower,
  repairSelectedTower,
  startGame,
  upgradeSelectedTower,
} from '../src/game/state';
import { FIXED_DT, step } from '../src/game/step';
import {
  DEFAULT_SCENARIO,
  SCENARIO_LIST,
  type Scenario,
  type ScenarioId,
  isBuildableTerrain,
  scenario,
} from '../src/game/scenarios';
import { TOWER_MAX_LEVEL, TOWER_TYPE_LIST, effectiveDps } from '../src/game/towers';
import { type DifficultyId, FINAL_WAVE } from '../src/game/difficulty';

/**
 * Celdas de prado pegadas al camino, en orden de recorrido.
 *
 * Con varias rutas se **intercalan**: un jugador real que ve el camino
 * partirse reparte sus torres entre las ramas en vez de vaciar una y empezar
 * la otra. Recorrer las rutas en serie dejaría un ramal indefenso y mediría el
 * despiste del robot, no el balance del escenario.
 */
function spotsAlongPath(scene: Scenario): { col: number; row: number }[] {
  const seen = new Set<string>();
  const perRoute = scene.routes.map((route) => {
    const spots: { col: number; row: number }[] = [];
    for (let i = 2; i < route.cells.length; i += 1) {
      const cell = route.cells[i] as { col: number; row: number };
      const around = [
        { col: cell.col, row: cell.row - 1 },
        { col: cell.col, row: cell.row + 1 },
        { col: cell.col - 1, row: cell.row },
        { col: cell.col + 1, row: cell.row },
      ];
      for (const candidate of around) {
        const key = `${candidate.col},${candidate.row}`;
        if (seen.has(key) || !isBuildableTerrain(scene, candidate.col, candidate.row)) continue;
        seen.add(key);
        spots.push(candidate);
      }
    }
    return spots;
  });

  const interleaved: { col: number; row: number }[] = [];
  const longest = Math.max(0, ...perRoute.map((spots) => spots.length));
  for (let i = 0; i < longest; i += 1) {
    for (const spots of perRoute) {
      const spot = spots[i];
      if (spot) interleaved.push(spot);
    }
  }
  return interleaved;
}

interface Outcome {
  screen: GameState['screen'];
  wave: number;
  lives: number;
  /** Oro sin gastar al terminar: delata una economía que se desborda. */
  gold: number;
  /** Máximo de oro que ha llegado a acumular en toda la partida. */
  peakGold: number;
}

interface PlayOptions {
  difficultyId?: DifficultyId;
  scenarioId?: ScenarioId;
  maxTowers?: number;
  stopAtWave?: number;
}

function autoPlay(options: PlayOptions = {}): Outcome {
  const {
    difficultyId = 'normal',
    scenarioId = DEFAULT_SCENARIO,
    maxTowers = 999,
    stopAtWave = FINAL_WAVE,
  } = options;

  const state = createGameState(difficultyId, scenarioId);
  startGame(state);
  const spots = spotsAlongPath(scenario(scenarioId));

  let spotIndex = 0;
  let ticks = 0;
  let peakGold = state.gold;
  const maxTicks = 60 * 60 * 90; // hora y media de juego simulada

  while (state.screen === 'playing' && state.waveIndex <= stopAtWave && ticks < maxTicks) {
    step(state, FIXED_DT);
    ticks += 1;
    peakGold = Math.max(peakGold, state.gold);
    if (ticks % 30 !== 0) continue;

    // Con enemigos agrupados, un jugador atento gasta sus habilidades.
    if (state.enemies.length >= 6) {
      if (isAbilityReady(state, 'meteor')) {
        const target = state.enemies[Math.floor(state.enemies.length / 2)];
        if (target) castAbility(state, 'meteor', target.x, target.y);
      } else if (isAbilityReady(state, 'blizzard') && state.enemies.length >= 12) {
        castAbility(state, 'blizzard');
      }
    }

    // Reparar una torre inutilizada va antes que cualquier otra compra.
    const broken = state.towers.find((tower) => tower.hp <= 0);
    if (broken) {
      state.selectedTowerId = broken.id;
      repairSelectedTower(state);
      state.selectedTowerId = null;
      continue;
    }

    const affordable = TOWER_TYPE_LIST.filter((type) => state.gold >= type.cost);
    const best = affordable.reduce<(typeof affordable)[number] | undefined>(
      (top, type) => (!top || effectiveDps(type) > effectiveDps(top) ? type : top),
      undefined,
    );
    if (best && spotIndex < spots.length && state.towers.length < maxTowers) {
      state.shopSelection = best.id;
      const spot = spots[spotIndex] as { col: number; row: number };
      if (placeTower(state, spot.col, spot.row)) spotIndex += 1;
      state.shopSelection = null;
      continue;
    }

    // Concentrar las mejoras en los puestos ya montados rinde mucho más que
    // repartirlas por todo el mapa, y es lo que haría un jugador real.
    const target = state.towers.find((tower) => tower.level < TOWER_MAX_LEVEL);
    if (target) {
      state.selectedTowerId = target.id;
      upgradeSelectedTower(state);
      state.selectedTowerId = null;
    }
  }

  return {
    screen: state.screen,
    wave: displayedWave(state),
    lives: state.lives,
    gold: state.gold,
    peakGold,
  };
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
    expect(displayedWave(state)).toBeLessThanOrEqual(6);
  });

  it('un jugador modesto aguanta las primeras oleadas', () => {
    const outcome = autoPlay({ maxTowers: 8, stopAtWave: 10 });
    expect(outcome.screen).toBe('playing');
    expect(outcome.lives).toBeGreaterThan(10);
  });

  it(
    'en Normal se puede ganar jugando bien',
    () => {
      const outcome = autoPlay({ difficultyId: 'normal', maxTowers: 20 });
      expect(outcome.screen).toBe('victory');
      expect(outcome.wave).toBe(FINAL_WAVE);
    },
    60_000,
  );

  it(
    'en Fácil se gana con margen de sobra',
    () => {
      const outcome = autoPlay({ difficultyId: 'easy', maxTowers: 20 });
      expect(outcome.screen).toBe('victory');
      // La dificultad fácil debe perdonar errores: se llega con vidas de sobra.
      expect(outcome.lives).toBeGreaterThan(20);
    },
    60_000,
  );

  it(
    'en Difícil no basta con la misma estrategia',
    () => {
      const easy = autoPlay({ difficultyId: 'easy', maxTowers: 20 });
      const hard = autoPlay({ difficultyId: 'hard', maxTowers: 20 });

      // La dificultad tiene que notarse de verdad, no ser un adorno.
      expect(hard.wave).toBeLessThan(easy.wave);
      expect(hard.screen).toBe('defeat');
    },
    90_000,
  );

  it(
    'cada escenario se puede ganar en Normal',
    () => {
      for (const scene of SCENARIO_LIST) {
        // El tope de torres se reparte por ruta: cubrir dos carriles exige
        // más puestos que cubrir uno, y con el mismo tope el robot dejaría
        // media defensa por ramal midiendo el tope, no el escenario.
        const outcome = autoPlay({ scenarioId: scene.id, maxTowers: 20 * scene.routes.length });
        expect(outcome.screen, `${scene.name} no se puede ganar`).toBe('victory');
      }
    },
    180_000,
  );

  it(
    'el oro no se desborda: siempre queda dónde gastarlo',
    () => {
      // El problema que motivó esta iteración era acumular oro sin uso en
      // oleadas avanzadas. Con la reparación y los 8 niveles de mejora, una
      // partida bien jugada debe terminar sin un excedente desmedido.
      const outcome = autoPlay({ difficultyId: 'normal' });
      expect(outcome.gold).toBeLessThan(5000);
      expect(outcome.peakGold).toBeLessThan(8000);
    },
    60_000,
  );
});
