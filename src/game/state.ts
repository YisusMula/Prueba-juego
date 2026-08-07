/**
 * Estado de la partida y acciones del jugador.
 *
 * Este módulo no conoce el DOM ni el canvas: todo lo que hay aquí se puede
 * ejecutar y probar en Node.
 */

import { type Domain, type EnemyTypeId, enemyType } from './enemies';
import {
  CELL,
  PATH_LENGTH,
  cellCenter,
  isBuildableTerrain,
  positionAtDistance,
  worldToCell,
} from './map';
import {
  type ProjectileKind,
  type TowerTypeId,
  repairCost,
  statsAtLevel,
  towerType,
  upgradeCost,
} from './towers';
import { type Wave, buildSpawnOrder, getWave } from './waves';

export const STARTING_LIVES = 20;
export const STARTING_GOLD = 150;
/** Segundos antes de que arranque la primera oleada. */
export const FIRST_WAVE_DELAY = 5;
/** Segundos de descanso entre oleadas. */
export const WAVE_REST = 7;

export type Screen = 'menu' | 'playing' | 'paused' | 'defeat';
export type WavePhase = 'preparing' | 'spawning' | 'clearing';

export interface Enemy {
  id: number;
  typeId: EnemyTypeId;
  domain: Domain;
  hp: number;
  maxHp: number;
  speed: number;
  reward: number;
  radius: number;
  /** Distancia recorrida sobre la polilínea del camino. */
  distance: number;
  x: number;
  y: number;
  /** Fase de animación propia, para que no se muevan todos al unísono. */
  phase: number;
  /** Distancia de recorrido a la que este enemigo abandona el camino, si puede hacerlo. Infinito si no. */
  breakawayDistance: number;
  /** Si ya ha abandonado el camino y avanza en línea recta hacia la meta. */
  offPath: boolean;
  offPathStart: { x: number; y: number };
  /** Distancia en línea recta desde offPathStart hasta la meta. */
  offPathTotal: number;
  /** Distancia recorrida en línea recta desde offPathStart. */
  offPathProgress: number;
  /** Torre a la que este enemigo está golpeando, si está en ello. */
  meleeTargetId: number | null;
  /** Segundos restantes del golpe actual contra una torre. */
  meleeTimer: number;
  /** Tras un golpe, segundos en los que no puede volver a engancharse a nada. */
  meleeCooldown: number;
  /** Segundos restantes del efecto de congelación de la torre de hielo. */
  slowTimer: number;
}

export interface Tower {
  id: number;
  typeId: TowerTypeId;
  col: number;
  row: number;
  x: number;
  y: number;
  level: number;
  /** Segundos que faltan para poder volver a disparar. */
  cooldown: number;
  angle: number;
  /** Contador de retroceso visual del cañón. */
  recoil: number;
  /** Estructura actual. Con 0 la torre no dispara hasta repararse. */
  hp: number;
  /** Ids de enemigos que esta torre mantiene congelados (solo relevante en la torre de hielo). */
  frozenTargets: number[];
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  targetId: number;
  targetX: number;
  targetY: number;
  speed: number;
  damage: number;
  splashRadius: number;
  kind: ProjectileKind;
  canHitGround: boolean;
  canHitAir: boolean;
  angle: number;
  /** Torre que disparó el proyectil; permite atribuirle el efecto de congelación. */
  towerId: number;
  /** Si impacta, aplica el efecto de congelación de la torre de hielo. */
  applyFreeze: boolean;
}

export type EffectKind = 'explosion' | 'hit' | 'gold' | 'leak';

export interface Effect {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  text: string;
}

export interface GameState {
  screen: Screen;
  lives: number;
  gold: number;
  /** Oleada en curso o ya completada; 0 antes de la primera. */
  waveIndex: number;
  wavePhase: WavePhase;
  waveTimer: number;
  currentWave: Wave;
  spawnQueue: EnemyTypeId[];
  spawnTimer: number;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  effects: Effect[];
  /** Torre elegida en la barra de compra, pendiente de colocar. */
  shopSelection: TowerTypeId | null;
  /** Torre ya colocada que el jugador ha seleccionado. */
  selectedTowerId: number | null;
  time: number;
  nextId: number;
  stats: {
    kills: number;
    leaked: number;
    goldEarned: number;
    goldSpent: number;
  };
}

export function createGameState(): GameState {
  return {
    screen: 'menu',
    lives: STARTING_LIVES,
    gold: STARTING_GOLD,
    waveIndex: 0,
    wavePhase: 'preparing',
    waveTimer: FIRST_WAVE_DELAY,
    currentWave: getWave(1),
    spawnQueue: [],
    spawnTimer: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    effects: [],
    shopSelection: null,
    selectedTowerId: null,
    time: 0,
    nextId: 1,
    stats: { kills: 0, leaked: 0, goldEarned: 0, goldSpent: 0 },
  };
}

