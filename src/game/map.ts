/**
 * El escenario: una rejilla de prado atravesada por un camino sinuoso.
 *
 * El camino se traza a mano como una lista de esquinas; de ahí se derivan
 * las celdas que ocupa (para saber dónde NO se puede construir) y una
 * polilínea de puntos de paso con longitudes acumuladas (para mover a los
 * enemigos con una posición continua).
 */

export const CELL = 64;
export const COLS = 20;
export const ROWS = 14;
export const MAP_WIDTH = COLS * CELL;
export const MAP_HEIGHT = ROWS * CELL;

export type Terrain = 'grass' | 'path' | 'spawn' | 'goal';

export interface Cell {
  col: number;
  row: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Esquinas del camino. Cada tramo entre dos esquinas consecutivas es
 * horizontal o vertical, nunca diagonal.
 */
const PATH_CORNERS: readonly Cell[] = [
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
];

function expandCorners(corners: readonly Cell[]): Cell[] {
  const cells: Cell[] = [];
  const push = (col: number, row: number): void => {
    const last = cells[cells.length - 1];
    if (last && last.col === col && last.row === row) return;
    cells.push({ col, row });
  };

  const first = corners[0];
  if (!first) throw new Error('El camino necesita al menos una esquina');
  push(first.col, first.row);

  for (let i = 1; i < corners.length; i += 1) {
    const from = corners[i - 1] as Cell;
    const to = corners[i] as Cell;
    if (from.col !== to.col && from.row !== to.row) {
      throw new Error(`Tramo diagonal no permitido entre ${i - 1} y ${i}`);
    }
    const stepCol = Math.sign(to.col - from.col);
    const stepRow = Math.sign(to.row - from.row);
    let { col, row } = from;
    while (col !== to.col || row !== to.row) {
      col += stepCol;
      row += stepRow;
      push(col, row);
    }
  }

  return cells;
}

/** Todas las celdas que ocupa el camino, en orden de recorrido. */
export const PATH_CELLS: readonly Cell[] = expandCorners(PATH_CORNERS);

export const SPAWN_CELL: Cell = PATH_CELLS[0] as Cell;
export const GOAL_CELL: Cell = PATH_CELLS[PATH_CELLS.length - 1] as Cell;

function buildTerrain(): Terrain[][] {
  const grid: Terrain[][] = [];
  for (let row = 0; row < ROWS; row += 1) {
    grid.push(new Array<Terrain>(COLS).fill('grass'));
  }
  for (const cell of PATH_CELLS) {
    const line = grid[cell.row];
    if (line) line[cell.col] = 'path';
  }
  const spawnLine = grid[SPAWN_CELL.row];
  if (spawnLine) spawnLine[SPAWN_CELL.col] = 'spawn';
  const goalLine = grid[GOAL_CELL.row];
  if (goalLine) goalLine[GOAL_CELL.col] = 'goal';
  return grid;
}

const TERRAIN: readonly Terrain[][] = buildTerrain();

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function terrainAt(col: number, row: number): Terrain | null {
  if (!inBounds(col, row)) return null;
  const line = TERRAIN[row];
  return line ? (line[col] ?? null) : null;
}

/** Una celda es construible si está dentro del mapa y es prado. */
export function isBuildableTerrain(col: number, row: number): boolean {
  return terrainAt(col, row) === 'grass';
}

export function cellCenter(col: number, row: number): Point {
  return { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL };
}

export function worldToCell(x: number, y: number): Cell {
  return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

/** Centros de las celdas del camino: la ruta que siguen los enemigos. */
export const WAYPOINTS: readonly Point[] = PATH_CELLS.map((cell) =>
  cellCenter(cell.col, cell.row),
);

function buildCumulativeLengths(points: readonly Point[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Point;
    const curr = points[i] as Point;
    const segment = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    cumulative.push((cumulative[i - 1] as number) + segment);
  }
  return cumulative;
}

const CUMULATIVE: readonly number[] = buildCumulativeLengths(WAYPOINTS);

/** Longitud total del recorrido, en píxeles de mundo. */
export const PATH_LENGTH: number = CUMULATIVE[CUMULATIVE.length - 1] as number;

/**
 * Posición en el recorrido para una distancia acumulada. Se satura en los
 * extremos, de modo que una distancia mayor que la total devuelve la meta.
 */
export function positionAtDistance(distance: number): Point {
  const first = WAYPOINTS[0] as Point;
  if (distance <= 0) return { x: first.x, y: first.y };
  if (distance >= PATH_LENGTH) {
    const last = WAYPOINTS[WAYPOINTS.length - 1] as Point;
    return { x: last.x, y: last.y };
  }

  // Búsqueda binaria del segmento que contiene la distancia.
  let low = 0;
  let high = CUMULATIVE.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((CUMULATIVE[mid] as number) <= distance) low = mid;
    else high = mid;
  }

  const from = WAYPOINTS[low] as Point;
  const to = WAYPOINTS[high] as Point;
  const segmentStart = CUMULATIVE[low] as number;
  const segmentLength = (CUMULATIVE[high] as number) - segmentStart;
  const t = segmentLength === 0 ? 0 : (distance - segmentStart) / segmentLength;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

/** Distancia acumulada hasta la celda de camino con ese índice. */
export function distanceAtPathIndex(index: number): number {
  const clamped = Math.min(Math.max(0, Math.floor(index)), CUMULATIVE.length - 1);
  return CUMULATIVE[clamped] as number;
}

/** Número de cambios de dirección del camino (sus "curvas"). */
export function countPathTurns(): number {
  let turns = 0;
  for (let i = 2; i < PATH_CELLS.length; i += 1) {
    const a = PATH_CELLS[i - 2] as Cell;
    const b = PATH_CELLS[i - 1] as Cell;
    const c = PATH_CELLS[i] as Cell;
    const dir1 = { col: b.col - a.col, row: b.row - a.row };
    const dir2 = { col: c.col - b.col, row: c.row - b.row };
    if (dir1.col !== dir2.col || dir1.row !== dir2.row) turns += 1;
  }
  return turns;
}
