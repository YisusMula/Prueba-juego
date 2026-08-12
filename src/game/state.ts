/**
 * Estado de la partida y acciones del jugador.
 *
 * Este módulo no conoce el DOM ni el canvas: todo lo que hay aquí se puede
 * ejecutar y probar en Node.
 */

import { type AbilityId, ABILITY_ORDER, ability } from './abilities';
import { DEFAULT_DIFFICULTY, type DifficultyId, difficulty } from './difficulty';
import { type Domain, type EnemyTypeId, enemyType } from './enemies';
import { CELL, cellCenter, worldToCell } from './map';
import {
  DEFAULT_SCENARIO,
  type Route,
  type Scenario,
  type ScenarioId,
  isBuildableTerrain,
  positionAtDistance,
  routeIndexFor,
  routeOf,
  scenario,
} from './scenarios';
import { MAX_QUEUED_SOUNDS, type SoundId } from './sounds';
import {
  SPECIALISATION_LEVEL,
  type Specialisation,
  type SpecialisationId,
  specialisation,
  specialisationsFor,
} from './specialisations';
import {
  type ProjectileKind,
  type TargetPriority,
  type TowerTypeId,
  repairCost,
  sellRefund,
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
/** Oro de bonus por cada segundo de preparación al que el jugador renuncia. */
export const CALL_WAVE_GOLD_PER_SECOND = 6;

export type Screen = 'menu' | 'scenarios' | 'playing' | 'paused' | 'defeat' | 'victory';
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
  /** Ruta del escenario por la que avanza. No cambia una vez asignada. */
  routeIndex: number;
  /** Distancia recorrida sobre la polilínea de su ruta. */
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
  /**
   * Multiplicador de daño mientras dure la congelación, que deja la torre de
   * hielo con la rama de fragilidad. Vive en el enemigo y no en la torre porque
   * quien aplica el daño extra es la torre que dispara después.
   */
  vulnerability: number;
  /** Segundos restantes del destello blanco al recibir daño. */
  flash: number;
  /** Daño que resta a cada impacto recibido desde una torre. */
  armor: number;
  /** Radio del aura de sanación. 0 si no cura. */
  healRadius: number;
  /** Vida por segundo que restaura a los enemigos de su aura. */
  healPerSecond: number;
  /** Tipo de las crías que deja al morir, o null si no se divide. */
  splitsInto: EnemyTypeId | null;
  /** Cuántas crías deja al morir. */
  splitCount: number;
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
  /** A cuál de los enemigos válidos dispara esta torre. */
  priority: TargetPriority;
  /** Oro total invertido en esta torre: su compra más todas sus mejoras. */
  invested: number;
  /** Rama de mejora elegida, o null si aún no se ha especializado. */
  specialisation: SpecialisationId | null;
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
  /** Ignora la armadura del enemigo (rama perforante). */
  piercing: boolean;
  /** Saltos adicionales del disparo; 0 = sin cadena. */
  chainTargets: number;
  /** Daño que conserva cada salto respecto al anterior. */
  chainFalloff: number;
}

export type EffectKind =
  | 'explosion'
  | 'hit'
  | 'gold'
  | 'leak'
  | 'damage'
  | 'meteor'
  | 'blizzard';

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

/** Estado de recarga de una habilidad del comandante. */
export interface AbilitySlot {
  id: AbilityId;
  /** Segundos que faltan para poder volver a usarla. 0 = lista. */
  cooldown: number;
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
  /** Dificultad de la partida en curso. */
  difficultyId: DifficultyId;
  /** Escenario de la partida en curso. Fijo desde que empieza hasta que acaba. */
  scenarioId: ScenarioId;
  /** Tras ganar, la partida continúa sin condición de victoria. */
  endless: boolean;
  /** Recarga de cada habilidad del comandante. */
  abilities: AbilitySlot[];
  /** Habilidad dirigida esperando a que el jugador señale un punto. */
  aimingAbility: AbilityId | null;
  /** Eventos de sonido pendientes de reproducir por la capa de presentación. */
  soundQueue: SoundId[];
  time: number;
  nextId: number;
  stats: {
    kills: number;
    leaked: number;
    goldEarned: number;
    goldSpent: number;
  };
}

function freshAbilities(): AbilitySlot[] {
  return ABILITY_ORDER.map((id) => ({ id, cooldown: 0 }));
}

