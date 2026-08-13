import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampCamera,
  coverZoomFor,
  initialCamera,
  clampZoom,
  createCamera,
  fitCamera,
  minZoomFor,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
  ensureVisible,
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

  it('la vista inicial cubre la pantalla en vez de dejar franjas vacías', () => {
    const focus = { x: 32, y: 160 };

    for (const viewport of [phone, desktop, { width: 360, height: 500 }]) {
      const camera = initialCamera(viewport, focus);
      // Al menos una dimensión del mapa llena el viewport por completo.
      const coversWidth = MAP_WIDTH * camera.zoom >= viewport.width - 1e-6;
      const coversHeight = MAP_HEIGHT * camera.zoom >= viewport.height - 1e-6;
      expect(coversWidth || coversHeight).toBe(true);

      // Y sigue respetando los límites: nunca se ve fuera del mapa.
      const halfWidth = viewport.width / camera.zoom / 2;
      expect(camera.x - halfWidth).toBeGreaterThanOrEqual(-1e-6);
      expect(camera.x + halfWidth).toBeLessThanOrEqual(MAP_WIDTH + 1e-6);
    }
  });

  it('el zoom inicial respeta el máximo salvo que el mínimo lo obligue', () => {
    // En una pantalla normal, el tope manda.
    expect(initialCamera(desktop, { x: 0, y: 0 }).zoom).toBeLessThanOrEqual(MAX_ZOOM);

    // En una pantalla enorme, ver el mapa completo exige pasarse del tope:
    // el mínimo tiene prioridad, porque la cámara nunca debe salirse del mapa.
    const huge = { width: 3000, height: 3000 };
    expect(initialCamera(huge, { x: 0, y: 0 }).zoom).toBeCloseTo(minZoomFor(huge), 10);
    expect(coverZoomFor(phone)).toBeGreaterThan(minZoomFor(phone));
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

describe('viewport-navigation: la vista sigue al cursor', () => {
  const viewport = { width: 800, height: 600 };

  it('no mueve la cámara si el punto ya se ve', () => {
    const camera = clampCamera({ x: 640, y: 448, zoom: 1 }, viewport);
    const same = ensureVisible(camera, viewport, { x: camera.x + 20, y: camera.y - 20 });

    expect(same).toBe(camera);
  });

  it('desplaza lo justo, no centra', () => {
    const camera = clampCamera({ x: 640, y: 448, zoom: 1 }, viewport);
    // Un punto justo fuera del borde derecho.
    const target = { x: camera.x + viewport.width / 2 + 40, y: camera.y };
    const moved = ensureVisible(camera, viewport, target);

    expect(moved.x).toBeGreaterThan(camera.x);
    // Si centrara, la cámara acabaría en el punto; desplazándose queda antes.
    expect(moved.x).toBeLessThan(target.x);
    expect(moved.y).toBe(camera.y);
  });

  it('deja el punto dentro de la vista', () => {
    const camera = clampCamera({ x: 500, y: 400, zoom: 1.4 }, viewport);
    const target = { x: 1100, y: 780 };
    const moved = ensureVisible(camera, viewport, target);

    const halfWidth = viewport.width / (2 * moved.zoom);
    const halfHeight = viewport.height / (2 * moved.zoom);
    expect(target.x).toBeGreaterThanOrEqual(moved.x - halfWidth - 0.001);
    expect(target.x).toBeLessThanOrEqual(moved.x + halfWidth + 0.001);
    expect(target.y).toBeGreaterThanOrEqual(moved.y - halfHeight - 0.001);
    expect(target.y).toBeLessThanOrEqual(moved.y + halfHeight + 0.001);
  });

  it('nunca deja ver fuera del mapa', () => {
    const camera = clampCamera({ x: 200, y: 200, zoom: 1 }, viewport);
    const moved = ensureVisible(camera, viewport, { x: -500, y: -500 });

    expect(moved).toEqual(clampCamera(moved, viewport));
  });
});
