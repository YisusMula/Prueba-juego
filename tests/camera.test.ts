import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampCamera,
  clampZoom,
  createCamera,
  fitCamera,
  minZoomFor,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
} from '../src/game/camera';
import { MAP_HEIGHT, MAP_WIDTH, worldToCell } from '../src/game/map';
import { TAP_MOVE_THRESHOLD, isTap } from '../src/game/gesture';

const phone = { width: 360, height: 520 };
const desktop = { width: 1280, height: 720 };

describe('viewport-navigation: límites de la cámara', () => {
  it('no deja ver fuera del mapa al desplazarse', () => {
    const viewport = desktop;
    let camera = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 1.5 };
    camera = panCamera(camera, viewport, -5000, -5000);

    const halfWidth = viewport.width / camera.zoom / 2;
    const halfHeight = viewport.height / camera.zoom / 2;
    expect(camera.x + halfWidth).toBeLessThanOrEqual(MAP_WIDTH + 1e-6);
    expect(camera.y + halfHeight).toBeLessThanOrEqual(MAP_HEIGHT + 1e-6);

    camera = panCamera(camera, viewport, 99_999, 99_999);
    expect(camera.x - halfWidth).toBeGreaterThanOrEqual(-1e-6);
    expect(camera.y - halfHeight).toBeGreaterThanOrEqual(-1e-6);
  });

  it('centra el mapa cuando cabe entero en el viewport', () => {
    const viewport = { width: 4000, height: 4000 };
    const camera = clampCamera({ x: 0, y: 0, zoom: 1 }, viewport);
    expect(camera.x).toBe(MAP_WIDTH / 2);
    expect(camera.y).toBe(MAP_HEIGHT / 2);
  });
});

describe('viewport-navigation: límites de zoom', () => {
  it('el zoom mínimo muestra el mapa completo', () => {
    for (const viewport of [phone, desktop]) {
      const min = minZoomFor(viewport);
      expect(MAP_WIDTH * min).toBeLessThanOrEqual(viewport.width + 1e-6);
      expect(MAP_HEIGHT * min).toBeLessThanOrEqual(viewport.height + 1e-6);
    }
  });

  it('no se puede alejar más allá del mínimo ni acercar más allá del máximo', () => {
    const min = minZoomFor(desktop);
    expect(clampZoom(0.0001, desktop)).toBeCloseTo(min, 10);
    expect(clampZoom(999, desktop)).toBe(MAX_ZOOM);
  });

  it('fitCamera encuadra el mapa completo y centrado', () => {
    const camera = fitCamera(phone);
    expect(camera.zoom).toBeCloseTo(minZoomFor(phone), 10);
    expect(camera.x).toBe(MAP_WIDTH / 2);
    expect(camera.y).toBe(MAP_HEIGHT / 2);
  });

  it('el zoom mantiene el punto del escenario bajo el cursor', () => {
    const viewport = desktop;
    const camera = clampCamera({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 1 }, viewport);
    const anchor = { x: 400, y: 300 };
    const worldBefore = screenToWorld(camera, viewport, anchor);

    const zoomed = zoomCameraAt(camera, viewport, 1.4, anchor);
    const worldAfter = screenToWorld(zoomed, viewport, anchor);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });
});

describe('viewport-navigation: coordenadas', () => {
  it('pantalla y escenario son conversiones inversas', () => {
    const viewport = desktop;
    const camera = clampCamera({ x: 500, y: 400, zoom: 1.7 }, viewport);
    const point = { x: 613, y: 271 };

    const roundTrip = screenToWorld(camera, viewport, worldToScreen(camera, viewport, point));
    expect(roundTrip.x).toBeCloseTo(point.x, 6);
    expect(roundTrip.y).toBeCloseTo(point.y, 6);
  });

  it('tras desplazar y hacer zoom, la celda pulsada es la que está debajo', () => {
    const viewport = phone;
    let camera = createCamera();
    camera = zoomCameraAt(camera, viewport, 1.8, { x: 180, y: 260 });
    camera = panCamera(camera, viewport, -120, -80);

    const targetCell = { col: 7, row: 5 };
    const targetWorld = { x: (targetCell.col + 0.5) * 64, y: (targetCell.row + 0.5) * 64 };
    const screen = worldToScreen(camera, viewport, targetWorld);
    const back = screenToWorld(camera, viewport, screen);

    expect(worldToCell(back.x, back.y)).toEqual(targetCell);
  });
});

describe('viewport-navigation: pulsación frente a arrastre', () => {
  it('un toque corto y quieto es pulsación', () => {
    expect(isTap({ movedX: 2, movedY: 1, elapsedMs: 120 })).toBe(true);
  });

  it('un arrastre no es pulsación', () => {
    expect(isTap({ movedX: TAP_MOVE_THRESHOLD + 5, movedY: 0, elapsedMs: 120 })).toBe(false);
    expect(isTap({ movedX: 0, movedY: 60, elapsedMs: 200 })).toBe(false);
  });

  it('una pulsación larga tampoco cuenta', () => {
    expect(isTap({ movedX: 1, movedY: 1, elapsedMs: 1500 })).toBe(false);
  });
});
