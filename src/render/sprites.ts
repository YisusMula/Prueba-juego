/** Dibujo procedural de torres, criaturas y proyectiles en coordenadas de mundo. */

import { CELL } from '../game/map';
import { ENEMY_TYPES } from '../game/enemies';
import { TOWER_TYPES, statsAtLevel } from '../game/towers';
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

function drawMagicTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number, time: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#6a4a9a');

  ctx.fillStyle = '#4a3670';
  ctx.beginPath();
  ctx.moveTo(x - CELL * 0.14, y + CELL * 0.1);
  ctx.lineTo(x - CELL * 0.08, y - CELL * 0.28);
  ctx.lineTo(x + CELL * 0.08, y - CELL * 0.28);
  ctx.lineTo(x + CELL * 0.14, y + CELL * 0.1);
  ctx.closePath();
  ctx.fill();

  const pulse = 0.7 + Math.sin(time * 4 + tower.id) * 0.3;
  ctx.save();
  ctx.translate(x, y - CELL * 0.34);
  ctx.rotate(tower.angle * 0.15);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, CELL * 0.22);
  glow.addColorStop(0, `rgba(190, 140, 255, ${0.55 * pulse})`);
  glow.addColorStop(1, 'rgba(190, 140, 255, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, CELL * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c9a6ff';
  ctx.beginPath();
  ctx.arc(0, 0, CELL * (0.08 + 0.01 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3e6ff';
  ctx.beginPath();
  ctx.arc(-2, -2, CELL * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (level >= 3) {
    ctx.strokeStyle = 'rgba(201, 166, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - CELL * 0.34, CELL * 0.3, time, time + Math.PI * 1.4);
    ctx.stroke();
  }

  drawLevelPips(ctx, x, y, level);
}

function drawFrostTower(ctx: CanvasRenderingContext2D, tower: Tower, level: number): void {
  const { x, y } = tower;
  drawStoneBase(ctx, x, y, '#a8d8e8');

  ctx.fillStyle = '#dff3fb';
  ctx.beginPath();
  ctx.moveTo(x, y - CELL * 0.34);
  ctx.lineTo(x - CELL * 0.15, y + CELL * 0.06);
  ctx.lineTo(x + CELL * 0.15, y + CELL * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7fb8d0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  ctx.translate(x, y - CELL * 0.1);
  ctx.rotate(tower.angle);
  for (const [dx, dy, s] of [
    [0.08, -0.02, 1],
    [-0.02, -0.14, 0.75],
    [0.02, -0.2, 0.6],
  ] as const) {
    ctx.fillStyle = '#eaf8fd';
    ctx.beginPath();
    ctx.moveTo(CELL * dx, CELL * dy - CELL * 0.05 * s);
    ctx.lineTo(CELL * dx - CELL * 0.025 * s, CELL * dy + CELL * 0.05 * s);
    ctx.lineTo(CELL * dx + CELL * 0.025 * s, CELL * dy + CELL * 0.05 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (level >= 3) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const [dx, dy] of [
      [-0.14, -0.22],
      [0.16, -0.18],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + CELL * dx, y + CELL * dy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawLevelPips(ctx, x, y, level);
}

/** Grietas y humo sobre una torre cuya estructura está por debajo de su máximo. */
function drawTowerDamage(ctx: CanvasRenderingContext2D, tower: Tower, maxHp: number): void {
  if (maxHp <= 0 || tower.hp >= maxHp) return;
  const ratio = Math.max(0, tower.hp / maxHp);
  const { x, y } = tower;

  ctx.strokeStyle = `rgba(30, 22, 16, ${0.35 + (1 - ratio) * 0.35})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - CELL * 0.1, y + CELL * 0.16);
  ctx.lineTo(x - CELL * 0.03, y + CELL * 0.04);
  ctx.lineTo(x - CELL * 0.09, y - CELL * 0.04);
  ctx.moveTo(x + CELL * 0.06, y + CELL * 0.2);
  ctx.lineTo(x + CELL * 0.12, y + CELL * 0.06);
  ctx.stroke();

  if (ratio < 0.5) {
    ctx.fillStyle = `rgba(70, 70, 70, ${0.3 * (1 - ratio)})`;
    ctx.beginPath();
    ctx.ellipse(x + CELL * 0.05, y - CELL * 0.4, CELL * 0.09, CELL * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (tower.hp <= 0) {
    ctx.fillStyle = 'rgba(40, 34, 28, 0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y, CELL * 0.32, CELL * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawTower(ctx: CanvasRenderingContext2D, tower: Tower, time = 0): void {
  const type = TOWER_TYPES[tower.typeId];
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
    case 'magic':
      drawMagicTower(ctx, tower, tower.level, time);
      break;
    case 'frost':
      drawFrostTower(ctx, tower, tower.level);
      break;
  }
  drawTowerDamage(ctx, tower, statsAtLevel(type, tower.level).maxHp);
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
    hp: 1,
    frozenTargets: [],
    priority: 'first',
    invested: 0,
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

  drawGroundFeatures(ctx, enemy, x, y);

  if (enemy.offPath) drawTrampledGrass(ctx, enemy, x, y);
  if (enemy.flash > 0) drawDamageFlash(ctx, x, y, enemy.radius, enemy.flash);
  if (enemy.slowTimer > 0) drawFrostOverlay(ctx, x, y, enemy.radius);

  drawHealthBar(ctx, enemy, enemy.y - enemy.radius * 1.9);
}

/** Rasgos que distinguen a cada criatura terrestre: orejas, colmillos, tocados. */
function drawGroundFeatures(ctx: CanvasRenderingContext2D, enemy: Enemy, x: number, y: number): void {
  const r = enemy.radius;

  switch (enemy.typeId) {
    case 'rat': {
      ctx.fillStyle = '#c9a6a0';
      ctx.beginPath();
      ctx.arc(x - r * 0.55, y - r * 0.7, r * 0.28, 0, Math.PI * 2);
      ctx.arc(x + r * 0.55, y - r * 0.7, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c9a6a0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.9);
      ctx.quadraticCurveTo(x + r * 0.9, y + r * 1.1, x + r * 1.3, y + r * 0.6);
      ctx.stroke();
      break;
    }
    case 'fox': {
      ctx.fillStyle = '#d9702e';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y - r * 0.5);
      ctx.lineTo(x - r * 0.95, y - r * 1.25);
      ctx.lineTo(x - r * 0.35, y - r * 0.85);
      ctx.closePath();
      ctx.moveTo(x + r * 0.75, y - r * 0.5);
      ctx.lineTo(x + r * 0.95, y - r * 1.25);
      ctx.lineTo(x + r * 0.35, y - r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4ede2';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 1.15, r * 0.55, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'dog': {
      ctx.fillStyle = '#5a4826';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.85, y - r * 0.2, r * 0.3, r * 0.5, -0.3, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.85, y - r * 0.2, r * 0.3, r * 0.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d94f4f';
      ctx.beginPath();
      ctx.arc(x, y + r * 0.55, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'boar': {
      ctx.fillStyle = '#efe3cf';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y + r * 0.5);
      ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.55, x - r * 0.65, y + r * 0.15);
      ctx.lineTo(x - r * 0.35, y + r * 0.35);
      ctx.closePath();
      ctx.moveTo(x + r * 0.3, y + r * 0.5);
      ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.55, x + r * 0.65, y + r * 0.15);
      ctx.lineTo(x + r * 0.35, y + r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2a221c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -2; i <= 2; i += 1) {
        ctx.moveTo(x + i * r * 0.25, y - r * 0.95);
        ctx.lineTo(x + i * r * 0.25, y - r * 1.2);
      }
      ctx.stroke();
      break;
    }
    case 'goblin': {
      ctx.fillStyle = '#2c4520';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.35);
      ctx.lineTo(x - r * 1.15, y - r * 0.5);
      ctx.lineTo(x - r * 0.55, y);
      ctx.closePath();
      ctx.moveTo(x + r * 0.6, y - r * 0.35);
      ctx.lineTo(x + r * 1.15, y - r * 0.5);
      ctx.lineTo(x + r * 0.55, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'orc': {
      ctx.fillStyle = '#3a4a30';
      ctx.fillRect(x - r * 1.05, y - r * 0.1, r * 0.4, r * 0.35);
      ctx.fillRect(x + r * 0.65, y - r * 0.1, r * 0.4, r * 0.35);
      ctx.fillStyle = '#efe3cf';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.4, y + r * 0.5);
      ctx.lineTo(x - r * 0.6, y + r * 0.85);
      ctx.lineTo(x - r * 0.2, y + r * 0.55);
      ctx.closePath();
      ctx.moveTo(x + r * 0.4, y + r * 0.5);
      ctx.lineTo(x + r * 0.6, y + r * 0.85);
      ctx.lineTo(x + r * 0.2, y + r * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'warlord': {
      ctx.fillStyle = '#efe3cf';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y - r * 0.6);
      ctx.lineTo(x - r * 0.95, y - r * 1.15);
      ctx.lineTo(x - r * 0.4, y - r * 0.85);
      ctx.closePath();
      ctx.moveTo(x + r * 0.7, y - r * 0.6);
      ctx.lineTo(x + r * 0.95, y - r * 1.15);
      ctx.lineTo(x + r * 0.4, y - r * 0.85);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, y - r * 1.2);
      ctx.lineTo(x - r * 0.5, y - r * 1.55);
      ctx.lineTo(x - r * 0.17, y - r * 1.3);
      ctx.lineTo(x, y - r * 1.65);
      ctx.lineTo(x + r * 0.17, y - r * 1.3);
      ctx.lineTo(x + r * 0.5, y - r * 1.55);
      ctx.lineTo(x + r * 0.5, y - r * 1.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

/** Dos matas de hierba pisada tras un enemigo que ha abandonado el camino. */
function drawTrampledGrass(ctx: CanvasRenderingContext2D, enemy: Enemy, x: number, y: number): void {
  ctx.strokeStyle = 'rgba(210, 200, 150, 0.55)';
  ctx.lineWidth = 1.2;
  const wobble = Math.sin(enemy.phase * 3) * 3;
  ctx.beginPath();
  ctx.moveTo(x - enemy.radius * 0.6, y + enemy.radius * 0.9);
  ctx.lineTo(x - enemy.radius * 0.9 + wobble, y + enemy.radius * 1.5);
  ctx.moveTo(x + enemy.radius * 0.5, y + enemy.radius * 0.95);
  ctx.lineTo(x + enemy.radius * 0.85 - wobble, y + enemy.radius * 1.55);
  ctx.stroke();
}

/** Destello blanco al recibir daño: confirma el impacto de un vistazo. */
function drawDamageFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  flash: number,
): void {
  // 0.12 s es la duración completa del destello; se desvanece en ese tramo.
  const alpha = Math.min(1, flash / 0.12) * 0.75;
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.08, radius * 1.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Brillo helado sobre un enemigo congelado por la torre de hielo. */
function drawFrostOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = 'rgba(180, 230, 250, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.05, radius * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius * 0.6;
    const py = y + Math.sin(angle) * radius * 0.6;
    ctx.beginPath();
    ctx.moveTo(px - 2, py);
    ctx.lineTo(px + 2, py);
    ctx.moveTo(px, py - 2);
    ctx.lineTo(px, py + 2);
    ctx.stroke();
  }
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

  drawAirFeatures(ctx, enemy, x, y);
  if (enemy.flash > 0) drawDamageFlash(ctx, x, y, enemy.radius, enemy.flash);
  if (enemy.slowTimer > 0) drawFrostOverlay(ctx, x, y, enemy.radius);

  drawHealthBar(ctx, enemy, y - enemy.radius * 1.8);
}

/** Rasgos que distinguen a cada criatura voladora: orejas, cabeza, pico. */
function drawAirFeatures(ctx: CanvasRenderingContext2D, enemy: Enemy, x: number, y: number): void {
  const r = enemy.radius;

  switch (enemy.typeId) {
    case 'bat': {
      ctx.fillStyle = ENEMY_TYPES.bat.accent;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r * 0.7);
      ctx.lineTo(x - r * 0.5, y - r * 1.15);
      ctx.lineTo(x - r * 0.1, y - r * 0.75);
      ctx.closePath();
      ctx.moveTo(x + r * 0.3, y - r * 0.7);
      ctx.lineTo(x + r * 0.5, y - r * 1.15);
      ctx.lineTo(x + r * 0.1, y - r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.12, y + r * 0.1);
      ctx.lineTo(x - r * 0.05, y - r * 0.02);
      ctx.lineTo(x, y + r * 0.1);
      ctx.lineTo(x + r * 0.05, y - r * 0.02);
      ctx.lineTo(x + r * 0.12, y + r * 0.1);
      ctx.fill();
      break;
    }
    case 'eagle': {
      ctx.fillStyle = '#f2ede0';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.55, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8a13a';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.5);
      ctx.lineTo(x + r * 0.32, y - r * 0.4);
      ctx.lineTo(x, y - r * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'vulture': {
      ctx.fillStyle = '#c98a86';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.6, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a342e';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.55);
      ctx.lineTo(x + r * 0.3, y - r * 0.5);
      ctx.lineTo(x, y - r * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
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
    case 'lightning': {
      ctx.strokeStyle = '#e0c8ff';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-11, 3);
      ctx.lineTo(-3, -3);
      ctx.lineTo(-4, 1);
      ctx.lineTo(5, -4);
      ctx.lineTo(11, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160, 100, 255, 0.5)';
      ctx.lineWidth = 6;
      ctx.stroke();
      break;
    }
    case 'frostbolt': {
      ctx.strokeStyle = '#dff3fb';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i += 1) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        ctx.moveTo(2, -2);
        ctx.lineTo(5, 0);
        ctx.lineTo(2, 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#a8d8e8';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
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
  magic: TOWER_TYPES.magic.accent,
  frost: TOWER_TYPES.frost.accent,
};