/** Escenario sobre el que transcurre la partida. */
export function currentScenario(state: GameState): Scenario {
  return scenario(state.scenarioId);
}

/** Ruta por la que avanza un enemigo. */
export function enemyRoute(state: GameState, enemy: Enemy): Route {
  return routeOf(currentScenario(state), enemy.routeIndex);
}

export function createGameState(
  difficultyId: DifficultyId = DEFAULT_DIFFICULTY,
  scenarioId: ScenarioId = DEFAULT_SCENARIO,
): GameState {
  const setup = difficulty(difficultyId);
  return {
    screen: 'menu',
    lives: setup.startingLives,
    gold: setup.startingGold,
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
    difficultyId,
    scenarioId,
    endless: false,
    abilities: freshAbilities(),
    aimingAbility: null,
    soundQueue: [],
    time: 0,
    nextId: 1,
    stats: { kills: 0, leaked: 0, goldEarned: 0, goldSpent: 0 },
  };
}

/**
 * Reinicia la partida a su estado inicial y la pone en marcha.
 *
 * `unlocked` lo decide quien llama, porque el desbloqueo se deriva de los
 * récords y esos viven fuera de la simulación. Por defecto es cierto: los
 * tests y el reintento no tienen que conocer la campaña para arrancar una
 * partida. Devuelve si la partida ha empezado.
 */
export function startGame(
  state: GameState,
  difficultyId?: DifficultyId,
  scenarioId?: ScenarioId,
  unlocked = true,
): boolean {
  if (!unlocked) return false;
  if (difficultyId) state.difficultyId = difficultyId;
  if (scenarioId) state.scenarioId = scenarioId;
  resetRun(state);
  state.screen = 'playing';
  return true;
}

/** Abre la pantalla de selección de escenario desde el menú principal. */
export function openScenarioPicker(state: GameState, difficultyId?: DifficultyId): void {
  if (difficultyId) state.difficultyId = difficultyId;
  resetRun(state);
  state.screen = 'scenarios';
}

function resetRun(state: GameState): void {
  const setup = difficulty(state.difficultyId);
  state.lives = setup.startingLives;
  state.gold = setup.startingGold;
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
  state.endless = false;
  state.abilities = freshAbilities();
  state.aimingAbility = null;
  state.soundQueue = [];
  state.time = 0;
  state.nextId = 1;
  state.stats = { kills: 0, leaked: 0, goldEarned: 0, goldSpent: 0 };
}

/** Encola un evento de sonido para que lo reproduzca la capa de presentación. */
export function emitSound(state: GameState, id: SoundId): void {
  state.soundQueue.push(id);
  if (state.soundQueue.length > MAX_QUEUED_SOUNDS) {
    state.soundQueue.splice(0, state.soundQueue.length - MAX_QUEUED_SOUNDS);
  }
}

/** Vacía la cola de sonidos y devuelve lo que había. */
export function drainSounds(state: GameState): SoundId[] {
  if (state.soundQueue.length === 0) return [];
  const drained = state.soundQueue;
  state.soundQueue = [];
  return drained;
}

/** Continúa la partida tras la victoria, ya sin condición de victoria. */
export function continueEndless(state: GameState): void {
  if (state.screen !== 'victory') return;
  state.endless = true;
  state.screen = 'playing';
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
  // Elegir una torre cancela el apuntado: son dos intenciones incompatibles
  // sobre el mismo siguiente toque en el escenario.
  state.aimingAbility = null;
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
  if (!isBuildableTerrain(currentScenario(state), col, row)) return false;
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
    specialisation: null,
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
    priority: 'first',
    invested: type.cost,
  };
  state.towers.push(tower);
  state.selectedTowerId = tower.id;
  emitSound(state, 'build');
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

  // El apuntado de una habilidad se atiende antes que nada: el jugador ya ha
  // declarado qué quiere hacer con el siguiente toque.
  if (state.aimingAbility !== null) {
    castAbility(state, state.aimingAbility, worldX, worldY);
    return;
  }

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
  const oldMaxHp = statsAtLevel(type, tower.level, tower.specialisation).maxHp;
  const ratio = oldMaxHp > 0 ? tower.hp / oldMaxHp : 1;
  tower.level += 1;
  tower.hp = Math.round(statsAtLevel(type, tower.level, tower.specialisation).maxHp * ratio);
  tower.invested += cost;

  emitSound(state, 'upgrade');
  syncShopAffordability(state);
  return true;
}

