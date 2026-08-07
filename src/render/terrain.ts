/**
 * Terreno precocinado: el prado, el camino y su decoración no cambian nunca,
 * así que se pintan una sola vez en un canvas fuera de pantalla y en cada
 * frame solo se compone la imagen resultante.
 */

import {
  CELL,
  COLS,
  GOAL_CELL,
  MAP_HEIGHT,
  MAP_WIDTH,
  ROWS,
  SPAWN_CELL,
  WAYPOINTS,
  cellCenter,
  terrainAt,
} from '../game/map';

/** Generador pseudoaleatorio determinista: el prado siempre se ve igual. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATH_WIDTH = CELL * 0.86;

function paintGrass(ctx: CanvasRenderingContext2D, random: () => number): void {
  const base = ctx.createLinearGradient(0, 0, MAP_WIDTH * 0.4, MAP_HEIGHT);
  base.addColorStop(0, '#63a844');
  base.addColorStop(0.5, '#569a3c');
  base.addColorStop(1, '#458a34');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // Manchas suaves de hierba más clara y más oscura.
  for (let i = 0; i < 260; i += 1) {
    const x = random() * MAP_WIDTH;
    const y = random() * MAP_HEIGHT;
    const radius = 30 + random() * 90;
    const lighter = random() > 0.45;
    ctx.fillStyle = lighter ? 'rgba(140, 200, 96, 0.16)' : 'rgba(46, 108, 44, 0.14)';
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.5 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Matas de hierba.
  ctx.lineCap = 'round';
  for (let i = 0; i < 1800; i += 1) {
    const x = random() * MAP_WIDTH;
    const y = random() * MAP_HEIGHT;
    const height = 4 + random() * 6;
    ctx.strokeStyle = random() > 0.5 ? 'rgba(120, 190, 84, 0.55)' : 'rgba(58, 122, 48, 0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (random() - 0.5) * 5, y - height * 0.6, x + (random() - 0.5) * 7, y - height);
    ctx.stroke();
  }
}

function tracePath(ctx: CanvasRenderingContext2D): void {
  const first = WAYPOINTS[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < WAYPOINTS.length; i += 1) {
    const point = WAYPOINTS[i];
    if (point) ctx.lineTo(point.x, point.y);
  }
}

function paintPath(ctx: CanvasRenderingContext2D, random: () => number): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Sombra bajo el camino, para que parezca hundido en la hierba.
  ctx.strokeStyle = 'rgba(30, 62, 26, 0.35)';
  ctx.lineWidth = PATH_WIDTH + 12;
  tracePath(ctx);
  ctx.stroke();

  // Borde de tierra oscura.
  ctx.strokeStyle = '#8a6435';
  ctx.lineWidth = PATH_WIDTH + 4;
  tracePath(ctx);
  ctx.stroke();

  // Tierra del camino.
  ctx.strokeStyle = '#c39a63';
  ctx.lineWidth = PATH_WIDTH;
  tracePath(ctx);
  ctx.stroke();

  // Rodadas más claras en el centro.
  ctx.strokeStyle = 'rgba(224, 197, 152, 0.5)';
  ctx.lineWidth = PATH_WIDTH * 0.42;
  tracePath(ctx);
  ctx.stroke();

  // Guijarros, solo sobre celdas de camino.
  for (let i = 0; i < 900; i += 1) {
    const x = random() * MAP_WIDTH;
    const y = random() * MAP_HEIGHT;
    const cell = { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
    const terrain = terrainAt(cell.col, cell.row);
    if (terrain !== 'path' && terrain !== 'spawn' && terrain !== 'goal') continue;
    ctx.fillStyle = random() > 0.5 ? 'rgba(146, 108, 62, 0.5)' : 'rgba(232, 210, 172, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + random() * 3, 1.2 + random() * 2, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.strokeStyle = 'rgba(52, 110, 44, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.fillStyle = color;
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * 2.4, y + Math.sin(angle) * 2.4, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f7e06a';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function paintBush(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.fillStyle = 'rgba(28, 62, 24, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6 * scale, 11 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const blobs: [number, number, number][] = [
    [-6, 0, 7],
    [5, -1, 8],
    [0, -6, 7],
  ];
  for (const [dx, dy, r] of blobs) {
    ctx.fillStyle = '#2f7a34';
    ctx.beginPath();
    ctx.arc(x + dx * scale, y + dy * scale, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(126, 196, 96, 0.45)';
  ctx.beginPath();
  ctx.arc(x - 3 * scale, y - 6 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function paintRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.fillStyle = 'rgba(28, 62, 24, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * scale, 8 * scale, 3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#9aa0a4';
  ctx.beginPath();
  ctx.moveTo(x - 7 * scale, y + 3 * scale);
  ctx.lineTo(x - 3 * scale, y - 5 * scale);
  ctx.lineTo(x + 4 * scale, y - 4 * scale);
  ctx.lineTo(x + 7 * scale, y + 3 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(220, 226, 230, 0.5)';
  ctx.beginPath();
  ctx.moveTo(x - 3 * scale, y - 5 * scale);
  ctx.lineTo(x + 4 * scale, y - 4 * scale);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

const FLOWER_COLORS = ['#f2f2f2', '#f4a6c8', '#f0d264', '#a9c2f5'];

function paintDecorations(ctx: CanvasRenderingContext2D, random: () => number): void {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (terrainAt(col, row) !== 'grass') continue;
      const roll = random();
      const center = cellCenter(col, row);
      const jitterX = (random() - 0.5) * CELL * 0.5;
      const jitterY = (random() - 0.5) * CELL * 0.5;

      if (roll < 0.12) {
        paintBush(ctx, center.x + jitterX, center.y + jitterY, 0.8 + random() * 0.5);
      } else if (roll < 0.18) {
        paintRock(ctx, center.x + jitterX, center.y + jitterY, 0.7 + random() * 0.5);
      } else if (roll < 0.46) {
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i += 1) {
          const color = FLOWER_COLORS[Math.floor(random() * FLOWER_COLORS.length)] as string;
          paintFlower(
            ctx,
            center.x + (random() - 0.5) * CELL * 0.7,
            center.y + (random() - 0.5) * CELL * 0.7,
            color,
          );
        }
      }
    }
  }
}

function paintSpawn(ctx: CanvasRenderingContext2D): void {
  const center = cellCenter(SPAWN_CELL.col, SPAWN_CELL.row);

  ctx.fillStyle = '#4a4038';
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, CELL * 0.46, CELL * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1c1712';
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, CELL * 0.33, CELL * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(180, 80, 60, 0.55)';
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, CELL * 0.18, CELL * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paintGoal(ctx: CanvasRenderingContext2D): void {
  const center = cellCenter(GOAL_CELL.col, GOAL_CELL.row);
  const x = center.x;
  const y = center.y;

  // Sombra.
  ctx.fillStyle = 'rgba(28, 62, 24, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.3, CELL * 0.4, CELL * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Muralla.
  ctx.fillStyle = '#b9bcc0';
  ctx.fillRect(x - CELL * 0.38, y - CELL * 0.28, CELL * 0.76, CELL * 0.56);
  ctx.fillStyle = '#8f9296';
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x - CELL * 0.38 + i * CELL * 0.28, y - CELL * 0.42, CELL * 0.18, CELL * 0.16);
  }

  // Puerta.
  ctx.fillStyle = '#5c3a1f';
  ctx.beginPath();
  ctx.moveTo(x - CELL * 0.14, y + CELL * 0.28);
  ctx.lineTo(x - CELL * 0.14, y - CELL * 0.04);
  ctx.arc(x, y - CELL * 0.04, CELL * 0.14, Math.PI, 0);
  ctx.lineTo(x + CELL * 0.14, y + CELL * 0.28);
  ctx.closePath();
  ctx.fill();

  // Bandera.
  ctx.strokeStyle = '#6b6f73';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + CELL * 0.3, y - CELL * 0.42);
  ctx.lineTo(x + CELL * 0.3, y - CELL * 0.75);
  ctx.stroke();
  ctx.fillStyle = '#d94f4f';
  ctx.beginPath();
  ctx.moveTo(x + CELL * 0.3, y - CELL * 0.74);
  ctx.lineTo(x + CELL * 0.62, y - CELL * 0.64);
  ctx.lineTo(x + CELL * 0.3, y - CELL * 0.54);
  ctx.closePath();
  ctx.fill();
}

let cached: HTMLCanvasElement | null = null;

/** Devuelve el mapa ya dibujado; solo se calcula la primera vez. */
export function getTerrainCanvas(): HTMLCanvasElement {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = MAP_WIDTH;
  canvas.height = MAP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto del terreno');

  const random = mulberry32(20240607);
  paintGrass(ctx, random);
  paintPath(ctx, random);
  paintDecorations(ctx, random);
  paintSpawn(ctx);
  paintGoal(ctx);

  cached = canvas;
  return canvas;
}
