/**
 * Catálogo de escenarios.
 *
 * Un escenario es un conjunto de **rutas**, y una ruta es un recorrido completo
 * de entrada a meta. Con ese único concepto salen las tres formas que interesan
 * sin código especial para ninguna:
 *
 * - un camino          → una ruta;
 * - una bifurcación    → dos rutas que comparten cabeza y cola;
 * - dos entradas       → dos rutas con origen distinto.
 *
 * Todo lo derivado (celdas, terreno, polilíneas, longitudes acumuladas) se
 * calcula una vez al cargar el módulo y se guarda en el propio escenario, de
 * modo que consultarlo durante la partida sea una lectura de tabla.
 */

import {
  COLS,
  type Cell,
  type Point,
  ROWS,
  type Terrain,
  cellCenter,
  cumulativeLengths,
  expandCorners,
  inBounds,
} from './map';

export type ScenarioId = 'meadow' | 'crossroads' | 'gates';

/** Una ruta ya expandida, con todo lo necesario para mover enemigos por ella. */
export interface Route {
  cells: readonly Cell[];
  waypoints: readonly Point[];
  cumulative: readonly number[];
  length: number;
  spawn: Cell;
  goal: Cell;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  /** Frase corta para la pantalla de selección. */
  blurb: string;
  routes: readonly Route[];
  /** Unión de las celdas de todas las rutas: por aquí no se puede construir. */
  pathCells: readonly Cell[];
  terrain: readonly Terrain[][];
  spawnCells: readonly Cell[];
  goalCells: readonly Cell[];
}

interface ScenarioDef {
  id: ScenarioId;
  name: string;
  blurb: string;
  /** Una lista de esquinas por ruta. */
  routes: readonly (readonly Cell[])[];
}

const DEFINITIONS: readonly ScenarioDef[] = [
  {
    id: 'meadow',
    name: 'Prado del Molino',
    blurb: 'Un solo carril, muchas curvas. El sitio donde aprender.',
    routes: [
      [
        { col: 0, row: 2 },
        { col: 5, row: 2 },
        { col: 5, row: 6 },
        { col: 2, row: 6 },
        { col: 2, row: 11 },
        { col: 9, row: 11 },
        { col: 9, row: 4 },
        { col: 14, row: 4 },
        { col: 14, row: 9 },
        { col: 17, row: 9 },
        { col: 17, row: 1 },
        { col: 19, row: 1 },
      ],
    ],
  },
  {
    id: 'crossroads',
    name: 'Cruce de los Cuervos',
    blurb: 'El camino se parte en dos y se vuelve a juntar. Cubrir un ramal no basta.',
    routes: [
      // Tramo común de entrada, la bifurcación, y tramo común de salida.
      //
      // Las dos ramas miden lo mismo a propósito: si una fuera más corta, todo
      // el mundo defendería solo esa y la bifurcación dejaría de ser una
      // decisión. El tramo común es largo para que el mapa dé tiempo de
      // reacción parecido al de un carril único.
      // Rama norte.
      [
        { col: 0, row: 2 },
        { col: 4, row: 2 },
        { col: 4, row: 5 },
        { col: 1, row: 5 },
        { col: 1, row: 9 },
        { col: 5, row: 9 },
        { col: 5, row: 7 },
        { col: 7, row: 7 },
        { col: 7, row: 3 },
        { col: 12, row: 3 },
        { col: 12, row: 7 },
        { col: 15, row: 7 },
        { col: 15, row: 4 },
        { col: 19, row: 4 },
      ],
      // Rama sur.
      [
        { col: 0, row: 2 },
        { col: 4, row: 2 },
        { col: 4, row: 5 },
        { col: 1, row: 5 },
        { col: 1, row: 9 },
        { col: 5, row: 9 },
        { col: 5, row: 7 },
        { col: 7, row: 7 },
        { col: 7, row: 11 },
        { col: 12, row: 11 },
        { col: 12, row: 7 },
        { col: 15, row: 7 },
        { col: 15, row: 4 },
        { col: 19, row: 4 },
      ],
    ],
  },
  {
    id: 'gates',
    name: 'Los Dos Portones',
    blurb: 'Dos entradas opuestas hacia la misma meta. Hay que repartir el oro.',
    routes: [
      // Portón norte. Los dos recorridos serpentean por su mitad del mapa y
      // solo se juntan en el tramo final: si fueran cortos y rectos, cada
      // enemigo pasaría muy poco tiempo bajo fuego y el mapa sería injusto.
      [
        { col: 0, row: 1 },
        { col: 6, row: 1 },
        { col: 6, row: 4 },
        { col: 2, row: 4 },
        { col: 2, row: 6 },
        { col: 11, row: 6 },
        { col: 11, row: 2 },
        { col: 15, row: 2 },
        { col: 15, row: 7 },
        { col: 19, row: 7 },
      ],
      // Portón sur.
      [
        { col: 0, row: 12 },
        { col: 6, row: 12 },
        { col: 6, row: 8 },
        { col: 2, row: 8 },
        { col: 2, row: 11 },
        { col: 11, row: 11 },
        { col: 11, row: 8 },
        { col: 16, row: 8 },
        { col: 16, row: 7 },
        { col: 19, row: 7 },
      ],
    ],
  },
];

