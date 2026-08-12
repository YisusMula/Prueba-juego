/**
 * Interfaz en DOM: HUD superior, barra de compra, panel de torre y pantallas.
 *
 * Va en DOM y no en canvas para que el escalado responsive, el foco y los
 * objetivos táctiles funcionen sin reimplementarlos, y para que una pulsación
 * sobre un control nunca llegue al escenario.
 */

import { ABILITY_LIST, type AbilityId, ability } from '../game/abilities';
import { DIFFICULTY_LIST, type DifficultyId, FINAL_WAVE } from '../game/difficulty';
import {
  TARGET_PRIORITIES,
  TOWER_TYPE_LIST,
  type TargetPriority,
  type TowerTypeId,
  statsAtLevel,
  towerType,
} from '../game/towers';
import {
  type GameState,
  abilitySlot,
  callWaveBonus,
  displayedWave,
  getSelectedTower,
  selectShopTower,
  selectedTowerBranches,
  selectedTowerRepairCost,
  selectedTowerSpecialisation,
  selectedTowerSellValue,
  selectedTowerUpgradeCost,
} from '../game/state';
import { describeWave, waveEnemyCount } from '../game/waves';
import { currentTutorialStep, tutorialStepCount, tutorialStepNumber } from '../game/tutorial';
import { SCENARIO_LIST, type ScenarioId } from '../game/scenarios';
import {
  MAX_STARS_PER_SCENARIO,
  isScenarioUnlocked,
  maxStars,
  starsFor,
  totalStars,
  unlockRequirement,
} from '../game/campaign';
import type { Specialisation, SpecialisationId } from '../game/specialisations';
import { getTerrainCanvas } from '../render/terrain';
import { type Records, bestRecordFor, recordFor } from '../storage/records';
import type { SavedRunSummary } from '../storage/savegame';
import { SCENARIOS_BY_NAME } from '../game/scenarios';

/** Estrellas conseguidas sobre el máximo, como fila de símbolos. */
function starRow(stars: number): string {
  const filled = Math.max(0, Math.min(MAX_STARS_PER_SCENARIO, Math.floor(stars)));
  return '★'.repeat(filled) + '☆'.repeat(MAX_STARS_PER_SCENARIO - filled);
}

