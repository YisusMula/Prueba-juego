/**
 * Simulación del juego: un paso de tiempo fijo, sin dependencias de navegador.
 */

import { PATH_LENGTH, positionAtDistance } from './map';
import { enemyType } from './enemies';
import { FINAL_WAVE } from './difficulty';
import { frostFreezeCapacity, statsAtLevel, towerType } from './towers';
import { WAVE_REST } from './state';
import type { Enemy, GameState, Projectile, Tower } from './state';
import {
  addEffect,
  beginNextWave,
  damageEnemy,
  emitSound,
  spawnEnemy,
  loseLife,
  syncShopAffordability,
} from './state';

export { damageEnemy };

/** Paso de simulación fijo: la lógica no depende de los FPS del dispositivo. */
export const FIXED_DT = 1 / 60;
/** Tope de pasos por frame, para no encadenar cálculos tras un parón. */
export const MAX_STEPS_PER_FRAME = 5;

/** Cuánto se reduce la velocidad de un enemigo congelado por la torre de hielo. */
export const FREEZE_SLOW_FACTOR = 0.06;
/** Segundos que dura el efecto de congelación tras cada impacto. */
export const FREEZE_DURATION = 1.6;

/**
 * Tras golpear una torre, segundos en los que el enemigo no puede volver a
 * engancharse a ninguna. Un enemigo en golpe no se mueve, así que sin esta
 * pausa seguiría exactamente donde estaba al terminar y se reengancharía a
 * la misma torre en el acto, quedándose clavado para siempre en vez de
 * seguir su camino.
 */
export const MELEE_REENGAGE_COOLDOWN = 1.5;

function canTarget(tower: Tower, enemy: Enemy): boolean {
  const type = towerType(tower.typeId);
  return enemy.domain === 'air' ? type.canTargetAir : type.canTargetGround;
}

/**
 * Progreso comparable hacia la meta, siga o no el enemigo el camino. Un
 * enemigo fuera de camino no actualiza `distance`, así que se aproxima su
 * avance sumando la distancia de fuga y lo recorrido en línea recta desde
 * entonces; ambas magnitudes están en la misma escala de píxeles de mundo.
 */
function effectiveProgress(enemy: Enemy): number {
  if (!enemy.offPath) return enemy.distance;
  return enemy.breakawayDistance + enemy.offPathProgress;
}

/**
 * ¿Es `candidate` mejor objetivo que `best` según la prioridad de la torre?
 * Solo decide entre candidatos que ya han pasado el filtro de validez, así
 * que ninguna prioridad puede hacer que una torre dispare a un enemigo que
 * su tipo no puede atacar.
 */
function isBetterTarget(
  tower: Tower,
  candidate: Enemy,
  best: Enemy,
  candidateDistSq: number,
  bestDistSq: number,
): boolean {
  switch (tower.priority) {
    case 'last':
      return effectiveProgress(candidate) < effectiveProgress(best);
    case 'strongest':
      return candidate.hp > best.hp;
    case 'closest':
      return candidateDistSq < bestDistSq;
    case 'first':
    default:
      return effectiveProgress(candidate) > effectiveProgress(best);
  }
}

/** Enemigo válido elegido según la prioridad de la torre, dentro del alcance. */
export function findTarget(state: GameState, tower: Tower, range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestDistSq = Infinity;

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    if (!canTarget(tower, enemy)) continue;
    const dx = enemy.x - tower.x;
    const dy = enemy.y - tower.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > range * range) continue;

    if (best === null || isBetterTarget(tower, enemy, best, distSq, bestDistSq)) {
      best = enemy;
      bestDistSq = distSq;
    }
  }
  return best;
}

/** Torre viva más cercana dentro del alcance de golpe de un enemigo. */
function findMeleeTarget(
  state: GameState,
  enemy: Enemy,
  range: number,
): Tower | null {
  let best: Tower | null = null;
  let bestDistSq = Infinity;
  for (const tower of state.towers) {
    if (tower.hp <= 0) continue;
    const dx = tower.x - enemy.x;
    const dy = tower.y - enemy.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > range * range) continue;
    if (distSq < bestDistSq) {
      best = tower;
      bestDistSq = distSq;
    }
  }
  return best;
}

