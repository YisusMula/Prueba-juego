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
  selectedTowerRepairCost,
  selectedTowerSellValue,
  selectedTowerUpgradeCost,
} from '../game/state';
import { describeWave, waveEnemyCount } from '../game/waves';
import type { Records } from '../storage/records';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id} en el HTML`);
  return element as T;
}

export interface HudCallbacks {
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onRetry(): void;
  onUpgrade(): void;
  onRepair(): void;
  onSell(): void;
  onSetPriority(priority: TargetPriority): void;
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
}

export interface HudView {
  speed: number;
  muted: boolean;
  menuDifficulty: DifficultyId;
  records: Records;
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

  private readonly screenMenu = requireElement('screen-menu');
  private readonly screenPause = requireElement('screen-pause');
  private readonly screenDefeat = requireElement('screen-defeat');
  private readonly defeatSummary = requireElement('defeat-summary');
  private readonly defeatRecord = requireElement('defeat-record');
  private readonly screenVictory = requireElement('screen-victory');
  private readonly victorySummary = requireElement('victory-summary');
  private readonly victoryRecord = requireElement('victory-record');

  /** Estado de presentación que no vive en la simulación. */
  private view: HudView;

  constructor(state: GameState, view: HudView, callbacks: HudCallbacks) {
    this.state = state;
    this.view = view;
    this.buildShop();
    this.buildPriorityButtons(callbacks);
    this.buildAbilityBar(callbacks);
    this.buildDifficultyPicker(callbacks);
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

  private syncTowerPanel(): void {
    const tower = getSelectedTower(this.state);
    if (!tower || this.state.screen !== 'playing') {
      this.towerPanel.hidden = true;
      return;
    }

    const type = towerType(tower.typeId);
    const stats = statsAtLevel(type, tower.level);
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

  private syncScreens(): void {
    const screen = this.state.screen;
    this.screenMenu.hidden = screen !== 'menu';
    this.screenPause.hidden = screen !== 'paused';
    this.screenDefeat.hidden = screen !== 'defeat';
    this.screenVictory.hidden = screen !== 'victory';

    if (screen === 'menu') this.syncMenu();

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
      this.victoryRecord.textContent = this.recordLine();
    }
  }

  /** Línea de récord de la dificultad que se acaba de jugar. */
  private recordLine(): string {
    const record = this.view.records[this.state.difficultyId];
    if (!record || record.bestWave <= 0) return '';
    return `Tu mejor marca en esta dificultad: oleada ${record.bestWave}`;
  }

  private syncMenu(): void {
    for (const entry of this.difficultyButtons) {
      entry.button.classList.toggle('is-active', entry.id === this.view.menuDifficulty);
    }

    const record = this.view.records[this.view.menuDifficulty];
    this.menuRecordEl.textContent =
      record && record.bestWave > 0
        ? `🏅 Mejor marca: oleada ${record.bestWave} · ${record.bestKills} criaturas`
        : 'Sin marca todavía. ¡A por las 30 oleadas!';
  }
}