// --- Especializaciones -------------------------------------------------------

/**
 * Las dos ramas que puede elegir la torre seleccionada, o una lista vacía si
 * todavía no le toca o ya eligió. La interfaz consulta esto para saber si debe
 * ofrecer la elección.
 */
export function selectedTowerBranches(state: GameState): readonly Specialisation[] {
  const tower = getSelectedTower(state);
  if (!tower) return [];
  if (tower.specialisation !== null) return [];
  if (tower.level < SPECIALISATION_LEVEL) return [];
  return specialisationsFor(tower.typeId);
}

/** Especialización ya elegida por la torre seleccionada, si la hay. */
export function selectedTowerSpecialisation(state: GameState): Specialisation | null {
  const tower = getSelectedTower(state);
  if (!tower || tower.specialisation === null) return null;
  return specialisation(tower.specialisation);
}

/**
 * Especializa la torre seleccionada.
 *
 * Se rechaza si la torre no ha llegado al nivel, si ya está especializada o si
 * la rama es de otro tipo de torre. La irreversibilidad es lo que convierte
 * esto en una decisión: con vuelta atrás, lo óptimo sería cambiar de rama según
 * la oleada que viene, que es mantenimiento y no elección.
 */
export function specialiseSelectedTower(state: GameState, id: SpecialisationId): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;
  if (tower.specialisation !== null) return false;
  if (tower.level < SPECIALISATION_LEVEL) return false;

  const branch = specialisation(id);
  if (!branch || branch.towerId !== tower.typeId) return false;

  tower.specialisation = id;
  emitSound(state, 'upgrade');
  return true;
}

/** Reembolso que se obtendría al vender la torre seleccionada. */
export function selectedTowerSellValue(state: GameState): number | null {
  const tower = getSelectedTower(state);
  if (!tower) return null;
  return sellRefund(tower.invested);
}

/** Vende la torre seleccionada y devuelve parte de lo invertido en ella. */
export function sellSelectedTower(state: GameState): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;

  addGold(state, sellRefund(tower.invested));
  state.towers = state.towers.filter((candidate) => candidate.id !== tower.id);
  state.selectedTowerId = null;
  emitSound(state, 'sell');
  return true;
}

/** Cambia a quién dispara la torre seleccionada. */
export function setSelectedTowerPriority(state: GameState, priority: TargetPriority): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;
  tower.priority = priority;
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
  const maxHp = statsAtLevel(type, tower.level, tower.specialisation).maxHp;
  if (tower.hp >= maxHp) return null;
  return repairCost(type, tower.hp, maxHp);
}

/** Repara la torre seleccionada a su estructura máxima. Falla sin efecto si falta oro. */
export function repairSelectedTower(state: GameState): boolean {
  if (state.screen !== 'playing') return false;
  const tower = getSelectedTower(state);
  if (!tower) return false;

  const type = towerType(tower.typeId);
  const maxHp = statsAtLevel(type, tower.level, tower.specialisation).maxHp;
  if (tower.hp >= maxHp) return false;

  const cost = repairCost(type, tower.hp, maxHp);
  if (!spendGold(state, cost)) return false;

  tower.hp = maxHp;
  emitSound(state, 'repair');
  syncShopAffordability(state);
  return true;
}

// --- Habilidades del comandante ---------------------------------------------

export function abilitySlot(state: GameState, id: AbilityId): AbilitySlot | null {
  return state.abilities.find((slot) => slot.id === id) ?? null;
}

export function isAbilityReady(state: GameState, id: AbilityId): boolean {
  const slot = abilitySlot(state, id);
  return slot !== null && slot.cooldown <= 0;
}

/**
 * Selecciona una habilidad. Las dirigidas entran en modo de apuntado y
 * esperan a que el jugador señale un punto; las inmediatas se lanzan ya.
 * Volver a seleccionar la que ya está apuntando cancela el apuntado.
 */
export function selectAbility(state: GameState, id: AbilityId | null): boolean {
  if (state.screen !== 'playing') return false;
  if (id === null || state.aimingAbility === id) {
    state.aimingAbility = null;
    return true;
  }
  if (!isAbilityReady(state, id)) return false;

  if (!ability(id).targeted) return castAbility(state, id);

  state.aimingAbility = id;
  // Apuntar cancela la compra pendiente, por el mismo motivo que a la inversa.
  state.shopSelection = null;
  return true;
}

