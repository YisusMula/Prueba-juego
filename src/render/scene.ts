/** Composición de la escena: terreno, entidades, efectos y previsualización. */

import { type Camera, type Viewport, screenToWorld, worldToScreen } from '../game/camera';
import { ABILITIES } from '../game/abilities';
import { CELL, MAP_HEIGHT, MAP_WIDTH, cellCenter, worldToCell } from '../game/map';
import { statsAtLevel, towerType } from '../game/towers';
import { type GameState, canPlaceTower, getSelectedTower } from '../game/state';
import { getTerrainCanvas } from './terrain';
import { currentScenario } from '../game/state';
import { isBuildableTerrain } from '../game/scenarios';
import { AIR_ALTITUDE, drawEnemy, drawProjectile, drawTower, drawTowerGhost } from './sprites';

export interface SceneInput {
  /** Posición del puntero en píxeles de pantalla, o null si no hay. */
  pointer: { x: number; y: number } | null;
  /** Celda señalada con el teclado, o null si el jugador no lo ha usado. */
  keyboardCell: { col: number; row: number } | null;
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

/** Área que cubriría la habilidad dirigida que el jugador está apuntando. */
function drawAbilityPreview(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewport: Viewport,
  pointer: { x: number; y: number } | null,
): void {
  const id = state.aimingAbility;
  if (id === null || pointer === null) return;

  const spec = ABILITIES[id];
  if (!spec.targeted) return;

  const world = screenToWorld(camera, viewport, pointer);

  ctx.fillStyle = 'rgba(255, 140, 60, 0.2)';
  ctx.strokeStyle = 'rgba(255, 180, 90, 0.9)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(world.x, world.y, spec.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  // Cruz de puntería en el centro.
  ctx.strokeStyle = 'rgba(255, 220, 150, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(world.x - 12, world.y);
  ctx.lineTo(world.x + 12, world.y);
  ctx.moveTo(world.x, world.y - 12);
  ctx.lineTo(world.x, world.y + 12);
  ctx.stroke();
}

function drawSelectionHighlight(ctx: CanvasRenderingContext2D, state: GameState): void {
  const tower = getSelectedTower(state);
  if (!tower) return;

  const stats = statsAtLevel(towerType(tower.typeId), tower.level, tower.specialisation);
  drawRangeCircle(ctx, tower.x, tower.y, stats.range, true);

  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(tower.col * CELL + 3, tower.row * CELL + 3, CELL - 6, CELL - 6);
  ctx.setLineDash([]);
}

/**
 * Cursor de teclado.
 *
 * Se dibuja con un recuadro más grueso y sin discontinuo, para distinguirlo del
 * resaltado de la torre seleccionada: pueden estar los dos a la vez y confundir
 * cuál responde a las teclas sería peor que no tener cursor.
 */
function drawKeyboardCursor(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cell: { col: number; row: number } | null,
): void {
  if (!cell) return;

  const x = cell.col * CELL;
  const y = cell.row * CELL;
  const buildable = isBuildableTerrain(currentScenario(state), cell.col, cell.row);

  ctx.save();
  ctx.strokeStyle = buildable ? '#ffffff' : '#e2574c';
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = buildable ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 87, 76, 0.16)';
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.restore();
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
      case 'damage': {
        // Número de daño flotante: sube y se desvanece.
        const alpha = 1 - progress;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(20, 10, 0, ${0.7 * alpha})`;
        ctx.fillStyle = `rgba(255, 245, 220, ${alpha})`;
        const y = effect.y - progress * 22;
        ctx.strokeText(effect.text, effect.x, y);
        ctx.fillText(effect.text, effect.x, y);
        break;
      }
      case 'meteor': {
        const alpha = 1 - progress;
        // Onda expansiva.
        ctx.strokeStyle = `rgba(255, 140, 60, ${alpha})`;
        ctx.lineWidth = 6 * alpha + 2;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (0.3 + progress * 0.9), 0, Math.PI * 2);
        ctx.stroke();

        const glow = ctx.createRadialGradient(
          effect.x, effect.y, 0,
          effect.x, effect.y, effect.radius,
        );
        glow.addColorStop(0, `rgba(255, 230, 150, ${0.75 * alpha})`);
        glow.addColorStop(0.5, `rgba(255, 120, 40, ${0.45 * alpha})`);
        glow.addColorStop(1, 'rgba(255, 80, 20, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'blizzard': {
        // La ventisca cubre el mapa entero: se dibuja aparte, en pantalla.
        break;
      }
    }
  }
}

/** Velo de escarcha sobre todo el mapa mientras dura la ventisca. */
function drawBlizzardVeil(ctx: CanvasRenderingContext2D, state: GameState): void {
  const effect = state.effects.find((candidate) => candidate.kind === 'blizzard');
  if (!effect) return;

  const alpha = (effect.life / effect.maxLife) * 0.4;
  ctx.fillStyle = `rgba(190, 235, 255, ${alpha})`;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 1.4})`;
  ctx.lineWidth = 2;
  const progress = 1 - effect.life / effect.maxLife;
  for (let i = 0; i < 40; i += 1) {
    const x = ((i * 137) % MAP_WIDTH) + progress * 60;
    const y = ((i * 271) % MAP_HEIGHT) + progress * 120;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 10, y + 18);
    ctx.stroke();
  }
}

/**
 * Flechas en el borde señalando enemigos fuera de cuadro. Sin esto, mover el
 * mapa obliga al jugador a vigilar a ciegas lo que queda fuera de la vista.
 */
function drawOffscreenMarkers(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewport: Viewport,
): void {
  if (state.enemies.length === 0) return;

  const margin = 26;
  const half = { x: viewport.width / 2, y: viewport.height / 2 };
  // Agrupar por dirección evita dibujar cien flechas en una oleada grande.
  const seen = new Set<string>();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const screen = worldToScreen(camera, viewport, { x: enemy.x, y: enemy.y });
    const outside =
      screen.x < 0 || screen.y < 0 || screen.x > viewport.width || screen.y > viewport.height;
    if (!outside) continue;

    const clamped = {
      x: Math.min(viewport.width - margin, Math.max(margin, screen.x)),
      y: Math.min(viewport.height - margin, Math.max(margin, screen.y)),
    };
    const key = `${Math.round(clamped.x / 40)}:${Math.round(clamped.y / 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const angle = Math.atan2(screen.y - half.y, screen.x - half.x);
    ctx.save();
    ctx.translate(clamped.x, clamped.y);
    ctx.rotate(angle);
    ctx.fillStyle = enemy.domain === 'air' ? 'rgba(200, 160, 255, 0.9)' : 'rgba(255, 150, 90, 0.9)';
    ctx.strokeStyle = 'rgba(20, 12, 6, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
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

  ctx.drawImage(getTerrainCanvas(currentScenario(state)), 0, 0, MAP_WIDTH, MAP_HEIGHT);

  drawKeyboardCursor(ctx, state, input.keyboardCell);
  drawSelectionHighlight(ctx, state);
  drawPlacementPreview(ctx, state, camera, viewport, input.pointer);
  drawAbilityPreview(ctx, state, camera, viewport, input.pointer);

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
  drawBlizzardVeil(ctx, state);

  ctx.restore();

  drawOffscreenMarkers(ctx, state, camera, viewport);
}

/** Altura de vuelo, reexportada para que la UI pueda alinear indicadores. */
export { AIR_ALTITUDE };