/** Reinicia la partida a su estado inicial y la pone en marcha. */
export function startGame(state: GameState): void {
  resetRun(state);
  state.screen = 'playing';
}

function resetRun(state: GameState): void {
  state.lives = STARTING_LIVES;
  state.gold = STARTING_GOLD;
  state.waveIndex = 0;
  state.wavePhase = 'preparing';
  state.waveTimer = FIRST_WAVE_DELAY;
  state.currentWave = getWave(1);
  state.spawnQueue = [];
  state.spawnTimer = 0;
  state.enemies = [];
  state.towers = [];
  state.projectiles = [];
  state.effects = [];
  state.shopSelection = null;
  state.selectedTowerId = null;
  state.time = 0;
  state.nextId = 1;
  state.stats = { kills: 0, leaked: 0, goldEarned: 0, goldSpent: 0 };
}

export function pauseGame(state: GameState): void {
  if (state.screen === 'playing') state.screen = 'paused';
}

export function resumeGame(state: GameState): void {
  if (state.screen === 'paused') state.screen = 'playing';
}

/** Sale al menú principal descartando la partida en curso. */
export function exitToMenu(state: GameState): void {
  resetRun(state);
  state.screen = 'menu';
}

/** El número de oleada que se muestra al jugador (nunca 0). */
export function displayedWave(state: GameState): number {
  return Math.max(1, state.waveIndex);
}

// --- Economía ---------------------------------------------------------------

export function canAfford(state: GameState, cost: number): boolean {
  return state.gold >= cost;
}

/** Gasta oro. Devuelve false y no modifica nada si el saldo no llega. */
export function spendGold(state: GameState, amount: number): boolean {
  if (amount < 0) return false;
  if (state.gold < amount) return false;
  state.gold -= amount;
  state.stats.goldSpent += amount;
  return true;
}

export function addGold(state: GameState, amount: number): void {
  if (amount <= 0) return;
  state.gold += amount;
  state.stats.goldEarned += amount;
}

export function loseLife(state: GameState, amount = 1): void {
  state.lives = Math.max(0, state.lives - amount);
}

// --- Interacción del jugador ------------------------------------------------

/**
 * Selecciona (o deselecciona) una torre en la barra de compra. Una torre que
 * el jugador no puede pagar no se puede seleccionar.
 */
export function selectShopTower(state: GameState, typeId: TowerTypeId | null): boolean {
  if (state.screen !== 'playing') return false;
  if (typeId === null) {
    state.shopSelection = null;
    return true;
  }
  if (state.shopSelection === typeId) {
    state.shopSelection = null;
    return true;
  }
  if (!canAfford(state, towerType(typeId).cost)) return false;
  state.shopSelection = typeId;
  state.selectedTowerId = null;
  return true;
}

/** Cancela la selección de compra si el oro ha bajado de su coste. */
export function syncShopAffordability(state: GameState): void {
  const selection = state.shopSelection;
  if (selection === null) return;
  if (!canAfford(state, towerType(selection).cost)) {
    state.shopSelection = null;
  }
}

export function towerAt(state: GameState, col: number, row: number): Tower | null {
  return state.towers.find((tower) => tower.col === col && tower.row === row) ?? null;
}

/** ¿Se puede construir en esta celda? Terreno de prado, en el mapa y libre. */
export function canPlaceTower(state: GameState, col: number, row: number): boolean {
  if (!isBuildableTerrain(col, row)) return false;
  return towerAt(state, col, row) === null;
}

/**
 * Coloca la torre seleccionada en la barra de compra. Devuelve false, sin
 * tocar el oro, si el terreno no es válido o falta oro.
 */
export function placeTower(state: GameState, col: number, row: number): boolean {
  if (state.screen !== 'playing') return false;
  const typeId = state.shopSelection;
  if (typeId === null) return false;
  if (!canPlaceTower(state, col, row)) return false;

  const type = towerType(typeId);
  if (!spendGold(state, type.cost)) return false;

  const center = cellCenter(col, row);
  const maxHp = statsAtLevel(type, 1).maxHp;
  const tower: Tower = {
    id: state.nextId++,
    typeId,
    col,
    row,
    x: center.x,
    y: center.y,
    level: 1,
    cooldown: 0,
    angle: 0,
    recoil: 0,
    hp: maxHp,
    frozenTargets: [],
  };
  state.towers.push(tower);
  state.selectedTowerId = tower.id;
  syncShopAffordability(state);
  return true;
}

export function getSelectedTower(state: GameState): Tower | null {
  if (state.selectedTowerId === null) return null;
  return state.towers.find((tower) => tower.id === state.selectedTowerId) ?? null;
}