/**
 * Lanza una habilidad. Las dirigidas necesitan un punto del escenario; las
 * inmediatas lo ignoran. El efecto sobre los enemigos lo aplica `step`, que
 * es quien conoce el daño y la congelación: aquí solo se deja el efecto
 * registrado y se pone la habilidad en recarga.
 */
export function castAbility(
  state: GameState,
  id: AbilityId,
  worldX = 0,
  worldY = 0,
): boolean {
  if (state.screen !== 'playing') return false;
  const slot = abilitySlot(state, id);
  if (!slot || slot.cooldown > 0) return false;

  const spec = ability(id);
  slot.cooldown = spec.cooldown;
  state.aimingAbility = null;

  if (spec.targeted) {
    addEffect(state, 'meteor', worldX, worldY, { life: 0.6, radius: spec.radius });
    emitSound(state, 'ability-meteor');

    const radiusSq = spec.radius * spec.radius;
    // Copia de la lista: damageEnemy puede retirar enemigos al matarlos.
    for (const enemy of [...state.enemies]) {
      if (enemy.hp <= 0) continue;
      const dx = enemy.x - worldX;
      const dy = enemy.y - worldY;
      if (dx * dx + dy * dy > radiusSq) continue;
      damageEnemy(state, enemy, spec.damage, true);
      if (spec.freezeDuration > 0) enemy.slowTimer = spec.freezeDuration;
    }
    return true;
  }

  addEffect(state, 'blizzard', 0, 0, { life: 0.8, radius: 0 });
  emitSound(state, 'ability-blizzard');
  for (const enemy of [...state.enemies]) {
    if (enemy.hp <= 0) continue;
    if (spec.damage > 0) damageEnemy(state, enemy, spec.damage, true);
    if (spec.freezeDuration > 0) enemy.slowTimer = spec.freezeDuration;
  }
  return true;
}

// --- Control de oleadas ------------------------------------------------------

/** Oro de bonus que se llevaría el jugador por llamar ya a la siguiente oleada. */
export function callWaveBonus(state: GameState): number {
  if (state.wavePhase !== 'preparing') return 0;
  return Math.max(0, Math.round(state.waveTimer * CALL_WAVE_GOLD_PER_SECOND));
}

/**
 * Llama a la siguiente oleada sin esperar al resto de la preparación, a
 * cambio de oro proporcional al tiempo cedido.
 */
export function callNextWave(state: GameState): boolean {
  if (state.screen !== 'playing') return false;
  if (state.wavePhase !== 'preparing') return false;

  addGold(state, callWaveBonus(state));
  state.waveTimer = 0;
  beginNextWave(state);
  return true;
}

// --- Ayudas de simulación ---------------------------------------------------

