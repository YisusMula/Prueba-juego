/**
 * Interfaz en DOM: HUD superior, barra de compra, panel de torre y pantallas.
 *
 * Va en DOM y no en canvas para que el escalado responsive, el foco y los
 * objetivos táctiles funcionen sin reimplementarlos, y para que una pulsación
 * sobre un control nunca llegue al escenario.
 */

import { TOWER_TYPE_LIST, type TowerTypeId, statsAtLevel, towerType } from '../game/towers';
import {
  type GameState,
  displayedWave,
  getSelectedTower,
  selectShopTower,
  selectedTowerUpgradeCost,
} from '../game/state';

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
  onCloseTowerPanel(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomFit(): void;
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
  private readonly towerDamage = requireElement('tower-panel-damage');
  private readonly towerRange = requireElement('tower-panel-range');
  private readonly towerRate = requireElement('tower-panel-rate');
  private readonly towerTargets = requireElement('tower-panel-targets');
  private readonly towerCost = requireElement('tower-panel-cost');
  private readonly upgradeButton = requireElement<HTMLButtonElement>('btn-upgrade');
  private readonly upgradeLabel = requireElement('upgrade-label');
  private readonly upgradePrice = requireElement('upgrade-price');

  private readonly screenMenu = requireElement('screen-menu');
  private readonly screenPause = requireElement('screen-pause');
  private readonly screenDefeat = requireElement('screen-defeat');
  private readonly defeatSummary = requireElement('defeat-summary');

  constructor(state: GameState, callbacks: HudCallbacks) {
    this.state = state;
    this.buildShop();
    this.wire(callbacks);
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

    this.syncTowerPanel();
    this.syncScreens();
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
  }

  private syncScreens(): void {
    const screen = this.state.screen;
    this.screenMenu.hidden = screen !== 'menu';
    this.screenPause.hidden = screen !== 'paused';
    this.screenDefeat.hidden = screen !== 'defeat';

    if (screen === 'defeat') {
      const { kills, leaked } = this.state.stats;
      this.defeatSummary.textContent =
        `Aguantaste hasta la oleada ${displayedWave(this.state)}. ` +
        `Eliminaste ${kills} criaturas y ${leaked} llegaron al castillo.`;
    }
  }
}
