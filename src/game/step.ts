/**
 * Simulación del juego: un paso de tiempo fijo, sin dependencias de navegador.
 */

import { PATH_LENGTH, positionAtDistance } from './map';
import { statsAtLevel, towerType } from './towers';
import { WAVE_REST } from './state';
import type { Enemy, GameState, Projectile, Tower } from './state';
import {
  addEffect,
  addGold,
  beginNextWave,
  spawnEnemy,
  loseLife,
  syncShopAffordability,
} from './state';

/** Paso de simulación fijo: la lógica no depende de los FPS del dispositivo. */
export const FIXED_DT = 1 / 60;
/** Tope de pasos por frame, para no encadenar cálculos tras un parón. */
export const MAX_STEPS_PER_FRAME = 5;

function canTarget(tower: Tower, enemy: Enemy): boolean {
  const type = towerType(tower.typeId);
  return enemy.domain === 'air' ? type.canTargetAir : type.canTargetGround;
}

/** Enemigo válido más avanzado en el recorrido dentro del alcance. */
export function findTarget(state: GameState, tower: Tower, range: number): Enemy | null {
  let best: Enemy | null = null;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    if (!canTarget(tower, enemy)) continue;
    const dx = enemy.x - tower.x;
    const dy = enemy.y - tower.y;
    if (dx * dx + dy * dy > range * range) continue;
    if (best === null || enemy.distance > best.distance) best = enemy;
  }
  return best;
}

/** Aplica daño y, si el enemigo muere, otorga su recompensa de oro. */
export function damageEnemy(state: GameState, enemy: Enemy, amount: number): void {
  if (enemy.hp <= 0) return;
  enemy.hp -= amount;
  if (enemy.hp > 0) {
    addEffect(state, 'hit', enemy.x, enemy.y, { life: 0.18, radius: enemy.radius });
    return;
  }
  enemy.hp = 0;
  state.stats.kills += 1;
  addGold(state, enemy.reward);
  addEffect(state, 'gold', enemy.x, enemy.y, { life: 0.8, text: `+${enemy.reward}` });
}

function updateWaves(state: GameState, dt: number): void {
  switch (state.wavePhase) {
    case 'preparing': {
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) beginNextWave(state);
      break;
    }
    case 'spawning': {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
        const typeId = state.spawnQueue.shift();
        if (typeId) spawnEnemy(state, typeId, state.currentWave.hpMultiplier);
        state.spawnTimer += state.currentWave.spawnInterval;
      }
      if (state.spawnQueue.length === 0) state.wavePhase = 'clearing';
      break;
    }
    case 'clearing': {
      if (state.enemies.length === 0) {
        state.wavePhase = 'preparing';
        state.waveTimer = WAVE_REST;
      }
      break;
    }
  }
}

function updateEnemies(state: GameState, dt: number): void {
  const survivors: Enemy[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;

    enemy.distance += enemy.speed * dt;

    if (enemy.distance >= PATH_LENGTH) {
      // Llega a la meta: resta una vida y no otorga oro.
      loseLife(state);
      state.stats.leaked += 1;
      const goal = positionAtDistance(PATH_LENGTH);
      addEffect(state, 'leak', goal.x, goal.y, { life: 0.9, text: '-1' });
      continue;
    }

    const position = positionAtDistance(enemy.distance);
    enemy.x = position.x;
    enemy.y = position.y;
    survivors.push(enemy);
  }

  state.enemies = survivors;
}

function fire(state: GameState, tower: Tower, target: Enemy): void {
  const type = towerType(tower.typeId);
  const stats = statsAtLevel(type, tower.level);
  const angle = Math.atan2(target.y - tower.y, target.x - tower.x);

  state.projectiles.push({
    id: state.nextId++,
    x: tower.x,
    y: tower.y,
    targetId: target.id,
    targetX: target.x,
    targetY: target.y,
    speed: type.projectileSpeed,
    damage: stats.damage,
    splashRadius: stats.splashRadius,
    kind: type.projectile,
    canHitGround: type.canTargetGround,
    canHitAir: type.canTargetAir,
    angle,
  });

  tower.cooldown = 1 / stats.fireRate;
  tower.recoil = 1;
}

function updateTowers(state: GameState, dt: number): void {
  for (const tower of state.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    tower.recoil = Math.max(0, tower.recoil - dt * 5);

    const stats = statsAtLevel(towerType(tower.typeId), tower.level);
    const target = findTarget(state, tower, stats.range);
    if (!target) continue;

    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    if (tower.cooldown <= 0) fire(state, tower, target);
  }
}

function updateProjectiles(state: GameState, dt: number): void {
  const flying: Projectile[] = [];

  for (const projectile of state.projectiles) {
    const target = state.enemies.find(
      (enemy) => enemy.id === projectile.targetId && enemy.hp > 0,
    );
    if (target) {
      projectile.targetX = target.x;
      projectile.targetY = target.y;
    }

    const dx = projectile.targetX - projectile.x;
    const dy = projectile.targetY - projectile.y;
    const remaining = Math.hypot(dx, dy);
    const travel = projectile.speed * dt;

    if (remaining <= travel || remaining < 1) {
      projectile.x = projectile.targetX;
      projectile.y = projectile.targetY;
      impact(state, projectile, target ?? null);
      continue;
    }

    projectile.x += (dx / remaining) * travel;
    projectile.y += (dy / remaining) * travel;
    projectile.angle = Math.atan2(dy, dx);
    flying.push(projectile);
  }

  state.projectiles = flying;
}

function impact(state: GameState, projectile: Projectile, target: Enemy | null): void {
  if (projectile.splashRadius > 0) {
    addEffect(state, 'explosion', projectile.targetX, projectile.targetY, {
      life: 0.32,
      radius: projectile.splashRadius,
    });
    const radiusSq = projectile.splashRadius * projectile.splashRadius;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      const hittable = enemy.domain === 'air' ? projectile.canHitAir : projectile.canHitGround;
      if (!hittable) continue;
      const dx = enemy.x - projectile.targetX;
      const dy = enemy.y - projectile.targetY;
      if (dx * dx + dy * dy <= radiusSq) damageEnemy(state, enemy, projectile.damage);
    }
    return;
  }

  if (target) damageEnemy(state, target, projectile.damage);
}

function updateEffects(state: GameState, dt: number): void {
  const alive: typeof state.effects = [];
  for (const effect of state.effects) {
    effect.life -= dt;
    if (effect.life > 0) alive.push(effect);
  }
  state.effects = alive;
}

function removeDeadEnemies(state: GameState): void {
  if (state.enemies.some((enemy) => enemy.hp <= 0)) {
    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  }
}

/** Avanza la simulación. No hace nada si la partida no está en curso. */
export function step(state: GameState, dt: number): void {
  if (state.screen !== 'playing') return;

  state.time += dt;
  updateWaves(state, dt);
  updateEnemies(state, dt);
  updateTowers(state, dt);
  updateProjectiles(state, dt);
  removeDeadEnemies(state);
  updateEffects(state, dt);
  syncShopAffordability(state);

  if (state.lives <= 0) {
    state.screen = 'defeat';
    state.shopSelection = null;
  }
}

/** Ejecuta tantos pasos fijos como quepan en el tiempo transcurrido. */
export function advance(state: GameState, elapsed: number): number {
  let remaining = elapsed;
  let steps = 0;
  while (remaining >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    step(state, FIXED_DT);
    remaining -= FIXED_DT;
    steps += 1;
  }
  return steps >= MAX_STEPS_PER_FRAME ? 0 : remaining;
}