/** Resta estructura a la torre que el enemigo está golpeando, si sigue viva. */
function applyMeleeDamage(state: GameState, enemy: Enemy, dpsAmount: number): void {
  const target = state.towers.find((tower) => tower.id === enemy.meleeTargetId);
  if (!target || target.hp <= 0) return;
  target.hp = Math.max(0, target.hp - dpsAmount);
}

/**
 * Intenta aplicar el efecto de congelación de una torre de hielo. Si la
 * torre ya mantiene congelado al enemigo, solo refresca la duración sin
 * gastar cupo; si no, gasta un hueco de su cupo por nivel. Sin cupo libre,
 * el impacto no aplica congelación (pero sí su daño, ya aplicado aparte).
 */
function tryFreeze(state: GameState, towerId: number, enemy: Enemy): void {
  const tower = state.towers.find((t) => t.id === towerId);
  if (!tower) return;

  tower.frozenTargets = tower.frozenTargets.filter((id) => {
    const other = state.enemies.find((candidate) => candidate.id === id);
    return other !== undefined && other.hp > 0 && other.slowTimer > 0;
  });

  const alreadyFrozen = tower.frozenTargets.includes(enemy.id);
  if (!alreadyFrozen) {
    const capacity = frostFreezeCapacity(tower.level);
    if (tower.frozenTargets.length >= capacity) return;
    tower.frozenTargets.push(enemy.id);
  }
  enemy.slowTimer = FREEZE_DURATION;
}

