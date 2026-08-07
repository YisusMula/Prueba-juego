/** Dibujo procedural de torres, criaturas y proyectiles en coordenadas de mundo. */

import { CELL } from '../game/map';
import { ENEMY_TYPES } from '../game/enemies';
import { TOWER_TYPES } from '../game/towers';
import type { Enemy, Projectile, Tower } from '../game/state';

/** Altura a la que vuelan las criaturas aéreas, en píxeles de mundo. */
export const AIR_ALTITUDE = 26;

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha = 0.28): void {
  ctx.fillStyle = `rgba(20, 45, 18, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawStoneBase(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  shadow(ctx, x, y + CELL * 0.24, CELL * 0.34);

  ctx.fillStyle = '#6d6a63';
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.18, CELL * 0.32, CELL * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.1, CELL * 0.29, CELL * 0.145, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLevelPips(ctx: CanvasRenderingContext2D, x: number, y: number, level: number): void {
  const maxPips = 5;
  const spacing = 7;
  const startX = x - ((Math.min(level, maxPips) - 1) * spacing) / 2;
  for (let i = 0; i < Math.min(level, maxPips); i += 1) {
    ctx.fillStyle = '#ffd75e';
    ctx.strokeStyle = 'rgba(70, 50, 10, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(startX + i * spacing, y + CELL * 0.3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawArcherTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#c8b18a');

  // Torreón de piedra.
  ctx.fillStyle = '#ddcaa6';
  ctx.fillRect(x - CELL * 0.17, y - CELL * 0.24, CELL * 0.34, CELL * 0.36);
  ctx.fillStyle = 'rgba(120, 100, 70, 0.35)';
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x - CELL * 0.17, y - CELL * 0.24 + i * CELL * 0.12, CELL * 0.34, 2);
  }

  // Almenas.
  ctx.fillStyle = '#c2ad86';
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x - CELL * 0.2 + i * CELL * 0.14, y - CELL * 0.32, CELL * 0.09, CELL * 0.1);
  }

  // Tejado que gira hacia el objetivo.
  ctx.save();
  ctx.translate(x, y - CELL * 0.3);
  ctx.rotate(tower.angle);
  ctx.fillStyle = level >= 4 ? '#3f7d4a' : '#4b8f57';
  ctx.beginPath();
  ctx.moveTo(-CELL * 0.16, 0);
  ctx.lineTo(0, -CELL * 0.22);
  ctx.lineTo(CELL * 0.16, 0);
  ctx.closePath();
  ctx.fill();

  // Arquera asomando.
  ctx.fillStyle = '#f0d3ad';
  ctx.beginPath();
  ctx.arc(CELL * 0.1, -CELL * 0.04, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLevelPips(ctx, x, y, level);
}

function drawCannonTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#9aa1a8');

  ctx.fillStyle = '#7f868d';
  ctx.beginPath();
  ctx.arc(x, y - CELL * 0.04, CELL * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a7aeb5';
  ctx.beginPath();
  ctx.arc(x, y - CELL * 0.06, CELL * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // Tubo, con retroceso al disparar.
  ctx.save();
  ctx.translate(x, y - CELL * 0.06);
  ctx.rotate(tower.angle);
  ctx.translate(-tower.recoil * 5, 0);
  ctx.fillStyle = '#40474d';
  ctx.beginPath();
  ctx.roundRect(0, -CELL * 0.075, CELL * 0.36, CELL * 0.15, 4);
  ctx.fill();
  ctx.fillStyle = '#2b3136';
  ctx.beginPath();
  ctx.arc(CELL * 0.36, 0, CELL * 0.075, 0, Math.PI * 2);
  ctx.fill();
  if (level >= 3) {
    ctx.fillStyle = '#d8b356';
    ctx.fillRect(CELL * 0.18, -CELL * 0.085, 4, CELL * 0.17);
  }
  ctx.restore();

  drawLevelPips(ctx, x, y, level);
}

function drawMortarTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#8a7d6b');

  ctx.fillStyle = '#6f6555';
  ctx.beginPath();
  ctx.roundRect(x - CELL * 0.22, y - CELL * 0.14, CELL * 0.44, CELL * 0.24, 5);
  ctx.fill();

  // Boca ancha, siempre inclinada hacia arriba.
  ctx.save();
  ctx.translate(x, y - CELL * 0.1);
  ctx.rotate(tower.angle * 0.25 - 0.5);
  ctx.translate(-tower.recoil * 4, 0);
  ctx.fillStyle = '#4a3f31';
  ctx.beginPath();
  ctx.moveTo(0, -CELL * 0.09);
  ctx.lineTo(CELL * 0.26, -CELL * 0.14);
  ctx.lineTo(CELL * 0.26, CELL * 0.14);
  ctx.lineTo(0, CELL * 0.09);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#241d15';
  ctx.beginPath();
  ctx.ellipse(CELL * 0.26, 0, CELL * 0.04, CELL * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (level >= 3) {
    ctx.fillStyle = '#2f2a22';
    ctx.beginPath();
    ctx.arc(x - CELL * 0.16, y + CELL * 0.02, 4, 0, Math.PI * 2);
    ctx.arc(x - CELL * 0.06, y + CELL * 0.06, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLevelPips(ctx, x, y, level);
}

function drawBallistaTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#b98b5e');

  ctx.fillStyle = '#8a6238';
  ctx.beginPath();
  ctx.roundRect(x - CELL * 0.2, y - CELL * 0.1, CELL * 0.4, CELL * 0.2, 4);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y - CELL * 0.1);
  ctx.rotate(tower.angle);
  ctx.translate(-tower.recoil * 6, 0);

  // Cureña.
  ctx.fillStyle = '#5d3c22';
  ctx.fillRect(-CELL * 0.18, -CELL * 0.035, CELL * 0.44, CELL * 0.07);

  // Arco.
  ctx.strokeStyle = '#3f2a17';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CELL * 0.12, -CELL * 0.22);
  ctx.quadraticCurveTo(CELL * 0.24, 0, CELL * 0.12, CELL * 0.22);
  ctx.stroke();

  // Cuerda.
  ctx.strokeStyle = 'rgba(240, 235, 220, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CELL * 0.12, -CELL * 0.22);
  ctx.lineTo(CELL * 0.02, 0);
  ctx.lineTo(CELL * 0.12, CELL * 0.22);
  ctx.stroke();

  if (level >= 4) {
    ctx.strokeStyle = '#d8b356';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CELL * 0.13, -CELL * 0.2);
    ctx.quadraticCurveTo(CELL * 0.25, 0, CELL * 0.13, CELL * 0.2);
    ctx.stroke();
  }
  ctx.restore();

  drawLevelPips(ctx, x, y, level);
}

export function drawTower(ctx: CanvasRenderingContext2D, tower: Tower): void {
  switch (tower.typeId) {
    case 'archer':
      drawArcherTower(ctx, tower, tower.level);
      break;
    case 'cannon':
      drawCannonTower(ctx, tower, tower.level);
      break;
    case 'mortar':
      drawMortarTower(ctx, tower, tower.level);
      break;
    case 'ballista':
      drawBallistaTower(ctx, tower, tower.level);
      break;
  }
}

/** Silueta simplificada para la previsualización y los iconos de la tienda. */
export function drawTowerGhost(
  ctx: CanvasRenderingContext2D,
  typeId: Tower['typeId'],
  x: number,
  y: number,
): void {
  const ghost: Tower = {
    id: -1,
    typeId,
    col: 0,
    row: 0,
    x,
    y,
    level: 1,
    cooldown: 0,
    angle: -Math.PI / 4,
    recoil: 0,
  };
  drawTower(ctx, ghost);
}

function drawHealthBar(ctx: CanvasRenderingContext2D, enemy: Enemy, y: number): void {
  if (enemy.hp >= enemy.maxHp) return;
  const width = Math.max(20, enemy.radius * 2);
  const height = 4;
  const ratio = Math.max(0, enemy.hp / enemy.maxHp);

  ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
  ctx.fillRect(enemy.x - width / 2, y, width, height);
  ctx.fillStyle = ratio > 0.5 ? '#5fd35f' : ratio > 0.25 ? '#e8c44a' : '#e05a4a';
  ctx.fillRect(enemy.x - width / 2, y, width * ratio, height);
}

function drawGroundEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, time: number): void {
  const type = ENEMY_TYPES[enemy.typeId];
  const bob = Math.sin(time * 8 + enemy.phase) * 2;
  const x = enemy.x;
  const y = enemy.y + bob;

  shadow(ctx, x, enemy.y + enemy.radius * 0.75, enemy.radius * 0.85);

  // Cuerpo.
  ctx.fillStyle = type.body;
  ctx.beginPath();
  ctx.ellipse(x, y, enemy.radius, enemy.radius * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sombreado inferior.
  ctx.fillStyle = type.accent;
  ctx.beginPath();
  ctx.ellipse(x, y + enemy.radius * 0.45, enemy.radius * 0.85, enemy.radius * 0.4, 0, 0, Math.PI);
  ctx.fill();

  // Ojos.
  const eyeOffset = enemy.radius * 0.34;
  ctx.fillStyle = '#fdfdfd';
  ctx.beginPath();
  ctx.arc(x - eyeOffset, y - enemy.radius * 0.2, enemy.radius * 0.24, 0, Math.PI * 2);
  ctx.arc(x + eyeOffset, y - enemy.radius * 0.2, enemy.radius * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(x - eyeOffset, y - enemy.radius * 0.2, enemy.radius * 0.11, 0, Math.PI * 2);
  ctx.arc(x + eyeOffset, y - enemy.radius * 0.2, enemy.radius * 0.11, 0, Math.PI * 2);
  ctx.fill();

  if (enemy.typeId === 'brute' || enemy.typeId === 'warlord') {
    // Cuernos.
    ctx.fillStyle = '#efe3cf';
    ctx.beginPath();
    ctx.moveTo(x - enemy.radius * 0.7, y - enemy.radius * 0.6);
    ctx.lineTo(x - enemy.radius * 0.95, y - enemy.radius * 1.15);
    ctx.lineTo(x - enemy.radius * 0.4, y - enemy.radius * 0.85);
    ctx.closePath();
    ctx.moveTo(x + enemy.radius * 0.7, y - enemy.radius * 0.6);
    ctx.lineTo(x + enemy.radius * 0.95, y - enemy.radius * 1.15);
    ctx.lineTo(x + enemy.radius * 0.4, y - enemy.radius * 0.85);
    ctx.closePath();
    ctx.fill();
  }

  if (enemy.typeId === 'warlord') {
    // Corona del jefe.
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.moveTo(x - enemy.radius * 0.5, y - enemy.radius * 1.2);
    ctx.lineTo(x - enemy.radius * 0.5, y - enemy.radius * 1.55);
    ctx.lineTo(x - enemy.radius * 0.17, y - enemy.radius * 1.3);
    ctx.lineTo(x, y - enemy.radius * 1.65);
    ctx.lineTo(x + enemy.radius * 0.17, y - enemy.radius * 1.3);
    ctx.lineTo(x + enemy.radius * 0.5, y - enemy.radius * 1.55);
    ctx.lineTo(x + enemy.radius * 0.5, y - enemy.radius * 1.2);
    ctx.closePath();
    ctx.fill();
  }

  if (enemy.typeId === 'runner') {
    // Estelas de velocidad.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x - enemy.radius * (1.4 + i * 0.5), y - 3 + i * 6);
      ctx.lineTo(x - enemy.radius * (2.2 + i * 0.5), y - 3 + i * 6);
      ctx.stroke();
    }
  }

  drawHealthBar(ctx, enemy, enemy.y - enemy.radius * 1.9);
}

function drawAirEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, time: number): void {
  const type = ENEMY_TYPES[enemy.typeId];
  const flap = Math.sin(time * 14 + enemy.phase);
  const x = enemy.x;
  const y = enemy.y - AIR_ALTITUDE + flap * 3;

  // Sombra en el suelo: deja claro que va volando.
  shadow(ctx, enemy.x, enemy.y + 6, enemy.radius * 0.7, 0.22);

  // Alas.
  ctx.fillStyle = type.accent;
  const wingSpan = enemy.radius * 1.7;
  const wingLift = flap * enemy.radius * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - wingSpan * 0.6, y - wingLift - enemy.radius * 0.6, x - wingSpan, y - wingLift);
  ctx.quadraticCurveTo(x - wingSpan * 0.5, y + enemy.radius * 0.4, x, y + enemy.radius * 0.2);
  ctx.closePath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + wingSpan * 0.6, y - wingLift - enemy.radius * 0.6, x + wingSpan, y - wingLift);
  ctx.quadraticCurveTo(x + wingSpan * 0.5, y + enemy.radius * 0.4, x, y + enemy.radius * 0.2);
  ctx.closePath();
  ctx.fill();

  // Cuerpo.
  ctx.fillStyle = type.body;
  ctx.beginPath();
  ctx.ellipse(x, y, enemy.radius * 0.7, enemy.radius * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ojos.
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.arc(x - enemy.radius * 0.25, y - enemy.radius * 0.2, enemy.radius * 0.15, 0, Math.PI * 2);
  ctx.arc(x + enemy.radius * 0.25, y - enemy.radius * 0.2, enemy.radius * 0.15, 0, Math.PI * 2);
  ctx.fill();

  drawHealthBar(ctx, enemy, y - enemy.radius * 1.8);
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, time: number): void {
  if (enemy.domain === 'air') drawAirEnemy(ctx, enemy, time);
  else drawGroundEnemy(ctx, enemy, time);
}

export function drawProjectile(ctx: CanvasRenderingContext2D, projectile: Projectile): void {
  ctx.save();
  ctx.translate(projectile.x, projectile.y);
  ctx.rotate(projectile.angle);

  switch (projectile.kind) {
    case 'arrow': {
      ctx.strokeStyle = '#5a3f22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.fillStyle = '#d8dce0';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(4, -3);
      ctx.lineTo(4, 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cannonball': {
      ctx.fillStyle = '#2f3438';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(-2, -2, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shell': {
      ctx.fillStyle = '#3a332a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 170, 80, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-15, 0);
      ctx.stroke();
      break;
    }
    case 'bolt': {
      ctx.strokeStyle = '#4a3320';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.fillStyle = '#e8edf1';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(6, -4);
      ctx.lineTo(6, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

export const TOWER_ICON_COLORS: Readonly<Record<Tower['typeId'], string>> = {
  archer: TOWER_TYPES.archer.accent,
  cannon: TOWER_TYPES.cannon.accent,
  mortar: TOWER_TYPES.mortar.accent,
  ballista: TOWER_TYPES.ballista.accent,
};
