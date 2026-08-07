/** Composición de la escena: terreno, entidades, efectos y previsualización. */

import { type Camera, type Viewport, screenToWorld } from '../game/camera';
import { CELL, MAP_HEIGHT, MAP_WIDTH, cellCenter, worldToCell } from '../game/map';
import { statsAtLevel, towerType } from '../game/towers';
import { type GameState, canPlaceTower, getSelectedTower } from '../game/state';
import { getTerrainCanvas } from './terrain';
import { AIR_ALTITUDE, drawEnemy, drawProjectile, drawTower, drawTowerGhost } from './sprites';

export interface SceneInput {
  /** Posición del puntero en píxeles de pantalla, o null si no hay. */
  pointer: { x: number; y: number } | null;
}

function drawRangeCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  valid: boolean,
): void {
  ctx.fillStyle = valid ? 'rgba(255, 255, 255, 0.12)' : 'rgba(220, 70, 60, 0.14)';
  ctx.strokeStyle = valid ? 'rgba(255, 255, 255, 0.65)' : 'rgba(220, 70, 60, 0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewport: Viewport,
  pointer: { x: number; y: number } | null,
): void {
  const typeId = state.shopSelection;
  if (typeId === null || pointer === null) return;

  const world = screenToWorld(camera, viewport, pointer);
  const cell = worldToCell(world.x, world.y);
  const center = cellCenter(cell.col, cell.row);
  const valid = canPlaceTower(state, cell.col, cell.row);
  const type = towerType(typeId);

  drawRangeCircle(ctx, center.x, center.y, type.range, valid);

  ctx.fillStyle = valid ? 'rgba(255, 255, 255, 0.28)' : 'rgba(220, 70, 60, 0.3)';
  ctx.fillRect(cell.col * CELL + 2, cell.row * CELL + 2, CELL - 4, CELL - 4);

  ctx.globalAlpha = valid ? 0.75 : 0.4;
  drawTowerGhost(ctx, typeId, center.x, center.y);
  ctx.globalAlpha = 1;

  if (!valid) {
    ctx.strokeStyle = 'rgba(230, 80, 70, 0.95)';
    ctx.lineWidth = 4;
    const cx = center.x;
    const cy = center.y;
    const size = CELL * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.stroke();
  }
}

function drawSelectionHighlight(ctx: CanvasRenderingContext2D, state: GameState): void {
  const tower = getSelectedTower(state);
  if (!tower) return;

  const stats = statsAtLevel(towerType(tower.typeId), tower.level);
  drawRangeCircle(ctx, tower.x, tower.y, stats.range, true);

  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(tower.col * CELL + 3, tower.row * CELL + 3, CELL - 6, CELL - 6);
  ctx.setLineDash([]);
}

function drawEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const effect of state.effects) {
    const progress = 1 - effect.life / effect.maxLife;

    switch (effect.kind) {
      case 'explosion': {
        ctx.strokeStyle = `rgba(255, 168, 74, ${1 - progress})`;
        ctx.lineWidth = 4 * (1 - progress) + 1;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (0.35 + progress * 0.75), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 214, 140, ${0.4 * (1 - progress)})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * progress * 0.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hit': {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * (1 - progress)})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, 4 + progress * 6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'gold': {
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(40, 30, 0, ${0.8 * (1 - progress)})`;
        ctx.fillStyle = `rgba(255, 216, 92, ${1 - progress})`;
        ctx.strokeText(effect.text, effect.x, effect.y - 18 - progress * 26);
        ctx.fillText(effect.text, effect.x, effect.y - 18 - progress * 26);
        break;
      }
      case 'leak': {
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(50, 0, 0, ${0.85 * (1 - progress)})`;
        ctx.fillStyle = `rgba(255, 90, 80, ${1 - progress})`;
        ctx.strokeText(effect.text, effect.x, effect.y - 24 - progress * 30);
        ctx.fillText(effect.text, effect.x, effect.y - 24 - progress * 30);
        break;
      }
    }
  }
}

/** Dibuja un frame completo. `viewport` va en píxeles CSS. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewport: Viewport,
  dpr: number,
  input: SceneInput,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2f4f2a';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.save();
  ctx.translate(viewport.width / 2, viewport.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  ctx.drawImage(getTerrainCanvas(), 0, 0, MAP_WIDTH, MAP_HEIGHT);

  drawSelectionHighlight(ctx, state);
  drawPlacementPreview(ctx, state, camera, viewport, input.pointer);

  for (const tower of state.towers) drawTower(ctx, tower, state.time);

  // Los terrestres van sobre el suelo; los aéreos, por encima de todo.
  for (const enemy of state.enemies) {
    if (enemy.domain === 'ground') drawEnemy(ctx, enemy, state.time);
  }
  for (const projectile of state.projectiles) drawProjectile(ctx, projectile);
  for (const enemy of state.enemies) {
    if (enemy.domain === 'air') drawEnemy(ctx, enemy, state.time);
  }

  drawEffects(ctx, state);

  ctx.restore();
}

/** Altura de vuelo, reexportada para que la UI pueda alinear indicadores. */
export { AIR_ALTITUDE };