function buildRoute(corners: readonly Cell[]): Route {
  const cells = expandCorners(corners);
  for (const cell of cells) {
    if (!inBounds(cell.col, cell.row)) {
      throw new Error(`La ruta se sale del mapa en ${cell.col},${cell.row}`);
    }
  }
  const waypoints = cells.map((cell) => cellCenter(cell.col, cell.row));
  const cumulative = cumulativeLengths(waypoints);
  return {
    cells,
    waypoints,
    cumulative,
    length: cumulative[cumulative.length - 1] as number,
    spawn: cells[0] as Cell,
    goal: cells[cells.length - 1] as Cell,
  };
}

function buildScenario(def: ScenarioDef): Scenario {
  const routes = def.routes.map(buildRoute);

  // El terreno es la unión de las rutas: una celda es camino si la pisa
  // cualquiera de ellas, así que el tramo compartido de una bifurcación queda
  // marcado una sola vez y sin ninguna regla aparte.
  const terrain: Terrain[][] = [];
  for (let row = 0; row < ROWS; row += 1) {
    terrain.push(new Array<Terrain>(COLS).fill('grass'));
  }

  const pathCells: Cell[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    for (const cell of route.cells) {
      const line = terrain[cell.row];
      if (line) line[cell.col] = 'path';
      const key = `${cell.col},${cell.row}`;
      if (!seen.has(key)) {
        seen.add(key);
        pathCells.push(cell);
      }
    }
  }

  const spawnCells: Cell[] = [];
  const goalCells: Cell[] = [];
  const mark = (cell: Cell, kind: 'spawn' | 'goal', into: Cell[]): void => {
    const line = terrain[cell.row];
    if (line) line[cell.col] = kind;
    if (!into.some((other) => other.col === cell.col && other.row === cell.row)) into.push(cell);
  };
  for (const route of routes) mark(route.spawn, 'spawn', spawnCells);
  for (const route of routes) mark(route.goal, 'goal', goalCells);

  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    routes,
    pathCells,
    terrain,
    spawnCells,
    goalCells,
  };
}

const BY_ID = new Map<ScenarioId, Scenario>(
  DEFINITIONS.map((def) => [def.id, buildScenario(def)] as const),
);

export const SCENARIO_LIST: readonly Scenario[] = DEFINITIONS.map(
  (def) => BY_ID.get(def.id) as Scenario,
);

export const DEFAULT_SCENARIO: ScenarioId = 'meadow';

export function scenario(id: ScenarioId): Scenario {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_SCENARIO) as Scenario);
}

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === 'string' && BY_ID.has(value as ScenarioId);
}

/**
 * Ruta que le toca a un enemigo. Determinista a propósito: la simulación no usa
 * azar en ninguna parte, y así dos partidas idénticas se desarrollan igual.
 * Alternar por identificador reparte a partes iguales y hace visible la
 * bifurcación desde el primer par de enemigos.
 */
export function routeIndexFor(scene: Scenario, enemyId: number): number {
  return Math.abs(Math.floor(enemyId)) % scene.routes.length;
}

export function routeOf(scene: Scenario, index: number): Route {
  return scene.routes[Math.min(Math.max(0, index), scene.routes.length - 1)] as Route;
}

export function terrainAt(scene: Scenario, col: number, row: number): Terrain | null {
  if (!inBounds(col, row)) return null;
  const line = scene.terrain[row];
  return line ? (line[col] ?? null) : null;
}

/** Una celda es construible si está dentro del mapa y es prado. */
export function isBuildableTerrain(scene: Scenario, col: number, row: number): boolean {
  return terrainAt(scene, col, row) === 'grass';
}

/**
 * Posición sobre una ruta para una distancia recorrida. Se satura en los
 * extremos, de modo que una distancia mayor que la total devuelve la meta.
 */
export function positionAtDistance(route: Route, distance: number): Point {
  const first = route.waypoints[0] as Point;
  if (distance <= 0) return { x: first.x, y: first.y };
  if (distance >= route.length) {
    const last = route.waypoints[route.waypoints.length - 1] as Point;
    return { x: last.x, y: last.y };
  }

  // Búsqueda binaria del segmento que contiene la distancia.
  let low = 0;
  let high = route.cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((route.cumulative[mid] as number) <= distance) low = mid;
    else high = mid;
  }

  const from = route.waypoints[low] as Point;
  const to = route.waypoints[high] as Point;
  const segmentStart = route.cumulative[low] as number;
  const segmentLength = (route.cumulative[high] as number) - segmentStart;
  const t = segmentLength === 0 ? 0 : (distance - segmentStart) / segmentLength;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Distancia acumulada hasta la celda de la ruta con ese índice. */
export function distanceAtRouteIndex(route: Route, index: number): number {
  const clamped = Math.min(Math.max(0, Math.floor(index)), route.cumulative.length - 1);
  return route.cumulative[clamped] as number;
}
