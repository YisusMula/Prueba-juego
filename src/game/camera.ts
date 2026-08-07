/**
 * Cámara: desplazamiento y zoom acotados, y conversión pantalla↔escenario.
 * Funciones puras para poder probarlas sin navegador.
 */

import { MAP_HEIGHT, MAP_WIDTH, type Point } from './map';

/** Zoom máximo permitido. El mínimo se calcula para que quepa el mapa entero. */
export const MAX_ZOOM = 2.2;

export interface Camera {
  /** Punto del escenario que queda en el centro del viewport. */
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function createCamera(): Camera {
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 1 };
}

/** Zoom mínimo: el que hace que el mapa completo quepa en el viewport. */
export function minZoomFor(viewport: Viewport): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(viewport.width / MAP_WIDTH, viewport.height / MAP_HEIGHT);
}

export function clampZoom(zoom: number, viewport: Viewport): number {
  const min = minZoomFor(viewport);
  const max = Math.max(min, MAX_ZOOM);
  return Math.min(max, Math.max(min, zoom));
}

/** Recorta el centro de la cámara para que nunca se vea fuera del mapa. */
export function clampCamera(camera: Camera, viewport: Viewport): Camera {
  const zoom = clampZoom(camera.zoom, viewport);
  const visibleWidth = viewport.width / zoom;
  const visibleHeight = viewport.height / zoom;

  const x =
    visibleWidth >= MAP_WIDTH
      ? MAP_WIDTH / 2
      : Math.min(MAP_WIDTH - visibleWidth / 2, Math.max(visibleWidth / 2, camera.x));
  const y =
    visibleHeight >= MAP_HEIGHT
      ? MAP_HEIGHT / 2
      : Math.min(MAP_HEIGHT - visibleHeight / 2, Math.max(visibleHeight / 2, camera.y));

  return { x, y, zoom };
}

export function worldToScreen(camera: Camera, viewport: Viewport, world: Point): Point {
  return {
    x: (world.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (world.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Viewport, screen: Point): Point {
  return {
    x: (screen.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (screen.y - viewport.height / 2) / camera.zoom + camera.y,
  };
}

/** Desplaza la cámara según un arrastre en píxeles de pantalla. */
export function panCamera(
  camera: Camera,
  viewport: Viewport,
  screenDx: number,
  screenDy: number,
): Camera {
  return clampCamera(
    { x: camera.x - screenDx / camera.zoom, y: camera.y - screenDy / camera.zoom, zoom: camera.zoom },
    viewport,
  );
}

/**
 * Aplica zoom manteniendo fijo el punto del escenario que hay bajo `anchor`
 * (el cursor o el centro del pellizco), expresado en píxeles de pantalla.
 */
export function zoomCameraAt(
  camera: Camera,
  viewport: Viewport,
  factor: number,
  anchor: Point,
): Camera {
  const targetZoom = clampZoom(camera.zoom * factor, viewport);
  if (targetZoom === camera.zoom) return clampCamera(camera, viewport);

  const worldAnchor = screenToWorld(camera, viewport, anchor);
  const zoomed: Camera = {
    x: worldAnchor.x - (anchor.x - viewport.width / 2) / targetZoom,
    y: worldAnchor.y - (anchor.y - viewport.height / 2) / targetZoom,
    zoom: targetZoom,
  };
  return clampCamera(zoomed, viewport);
}

/** Centra la cámara en el mapa con el zoom que lo muestra completo. */
export function fitCamera(viewport: Viewport): Camera {
  return clampCamera(
    { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: minZoomFor(viewport) },
    viewport,
  );
}

/**
 * Zoom que cubre el viewport: el mapa llena la pantalla aunque sobresalga por
 * un lado. En un móvil en vertical, encajar el mapa entero exige un zoom tan
 * bajo que no se distingue nada; con este el escenario se ve bien y el jugador
 * se desplaza para alcanzar el resto.
 */
export function coverZoomFor(viewport: Viewport): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.max(viewport.width / MAP_WIDTH, viewport.height / MAP_HEIGHT);
}

/** Vista inicial de la partida, centrada en el punto indicado. */
export function initialCamera(viewport: Viewport, focus: Point): Camera {
  const zoom = clampZoom(coverZoomFor(viewport), viewport);
  return clampCamera({ x: focus.x, y: focus.y, zoom }, viewport);
}
