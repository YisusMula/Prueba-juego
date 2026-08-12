/**
 * Geometría de la rejilla. Primitivas sin conocimiento de ningún escenario
 * concreto: el trazado de cada mapa vive en `scenarios.ts`, que construye sus
 * tablas a partir de lo que hay aquí.
 *
 * Todos los escenarios comparten la misma rejilla. Mantenerla fija deja la
 * cámara, el encuadre inicial y el lienzo iguales en todos los mapas, que es
 * justo lo que el jugador espera al cambiar de escenario.
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

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function cellCenter(col: number, row: number): Point {
  return { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL };
}

export function worldToCell(x: number, y: number): Cell {
  return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

/**
 * Convierte una lista de esquinas en la lista de celdas que recorre. Cada
 * tramo entre dos esquinas consecutivas es horizontal o vertical, nunca
 * diagonal.
 */
export function expandCorners(corners: readonly Cell[]): Cell[] {
  const cells: Cell[] = [];
  const push = (col: number, row: number): void => {
    const last = cells[cells.length - 1];
    if (last && last.col === col && last.row === row) return;
    cells.push({ col, row });
  };

  const first = corners[0];
  if (!first) throw new Error('Una ruta necesita al menos una esquina');
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

/** Longitudes acumuladas a lo largo de una polilínea. */
export function cumulativeLengths(points: readonly Point[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Point;
    const curr = points[i] as Point;
    cumulative.push((cumulative[i - 1] as number) + Math.hypot(curr.x - prev.x, curr.y - prev.y));
  }
  return cumulative;
}

/** Número de cambios de dirección de un recorrido de celdas. */
export function countTurns(cells: readonly Cell[]): number {
  let turns = 0;
  for (let i = 2; i < cells.length; i += 1) {
    const a = cells[i - 2] as Cell;
    const b = cells[i - 1] as Cell;
    const c = cells[i] as Cell;
    if (b.col - a.col !== c.col - b.col || b.row - a.row !== c.row - b.row) turns += 1;
  }
  return turns;
}