export function spawnEnemy(
  state: GameState,
  typeId: EnemyTypeId,
  hpMultiplier: number,
  speedMultiplier = 1,
  /** Sitúa al enemigo en una ruta y una distancia concretas (crías de un divisor). */
  at?: { routeIndex: number; distance: number },
): Enemy {
  const type = enemyType(typeId);
  // La dificultad escala la vida sobre el escalado que ya aplica la oleada.
  const hp = Math.max(
    1,
    Math.round(type.hp * hpMultiplier * difficulty(state.difficultyId).hpMultiplier),
  );
  const id = state.nextId++;
  const scene = currentScenario(state);
  const routeIndex = at ? at.routeIndex : routeIndexFor(scene, id);
  const route = routeOf(scene, routeIndex);
  const distance = at ? at.distance : 0;
  const start = positionAtDistance(route, distance);
  // Punto de fuga determinista a partir del id: variedad entre enemigos sin
  // perder la reproducibilidad de la simulación (nada de aleatoriedad real).
  const breakawayDistance = type.canSkipPath
    ? route.length * (0.2 + (id % 7) / 7 * 0.4)
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
    routeIndex,
    distance,
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
    vulnerability: 1,
    flash: 0,
    armor: type.armor,
    healRadius: type.healRadius,
    healPerSecond: type.healPerSecond,
    splitsInto: type.splitsInto,
    splitCount: type.splitCount,
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

/** Daño mínimo que atraviesa cualquier armadura. */
export const MIN_DAMAGE_THROUGH_ARMOR = 1;

/**
 * Daño que llega de verdad al enemigo tras su armadura.
 *
 * La resta es fija, no un porcentaje: así una arquera de 9 de daño nota la
 * armadura muchísimo más que una ballesta de 55, que es justo la decisión que
 * se le quiere plantear al jugador. El mínimo garantiza que ninguna torre
 * quede incapaz de matar, porque un enemigo inmune es una derrota que el
 * jugador no puede leer.
 */
export function damageAfterArmor(enemy: Enemy, amount: number): number {
  if (enemy.armor <= 0) return amount;
  return Math.max(MIN_DAMAGE_THROUGH_ARMOR, amount - enemy.armor);
}

/**
 * Daño final sobre un enemigo: primero la fragilidad, después la armadura.
 *
 * El orden importa. Al revés, un acorazado vería su daño recortado y luego
 * multiplicado, y la fragilidad valdría mucho más contra armadura que contra
 * el resto: un acoplamiento entre dos mecánicas que no se pretende.
 */
export function effectiveDamage(enemy: Enemy, amount: number, ignoreArmor: boolean): number {
  const amplified = amount * (enemy.slowTimer > 0 ? enemy.vulnerability : 1);
  return ignoreArmor ? amplified : damageAfterArmor(enemy, amplified);
}

/**
 * Aplica daño a un enemigo y, si muere, otorga su recompensa de oro.
 *
 * Vive aquí y no en `step` porque también lo usan las habilidades del
 * comandante, que se lanzan desde las acciones del jugador. Tenerlo en un
 * solo sitio evita que `state` y `step` se importen mutuamente.
 *
 * `ignoreArmor` es lo que distingue a una habilidad de una torre: las
 * habilidades están limitadas por recarga, y su valor está precisamente en
 * resolver la situación que las torres construidas no pueden.
 */
export function damageEnemy(
  state: GameState,
  enemy: Enemy,
  amount: number,
  ignoreArmor = false,
): void {
  if (enemy.hp <= 0) return;
  const applied = effectiveDamage(enemy, amount, ignoreArmor);
  enemy.hp -= applied;
  addEffect(state, 'damage', enemy.x, enemy.y - enemy.radius, {
    life: 0.7,
    text: String(Math.round(applied)),
  });

  if (enemy.hp > 0) {
    enemy.flash = 0.12;
    addEffect(state, 'hit', enemy.x, enemy.y, { life: 0.18, radius: enemy.radius });
    emitSound(state, 'hit');
    return;
  }

  enemy.hp = 0;
  state.stats.kills += 1;
  addGold(state, enemy.reward);
  addEffect(state, 'gold', enemy.x, enemy.y, { life: 0.8, text: `+${enemy.reward}` });
  emitSound(state, 'kill');
  splitEnemy(state, enemy);
}

/**
 * Deja las crías de un enemigo divisor donde murió.
 *
 * Las crías son de un tipo distinto y ese tipo no se divide, así que la
 * recursión queda cortada por construcción y no por un contador de generación
 * que haya que acordarse de propagar.
 */
function splitEnemy(state: GameState, parent: Enemy): void {
  if (!parent.splitsInto || parent.splitCount <= 0) return;

  const scale = parent.maxHp / Math.max(1, enemyType(parent.typeId).hp);
  for (let i = 0; i < parent.splitCount; i += 1) {
    const child = spawnEnemy(state, parent.splitsInto, scale, 1, {
      routeIndex: parent.routeIndex,
      distance: parent.distance,
    });
    // La cría hereda también el estado fuera del camino: si el padre había
    // abandonado la ruta, devolverla al camino la teletransportaría.
    child.offPath = parent.offPath;
    child.offPathStart = { x: parent.offPathStart.x, y: parent.offPathStart.y };
    child.offPathTotal = parent.offPathTotal;
    child.offPathProgress = parent.offPathProgress;
    child.x = parent.x;
    child.y = parent.y;
  }
}

/**
 * Cura de las auras de sanación. Solo afecta a enemigos vivos y nunca sube por
 * encima de la vida máxima, así que un sanador no puede revivir a nadie.
 */
export function applyHealing(state: GameState, dt: number): void {
  const healers = state.enemies.filter((enemy) => enemy.hp > 0 && enemy.healRadius > 0);
  if (healers.length === 0) return;

  for (const healer of healers) {
    const radiusSq = healer.healRadius * healer.healRadius;
    const amount = healer.healPerSecond * dt;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || enemy.hp >= enemy.maxHp) continue;
      const dx = enemy.x - healer.x;
      const dy = enemy.y - healer.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + amount);
    }
  }
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