function updateWaves(state: GameState, dt: number): void {
  switch (state.wavePhase) {
    case 'preparing': {
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) {
        beginNextWave(state);
        emitSound(state, 'wave-start');
      }
      break;
    }
    case 'spawning': {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
        const typeId = state.spawnQueue.shift();
        if (typeId) {
          spawnEnemy(state, typeId, state.currentWave.hpMultiplier, state.currentWave.speedMultiplier);
        }
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

function leakEnemy(state: GameState, x: number, y: number): void {
  loseLife(state);
  state.stats.leaked += 1;
  addEffect(state, 'leak', x, y, { life: 0.9, text: '-1' });
  emitSound(state, 'leak');
}

function updateEnemies(state: GameState, dt: number): void {
  const survivors: Enemy[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;

    if (enemy.slowTimer > 0) enemy.slowTimer = Math.max(0, enemy.slowTimer - dt);
    if (enemy.flash > 0) enemy.flash = Math.max(0, enemy.flash - dt);
    if (enemy.meleeCooldown > 0) enemy.meleeCooldown = Math.max(0, enemy.meleeCooldown - dt);

    // Un enemigo que está golpeando una torre no avanza mientras dura el golpe.
    if (enemy.meleeTimer > 0) {
      enemy.meleeTimer = Math.max(0, enemy.meleeTimer - dt);
      const type = enemyType(enemy.typeId);
      applyMeleeDamage(state, enemy, type.meleeDps * dt);
      if (enemy.meleeTimer <= 0) enemy.meleeCooldown = MELEE_REENGAGE_COOLDOWN;
      survivors.push(enemy);
      continue;
    }

    const type = enemyType(enemy.typeId);
    if (type.canDamageTowers && enemy.meleeCooldown <= 0) {
      const target = findMeleeTarget(state, enemy, type.meleeRange);
      if (target) {
        enemy.meleeTargetId = target.id;
        enemy.meleeTimer = type.meleeDuration;
        applyMeleeDamage(state, enemy, type.meleeDps * dt);
        survivors.push(enemy);
        continue;
      }
    }

    const effectiveSpeed = enemy.slowTimer > 0 ? enemy.speed * FREEZE_SLOW_FACTOR : enemy.speed;

    if (type.canSkipPath && !enemy.offPath && enemy.distance >= enemy.breakawayDistance) {
      enemy.offPath = true;
      enemy.offPathStart = { x: enemy.x, y: enemy.y };
      const goal = positionAtDistance(PATH_LENGTH);
      enemy.offPathTotal = Math.hypot(goal.x - enemy.x, goal.y - enemy.y);
      enemy.offPathProgress = 0;
    }

    if (enemy.offPath) {
      enemy.offPathProgress += effectiveSpeed * dt;
      if (enemy.offPathProgress >= enemy.offPathTotal) {
        const goal = positionAtDistance(PATH_LENGTH);
        leakEnemy(state, goal.x, goal.y);
        continue;
      }
      const t = enemy.offPathTotal > 0 ? enemy.offPathProgress / enemy.offPathTotal : 1;
      const goal = positionAtDistance(PATH_LENGTH);
      enemy.x = enemy.offPathStart.x + (goal.x - enemy.offPathStart.x) * t;
      enemy.y = enemy.offPathStart.y + (goal.y - enemy.offPathStart.y) * t;
      survivors.push(enemy);
      continue;
    }

    enemy.distance += effectiveSpeed * dt;
    if (enemy.distance >= PATH_LENGTH) {
      const goal = positionAtDistance(PATH_LENGTH);
      leakEnemy(state, goal.x, goal.y);
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
    towerId: tower.id,
    applyFreeze: type.id === 'frost',
  });

  emitSound(state, SHOT_SOUNDS[type.id]);
  tower.cooldown = 1 / stats.fireRate;
  tower.recoil = 1;
}

/** Cada tipo de torre suena distinto al disparar. */
const SHOT_SOUNDS = {
  archer: 'shoot-arrow',
  cannon: 'shoot-cannon',
  mortar: 'shoot-mortar',
  ballista: 'shoot-bolt',
  magic: 'shoot-magic',
  frost: 'shoot-frost',
} as const;

function updateTowers(state: GameState, dt: number): void {
  for (const tower of state.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    tower.recoil = Math.max(0, tower.recoil - dt * 5);

    // Sin estructura, la torre no adquiere objetivo ni dispara hasta repararse.
    if (tower.hp <= 0) continue;

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

  if (target) {
    damageEnemy(state, target, projectile.damage);
    if (projectile.applyFreeze && target.hp > 0) tryFreeze(state, projectile.towerId, target);
  }
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

function updateAbilities(state: GameState, dt: number): void {
  for (const slot of state.abilities) {
    if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dt);
  }
}

/**
 * ¿Se ha completado la oleada final? Es el mismo criterio que usa la fase de
 * limpieza para dar una oleada por terminada: nada pendiente de aparecer y
 * nada vivo en el escenario.
 */
function hasClearedFinalWave(state: GameState): boolean {
  return (
    !state.endless &&
    state.waveIndex >= FINAL_WAVE &&
    state.spawnQueue.length === 0 &&
    state.enemies.length === 0
  );
}

/** Avanza la simulación. No hace nada si la partida no está en curso. */
export function step(state: GameState, dt: number): void {
  if (state.screen !== 'playing') return;

  state.time += dt;
  updateAbilities(state, dt);
  updateWaves(state, dt);
  updateEnemies(state, dt);
  updateTowers(state, dt);
  updateProjectiles(state, dt);
  removeDeadEnemies(state);
  updateEffects(state, dt);
  syncShopAffordability(state);

  // La derrota manda sobre la victoria: quedarse sin vidas en la última
  // oleada es perder, aunque ese mismo paso la deje despejada.
  if (state.lives <= 0) {
    state.screen = 'defeat';
    state.shopSelection = null;
    state.aimingAbility = null;
    emitSound(state, 'defeat');
    return;
  }

  if (hasClearedFinalWave(state)) {
    state.screen = 'victory';
    state.shopSelection = null;
    state.aimingAbility = null;
    emitSound(state, 'victory');
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