/**
 * Gestiona una pulsación sobre el escenario: coloca una torre si hay una
 * elegida en la tienda, y si no, selecciona o deselecciona torres.
 */
export function handleWorldTap(state: GameState, worldX: number, worldY: number): void {
  if (state.screen !== 'playing') return;
  const { col, row } = worldToCell(worldX, worldY);

  const existing = towerAt(state, col, row);

  if (state.shopSelection !== null) {
    if (placeTower(state, col, row)) return;
    // La colocación no era válida. Si el jugador ha pulsado sobre una torre
    // suya, lo natural es que quiera verla, no que no pase nada.
    if (existing) state.selectedTowerId = existing.id;
    return;
  }

  state.selectedTowerId = existing ? existing.id : null;
}

export function selectedTowerUpgradeCost(state: GameState): number | null {
  const tower = getSelectedTower(state);
  if (!tower) return null;
  return upgradeCost(towerType(tower.typeId), tower.level);
}

/** Sube de nivel la torre seleccionada. Falla sin efecto si falta oro. */
export function upgradeSelectedTower(state: GameState): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;

  const type = towerType(tower.typeId);
  const cost = upgradeCost(type, tower.level);
  if (cost === null) return false;
  if (!spendGold(state, cost)) return false;

  // La mejora no repara: conserva la misma proporción de daño acumulado,
  // solo aplicada sobre el nuevo máximo de estructura de ese nivel.
  const oldMaxHp = statsAtLevel(type, tower.level).maxHp;
  const ratio = oldMaxHp > 0 ? tower.hp / oldMaxHp : 1;
  tower.level += 1;
  tower.hp = Math.round(statsAtLevel(type, tower.level).maxHp * ratio);

  syncShopAffordability(state);
  return true;
}

/**
 * Coste de reparar la torre seleccionada hasta su estructura máxima. Null si
 * no hay torre seleccionada o si ya está a máxima estructura.
 */
export function selectedTowerRepairCost(state: GameState): number | null {
  const tower = getSelectedTower(state);
  if (!tower) return null;
  const type = towerType(tower.typeId);
  const maxHp = statsAtLevel(type, tower.level).maxHp;
  if (tower.hp >= maxHp) return null;
  return repairCost(type, tower.hp, maxHp);
}

/** Repara la torre seleccionada a su estructura máxima. Falla sin efecto si falta oro. */
export function repairSelectedTower(state: GameState): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;

  const type = towerType(tower.typeId);
  const maxHp = statsAtLevel(type, tower.level).maxHp;
  if (tower.hp >= maxHp) return false;

  const cost = repairCost(type, tower.hp, maxHp);
  if (!spendGold(state, cost)) return false;

  tower.hp = maxHp;
  syncShopAffordability(state);
  return true;
}

// --- Ayudas de simulación ---------------------------------------------------

export function spawnEnemy(
  state: GameState,
  typeId: EnemyTypeId,
  hpMultiplier: number,
  speedMultiplier = 1,
): Enemy {
  const type = enemyType(typeId);
  const hp = Math.round(type.hp * hpMultiplier);
  const start = positionAtDistance(0);
  const id = state.nextId++;
  // Punto de fuga determinista a partir del id: variedad entre enemigos sin
  // perder la reproducibilidad de la simulación (nada de aleatoriedad real).
  const breakawayDistance = type.canSkipPath
    ? PATH_LENGTH * (0.2 + (id % 7) / 7 * 0.4)
    : Infinity;

  const enemy: Enemy = {
    id,
    typeId,
    domain: type.domain,
    hp,
    maxHp: hp,
    speed: type.speed * speedMultiplier,
    reward: type.reward,
    radius: type.radius,
    distance: 0,
    x: start.x,
    y: start.y,
    phase: (id * 0.7) % (Math.PI * 2),
    breakawayDistance,
    offPath: false,
    offPathStart: { x: start.x, y: start.y },
    offPathTotal: 0,
    offPathProgress: 0,
    meleeTargetId: null,
    meleeTimer: 0,
    meleeCooldown: 0,
    slowTimer: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

export function addEffect(
  state: GameState,
  kind: EffectKind,
  x: number,
  y: number,
  options: { life?: number; radius?: number; text?: string } = {},
): void {
  const life = options.life ?? 0.4;
  state.effects.push({
    id: state.nextId++,
    kind,
    x,
    y,
    life,
    maxLife: life,
    radius: options.radius ?? CELL * 0.4,
    text: options.text ?? '',
  });
}

/** Carga la siguiente oleada en la cola de aparición. */
export function beginNextWave(state: GameState): void {
  state.waveIndex += 1;
  const wave = getWave(state.waveIndex);
  state.currentWave = wave;
  state.spawnQueue = buildSpawnOrder(wave);
  state.spawnTimer = 0;
  state.wavePhase = 'spawning';
}