/** Etiqueta legible de la forma del escenario, a partir de sus rutas. */
function describeRoutes(routes: number, entrances: number): string {
  if (routes <= 1) return '1 carril';
  if (entrances > 1) return `${entrances} entradas`;
  return `${routes} ramales`;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id} en el HTML`);
  return element as T;
}

export interface HudCallbacks {
  onStart(): void;
  onPickScenario(id: ScenarioId): void;
  onBackToMenu(): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onRetry(): void;
  onUpgrade(): void;
  onRepair(): void;
  onSell(): void;
  onSetPriority(priority: TargetPriority): void;
  onSpecialise(id: SpecialisationId): void;
  onCloseTowerPanel(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomFit(): void;
  onSetSpeed(speed: number): void;
  onCallWave(): void;
  onToggleMute(): void;
  onSelectAbility(id: AbilityId): void;
  onSelectDifficulty(id: DifficultyId): void;
  onContinueEndless(): void;
  onSkipTutorial(): void;
  onReplayTutorial(): void;
  onContinueRun(): void;
}

export interface HudView {
  speed: number;
  muted: boolean;
  menuDifficulty: DifficultyId;
  records: Records;
  /** Estrellas del escenario tras la última partida terminada. */
  starsEarned: number;
  /** Escenario que la última victoria acaba de abrir, si abrió alguno. */
  unlockedByWin: { name: string } | null;
  /** La guía de primeros pasos está activa en esta partida. */
  tutorial: boolean;
  /** Partida guardada que se puede reanudar, si la hay. */
  savedRun: SavedRunSummary | null;
}

interface ShopCard {
  typeId: TowerTypeId;
  button: HTMLButtonElement;
  costEl: HTMLElement;
}

export class Hud {
  private readonly state: GameState;

  private readonly livesEl = requireElement('stat-lives');
  private readonly livesWrap = requireElement('stat-lives').parentElement as HTMLElement;
  private readonly goldEl = requireElement('stat-gold');
  private readonly waveEl = requireElement('stat-wave');
  private readonly waveHintEl = requireElement('wave-hint');

  private readonly shopItemsEl = requireElement('shop-items');
  private readonly cards: ShopCard[] = [];

  private readonly towerPanel = requireElement('tower-panel');
  private readonly towerName = requireElement('tower-panel-name');
  private readonly towerLevel = requireElement('tower-panel-level');
  private readonly towerHpFill = requireElement('tower-panel-hp-fill');
  private readonly towerHpText = requireElement('tower-panel-hp-text');
  private readonly towerDamage = requireElement('tower-panel-damage');
  private readonly towerRange = requireElement('tower-panel-range');
  private readonly towerRate = requireElement('tower-panel-rate');
  private readonly towerTargets = requireElement('tower-panel-targets');
  private readonly towerCost = requireElement('tower-panel-cost');
  private readonly upgradeButton = requireElement<HTMLButtonElement>('btn-upgrade');
  private readonly upgradeLabel = requireElement('upgrade-label');
  private readonly upgradePrice = requireElement('upgrade-price');
  private readonly repairButton = requireElement<HTMLButtonElement>('btn-repair');
  private readonly repairCostEl = requireElement('tower-panel-repair-cost');
  private readonly sellButton = requireElement<HTMLButtonElement>('btn-sell');
  private readonly sellValueEl = requireElement('tower-panel-sell-value');
  private readonly priorityButtonsEl = requireElement('priority-buttons');
  private readonly priorityButtons: { id: TargetPriority; button: HTMLButtonElement }[] = [];

  private readonly waveBanner = requireElement('wave-banner');
  private readonly wavePreviewEl = requireElement('wave-preview');
  private readonly waveWarningsEl = requireElement('wave-warnings');
  private readonly callWaveButton = requireElement<HTMLButtonElement>('btn-call-wave');
  private readonly callWaveBonusEl = requireElement('call-wave-bonus');
  private readonly waveProgress = requireElement('wave-progress');
  private readonly waveProgressFill = requireElement('wave-progress-fill');
  private readonly waveProgressText = requireElement('wave-progress-text');

  private readonly speedButtons: { speed: number; button: HTMLButtonElement }[] = [];
  private readonly muteIcon = requireElement('mute-icon');

  private readonly abilityBarEl = requireElement('ability-bar');
  private readonly abilityButtons: {
    id: AbilityId;
    button: HTMLButtonElement;
    cooldownEl: HTMLElement;
    textEl: HTMLElement;
  }[] = [];

  private readonly difficultyPickerEl = requireElement('difficulty-picker');
  private readonly difficultyButtons: { id: DifficultyId; button: HTMLButtonElement }[] = [];
  private readonly menuRecordEl = requireElement('menu-record');
  private readonly menuStarsEl = requireElement('menu-stars');
  private readonly continueButton = requireElement<HTMLButtonElement>('btn-continue');
  private readonly continueDetail = requireElement('continue-detail');

  private readonly branchPicker = requireElement('branch-picker');
  private readonly branchButtonsEl = requireElement('branch-buttons');
  private readonly branchLabel = requireElement('tower-panel-branch');
  private readonly tutorialHint = requireElement('tutorial-hint');
  private readonly tutorialStepEl = requireElement('tutorial-step');
  private readonly tutorialTextEl = requireElement('tutorial-text');
  private readonly screenMenu = requireElement('screen-menu');
  private readonly screenScenarios = requireElement('screen-scenarios');
  private readonly scenarioListEl = requireElement('scenario-list');
  private readonly scenarioTotalEl = requireElement('scenario-total');
  private readonly screenPause = requireElement('screen-pause');
  private readonly screenDefeat = requireElement('screen-defeat');
  private readonly defeatSummary = requireElement('defeat-summary');
  private readonly defeatRecord = requireElement('defeat-record');
  private readonly screenVictory = requireElement('screen-victory');
  private readonly victorySummary = requireElement('victory-summary');
  private readonly victoryRecord = requireElement('victory-record');
  private readonly victoryStars = requireElement('victory-stars');
  private readonly victoryUnlock = requireElement('victory-unlock');

  private readonly scenarioCards: {
    id: ScenarioId;
    card: HTMLButtonElement;
    starsEl: HTMLElement;
    recordEl: HTMLElement;
  }[] = [];

  /**
   * Qué ramas hay pintadas ahora mismo. `sync()` corre en cada frame, y
   * reconstruir los botones cada vez los destruye entre el `pointerdown` y el
   * `pointerup`: en táctil el toque nunca llega a completarse. Con esta clave
   * solo se reconstruyen cuando cambian de verdad.
   */
  private branchKey = '';

  /** Estado de presentación que no vive en la simulación. */
  private view: HudView;

  /** Se guardan porque los botones de rama se crean al sincronizar, no al montar. */
  private readonly callbacks: HudCallbacks;

  constructor(state: GameState, view: HudView, callbacks: HudCallbacks) {
    this.state = state;
    this.view = view;
    this.callbacks = callbacks;
    this.buildShop();
    this.buildPriorityButtons(callbacks);
    this.buildAbilityBar(callbacks);
    this.buildDifficultyPicker(callbacks);
    this.buildScenarioCards(callbacks);
    this.collectSpeedButtons(callbacks);
    this.wire(callbacks);
  }

  /** Actualiza el estado de presentación que la vista debe reflejar. */
  setView(view: HudView): void {
    this.view = view;
  }

  private buildPriorityButtons(callbacks: HudCallbacks): void {
    for (const priority of TARGET_PRIORITIES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-priority';
      button.textContent = priority.name;
      button.addEventListener('click', () => callbacks.onSetPriority(priority.id));
      this.priorityButtonsEl.append(button);
      this.priorityButtons.push({ id: priority.id, button });
    }
  }

  private buildAbilityBar(callbacks: HudCallbacks): void {
    for (const spec of ABILITY_LIST) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ability-btn';
      button.title = `${spec.name} — ${spec.blurb}`;
      button.setAttribute('aria-label', `${spec.name}: ${spec.blurb}`);
      button.textContent = spec.icon;

      const cooldownEl = document.createElement('span');
      cooldownEl.className = 'ability-cooldown';
      const textEl = document.createElement('span');
      textEl.className = 'ability-cooldown-text';

      button.append(cooldownEl, textEl);
      button.addEventListener('click', () => callbacks.onSelectAbility(spec.id));

      this.abilityBarEl.append(button);
      this.abilityButtons.push({ id: spec.id, button, cooldownEl, textEl });
    }
  }

  /**
   * Tarjetas de la pantalla de selección. La miniatura se dibuja con el mismo
   * código que pinta el terreno de la partida, a menor escala: así el jugador
   * ve exactamente el mapa al que va a entrar, sin un dibujo aparte que se
   * quede desincronizado al retocar un trazado.
   */
  private buildScenarioCards(callbacks: HudCallbacks): void {
    for (const scene of SCENARIO_LIST) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'scenario-card';
      card.setAttribute('aria-label', `${scene.name}: ${scene.blurb}`);

      const thumb = document.createElement('div');
      thumb.className = 'scenario-thumb';
      try {
        thumb.append(getTerrainCanvas(scene, 0.2));
      } catch {
        // Sin canvas (entornos sin DOM completo) la tarjeta sigue siendo útil.
      }

      const name = document.createElement('strong');
      name.className = 'scenario-name';
      name.textContent = scene.name;

      const blurb = document.createElement('small');
      blurb.className = 'scenario-blurb';
      blurb.textContent = scene.blurb;

      const lanes = document.createElement('span');
      lanes.className = 'scenario-lanes';
      lanes.textContent = describeRoutes(scene.routes.length, scene.spawnCells.length);

      const starsEl = document.createElement('span');
      starsEl.className = 'scenario-stars';

      const recordEl = document.createElement('span');
      recordEl.className = 'scenario-record';

      card.append(thumb, name, blurb, lanes, starsEl, recordEl);
      card.addEventListener('click', () => callbacks.onPickScenario(scene.id));

      this.scenarioListEl.append(card);
      this.scenarioCards.push({ id: scene.id, card, starsEl, recordEl });
    }
  }

  private buildDifficultyPicker(callbacks: HudCallbacks): void {
    for (const setup of DIFFICULTY_LIST) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-difficulty';
      button.innerHTML = '';

      const name = document.createElement('span');
      name.textContent = setup.name;
      const blurb = document.createElement('small');
      blurb.textContent = setup.blurb;
      button.append(name, blurb);

      button.addEventListener('click', () => callbacks.onSelectDifficulty(setup.id));
      this.difficultyPickerEl.append(button);
      this.difficultyButtons.push({ id: setup.id, button });
    }
  }

  private collectSpeedButtons(callbacks: HudCallbacks): void {
    for (const element of document.querySelectorAll<HTMLButtonElement>('.btn-speed')) {
      const speed = Number(element.dataset.speed ?? '1');
      element.addEventListener('click', () => callbacks.onSetSpeed(speed));
      this.speedButtons.push({ speed, button: element });
    }
  }

  private buildShop(): void {
    for (const type of TOWER_TYPE_LIST) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shop-card';
      button.setAttribute('aria-label', `${type.name}, ${type.cost} de oro. ${type.blurb}`);

      const top = document.createElement('div');
      top.className = 'shop-card-top';

      const swatch = document.createElement('span');
      swatch.className = 'shop-card-swatch';
      swatch.style.background = type.accent;

      const name = document.createElement('span');
      name.className = 'shop-card-name';
      name.textContent = type.name;

      top.append(swatch, name);

      const blurb = document.createElement('span');
      blurb.className = 'shop-card-blurb';
      blurb.textContent = type.blurb;

      const meta = document.createElement('div');
      meta.className = 'shop-card-meta';

      const cost = document.createElement('span');
      cost.className = 'shop-card-cost';
      cost.textContent = `${type.cost} 🪙`;

      const damage = document.createElement('span');
      damage.textContent = `⚔ ${type.damage}`;

      meta.append(cost, damage);
      button.append(top, blurb, meta);

      button.addEventListener('click', () => {
        selectShopTower(this.state, type.id);
        this.sync();
      });

      this.shopItemsEl.append(button);
      this.cards.push({ typeId: type.id, button, costEl: cost });
    }
  }

  private wire(callbacks: HudCallbacks): void {
    requireElement('btn-start').addEventListener('click', callbacks.onStart);
    requireElement('btn-scenarios-back').addEventListener('click', callbacks.onBackToMenu);
    requireElement('btn-skip-tutorial').addEventListener('click', callbacks.onSkipTutorial);
    requireElement('btn-continue').addEventListener('click', callbacks.onContinueRun);
    requireElement('btn-replay-tutorial').addEventListener('click', callbacks.onReplayTutorial);
    requireElement('btn-menu').addEventListener('click', callbacks.onPause);
    requireElement('btn-resume').addEventListener('click', callbacks.onResume);
    requireElement('btn-quit').addEventListener('click', callbacks.onQuit);
    requireElement('btn-retry').addEventListener('click', callbacks.onRetry);
    requireElement('btn-close-panel').addEventListener('click', callbacks.onCloseTowerPanel);
    requireElement('btn-zoom-in').addEventListener('click', callbacks.onZoomIn);
    requireElement('btn-zoom-out').addEventListener('click', callbacks.onZoomOut);
    requireElement('btn-zoom-fit').addEventListener('click', callbacks.onZoomFit);
    this.upgradeButton.addEventListener('click', callbacks.onUpgrade);
    this.repairButton.addEventListener('click', callbacks.onRepair);
    this.sellButton.addEventListener('click', callbacks.onSell);
    this.callWaveButton.addEventListener('click', callbacks.onCallWave);
    requireElement('btn-mute').addEventListener('click', callbacks.onToggleMute);
    requireElement('btn-endless').addEventListener('click', callbacks.onContinueEndless);
    requireElement('btn-victory-menu').addEventListener('click', callbacks.onQuit);
    requireElement('btn-defeat-menu').addEventListener('click', callbacks.onQuit);
  }

  /** Vuelca el estado actual sobre la interfaz. Se llama en cada frame. */
  sync(): void {
    const state = this.state;

    this.livesEl.textContent = String(state.lives);
    this.goldEl.textContent = String(state.gold);
    this.waveEl.textContent = String(displayedWave(state));
    this.livesWrap.classList.toggle('is-low', state.lives <= 5 && state.screen === 'playing');

    this.waveHintEl.textContent =
      state.wavePhase === 'preparing'
        ? `Siguiente oleada en ${Math.max(0, Math.ceil(state.waveTimer))} s`
        : state.wavePhase === 'spawning'
          ? `Quedan ${state.spawnQueue.length} por llegar`
          : `${state.enemies.length} en el prado`;

    for (const card of this.cards) {
      const type = towerType(card.typeId);
      const affordable = state.gold >= type.cost && state.screen === 'playing';
      card.button.disabled = !affordable;
      card.button.classList.toggle('is-selected', state.shopSelection === card.typeId);
      card.costEl.textContent = `${type.cost} 🪙`;
    }

    this.syncSpeedAndSound();
    this.syncWaveBanner();
    this.syncAbilities();
    this.syncTutorial();
    this.syncTowerPanel();
    this.syncScreens();
  }

  private syncSpeedAndSound(): void {
    for (const entry of this.speedButtons) {
      entry.button.classList.toggle('is-active', entry.speed === this.view.speed);
    }
    this.muteIcon.textContent = this.view.muted ? '🔇' : '🔊';
  }

  private syncWaveBanner(): void {
    const state = this.state;
    const playing = state.screen === 'playing';

    // Previsualización: solo mientras se prepara la siguiente oleada.
    const preparing = playing && state.wavePhase === 'preparing';
    this.waveBanner.hidden = !preparing;

    if (preparing) {
      const next = describeWave(state.waveIndex + 1);
      const bonus = callWaveBonus(state);
      this.callWaveBonusEl.textContent = `+${bonus} 🪙`;

      this.wavePreviewEl.replaceChildren(
        ...next.groups.map((group) => {
          const item = document.createElement('span');
          item.className = 'wave-preview-item';
          const count = document.createElement('span');
          count.className = 'wave-preview-count';
          count.textContent = `×${group.count}`;
          item.append(document.createTextNode(group.name), count);
          return item;
        }),
      );

      const warnings: string[] = [];
      if (next.hasAir) warnings.push('✈ Vienen criaturas voladoras');
      if (next.hasTowerAttackers) warnings.push('⚔ Atacan a tus torres');
      if (next.hasPathSkippers) warnings.push('⚠ Se salen del camino');
      if (next.hasArmored) warnings.push('🛡 Acorazadas: prefieren golpes fuertes');
      if (next.hasHealers) warnings.push('✚ Sanadoras: mátalas primero');
      if (next.hasSplitters) warnings.push('◑ Se dividen al morir');
      this.waveWarningsEl.replaceChildren(
        ...warnings.map((text) => {
          const chip = document.createElement('span');
          chip.className = 'wave-warning';
          chip.textContent = text;
          return chip;
        }),
      );
    }

    // Progreso: mientras la oleada está en marcha o quedan enemigos vivos.
    const inWave = playing && state.wavePhase !== 'preparing';
    this.waveProgress.hidden = !inWave;

    if (inWave) {
      const total = waveEnemyCount(state.currentWave);
      const pending = state.spawnQueue.length + state.enemies.length;
      const done = Math.max(0, total - pending);
      const ratio = total > 0 ? done / total : 0;
      this.waveProgressFill.style.width = `${Math.round(ratio * 100)}%`;
      this.waveProgressText.textContent = `${done} / ${total}`;
    }
  }

  private syncAbilities(): void {
    const playing = this.state.screen === 'playing';
    this.abilityBarEl.hidden = !playing;

    for (const entry of this.abilityButtons) {
      const slot = abilitySlot(this.state, entry.id);
      const spec = ability(entry.id);
      const remaining = slot?.cooldown ?? 0;
      const ready = remaining <= 0;

      entry.button.disabled = !ready || !playing;
      entry.button.classList.toggle('is-aiming', this.state.aimingAbility === entry.id);

      // La máscara se vacía de abajo arriba conforme avanza la recarga.
      const ratio = spec.cooldown > 0 ? remaining / spec.cooldown : 0;
      entry.cooldownEl.style.height = `${Math.round(ratio * 100)}%`;
      entry.textEl.textContent = ready ? '' : String(Math.ceil(remaining));
    }
  }

  /** Pista del paso actual, si la guía está activa y queda algún paso. */
  private syncTutorial(): void {
    const step =
      this.view.tutorial && this.state.screen === 'playing'
        ? currentTutorialStep(this.state)
        : null;

    this.tutorialHint.hidden = step === null;
    if (!step) return;

    this.tutorialStepEl.textContent =
      `Paso ${tutorialStepNumber(this.state)} de ${tutorialStepCount()}`;
    this.tutorialTextEl.textContent = step.text;
  }

  private syncTowerPanel(): void {
    const tower = getSelectedTower(this.state);
    if (!tower || this.state.screen !== 'playing') {
      this.towerPanel.hidden = true;
      return;
    }

    const type = towerType(tower.typeId);
    const stats = statsAtLevel(type, tower.level, tower.specialisation);
    const cost = selectedTowerUpgradeCost(this.state);

    this.towerPanel.hidden = false;
    this.towerName.textContent = type.name;
    this.towerLevel.textContent =
      cost === null ? `Nivel ${tower.level} · máximo` : `Nivel ${tower.level} de ${type.maxLevel}`;
    this.towerDamage.textContent = String(stats.damage);
    this.towerRange.textContent = String(stats.range);
    this.towerRate.textContent = `${stats.fireRate.toFixed(1)}/s`;
    this.towerTargets.textContent = type.canTargetAir ? 'Tierra y aire' : 'Solo tierra';

    const hpRatio = stats.maxHp > 0 ? Math.max(0, tower.hp / stats.maxHp) : 0;
    this.towerHpFill.style.width = `${Math.round(hpRatio * 100)}%`;
    this.towerHpFill.classList.toggle('is-low', hpRatio < 0.5);
    this.towerHpFill.classList.toggle('is-down', tower.hp <= 0);
    this.towerHpText.textContent = `${Math.round(tower.hp)}/${stats.maxHp}${tower.hp <= 0 ? ' · fuera de servicio' : ''}`;

    if (cost === null) {
      this.upgradeButton.disabled = true;
      this.upgradeLabel.textContent = 'Nivel máximo';
      this.upgradePrice.hidden = true;
    } else {
      this.upgradeButton.disabled = this.state.gold < cost;
      this.upgradeLabel.textContent = 'Mejorar';
      this.upgradePrice.hidden = false;
      this.towerCost.textContent = String(cost);
    }

    this.syncBranches();

    const repairCost = selectedTowerRepairCost(this.state);
    this.repairButton.hidden = repairCost === null;
    if (repairCost !== null) {
      this.repairButton.disabled = this.state.gold < repairCost;
      this.repairCostEl.textContent = String(repairCost);
    }

    const sellValue = selectedTowerSellValue(this.state);
    this.sellValueEl.textContent = String(sellValue ?? 0);

    for (const entry of this.priorityButtons) {
      entry.button.classList.toggle('is-active', entry.id === tower.priority);
    }
  }

  /** Elección de rama, o la etiqueta de la ya elegida. */
  private syncBranches(): void {
    const chosen = selectedTowerSpecialisation(this.state);
    if (chosen) {
      this.branchLabel.hidden = false;
      this.branchLabel.textContent = `✦ ${chosen.name} · ${chosen.blurb}`;
      this.branchPicker.hidden = true;
      this.renderBranchButtons([]);
      return;
    }

    this.branchLabel.hidden = true;
    const branches = selectedTowerBranches(this.state);
    this.branchPicker.hidden = branches.length === 0;
    this.renderBranchButtons(branches);
  }

  /** Reconstruye los botones de rama solo si han cambiado. */
  private renderBranchButtons(branches: readonly Specialisation[]): void {
    const key = branches.map((branch) => branch.id).join('|');
    if (key === this.branchKey) return;
    this.branchKey = key;

    this.branchButtonsEl.replaceChildren(
      ...branches.map((branch) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-branch';

        const name = document.createElement('strong');
        name.textContent = branch.name;
        const blurb = document.createElement('small');
        blurb.textContent = branch.blurb;
        button.append(name, blurb);

        button.addEventListener('click', () => this.callbacks.onSpecialise(branch.id));
        return button;
      }),
    );
  }

  private syncScreens(): void {
    const screen = this.state.screen;
    this.screenMenu.hidden = screen !== 'menu';
    this.screenScenarios.hidden = screen !== 'scenarios';
    this.screenPause.hidden = screen !== 'paused';
    this.screenDefeat.hidden = screen !== 'defeat';
    this.screenVictory.hidden = screen !== 'victory';

    if (screen === 'menu') this.syncMenu();
    if (screen === 'scenarios') this.syncScenarioPicker();

    if (screen === 'defeat') {
      const { kills, leaked } = this.state.stats;
      this.defeatSummary.textContent =
        `Aguantaste hasta la oleada ${displayedWave(this.state)} de ${FINAL_WAVE}. ` +
        `Eliminaste ${kills} criaturas y ${leaked} llegaron al castillo.`;
      this.defeatRecord.textContent = this.recordLine();
    }

    if (screen === 'victory') {
      const { kills } = this.state.stats;
      this.victorySummary.textContent =
        `Has superado las ${FINAL_WAVE} oleadas con ${this.state.lives} vidas intactas ` +
        `y ${kills} criaturas eliminadas.`;
      const unlocked = this.view.unlockedByWin;
      this.victoryStars.textContent =
        `${starRow(this.view.starsEarned)}  ${this.view.starsEarned} de ${MAX_STARS_PER_SCENARIO}`;
      this.victoryUnlock.hidden = unlocked === null;
      if (unlocked) this.victoryUnlock.textContent = `🔓 Has desbloqueado ${unlocked.name}`;
      this.victoryRecord.textContent = this.recordLine();
    }
  }

  /** Línea de récord del escenario y la dificultad que se acaban de jugar. */
  private recordLine(): string {
    const record = recordFor(this.view.records, this.state.scenarioId, this.state.difficultyId);
    if (record.bestWave <= 0) return '';
    return `Tu mejor marca aquí: oleada ${record.bestWave}`;
  }

  /** Refresca estrellas, candados y récords de las tarjetas de escenario. */
  private syncScenarioPicker(): void {
    const { records } = this.view;

    for (const entry of this.scenarioCards) {
      const unlocked = isScenarioUnlocked(records, entry.id);
      entry.card.disabled = !unlocked;
      entry.card.classList.toggle('is-locked', !unlocked);

      if (!unlocked) {
        const requirement = unlockRequirement(records, entry.id);
        entry.starsEl.textContent = '🔒 Bloqueado';
        entry.recordEl.textContent = requirement ? `Gana ${requirement.name}` : '';
        continue;
      }

      entry.starsEl.textContent = starRow(starsFor(records, entry.id));
      const record = recordFor(records, entry.id, this.view.menuDifficulty);
      entry.recordEl.textContent =
        record.bestWave > 0 ? `🏅 Oleada ${record.bestWave}` : 'Sin jugar';
    }

    this.scenarioTotalEl.textContent = `⭐ ${totalStars(records)} de ${maxStars()} estrellas`;
  }

  private syncMenu(): void {
    for (const entry of this.difficultyButtons) {
      entry.button.classList.toggle('is-active', entry.id === this.view.menuDifficulty);
    }

    this.menuStarsEl.textContent =
      `⭐ ${totalStars(this.view.records)} de ${maxStars()} estrellas`;

    const saved = this.view.savedRun;
    this.continueButton.hidden = saved === null;
    if (saved) {
      const scene = SCENARIOS_BY_NAME(saved.scenarioId);
      this.continueDetail.textContent = ` · ${scene} · oleada ${saved.wave}`;
    }

    const record = bestRecordFor(this.view.records, this.view.menuDifficulty);
    this.menuRecordEl.textContent =
      record.bestWave > 0
        ? `🏅 Mejor marca: oleada ${record.bestWave} · ${record.bestKills} criaturas`
        : 'Sin marca todavía. ¡A por las 30 oleadas!';
  }
}
