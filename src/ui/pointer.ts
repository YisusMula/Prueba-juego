/**
 * Entrada sobre el escenario. Ratón y dedos pasan por el mismo camino
 * (Pointer Events), de modo que las reglas de arrastre y pulsación no se
 * escriben dos veces.
 */

import {
  type Camera,
  type Viewport,
  panCamera,
  screenToWorld,
  zoomCameraAt,
} from '../game/camera';
import { isTap } from '../game/gesture';

interface ActivePointer {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  movedX: number;
  movedY: number;
  startedAt: number;
}

export interface PointerHandlers {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  getViewport(): Viewport;
  /** Pulsación limpia sobre el escenario, en coordenadas de mundo. */
  onTap(worldX: number, worldY: number): void;
  /** Posición del puntero en píxeles de pantalla, o null al salir. */
  onHover(screen: { x: number; y: number } | null): void;
  onPanStateChange(panning: boolean): void;
}

const ZOOM_STEP_WHEEL = 0.0016;

export function attachPointerControls(
  canvas: HTMLCanvasElement,
  handlers: PointerHandlers,
): () => void {
  const pointers = new Map<number, ActivePointer>();
  let pinchDistance = 0;
  let panning = false;

  const toLocal = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const setPanning = (value: boolean): void => {
    if (panning === value) return;
    panning = value;
    handlers.onPanStateChange(value);
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const local = toLocal(event);
    pointers.set(event.pointerId, {
      id: event.pointerId,
      startX: local.x,
      startY: local.y,
      lastX: local.x,
      lastY: local.y,
      movedX: 0,
      movedY: 0,
      startedAt: performance.now(),
    });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a && b) pinchDistance = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const local = toLocal(event);
    handlers.onHover(local);

    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;

    const dx = local.x - pointer.lastX;
    const dy = local.y - pointer.lastY;
    pointer.lastX = local.x;
    pointer.lastY = local.y;
    pointer.movedX += Math.abs(dx);
    pointer.movedY += Math.abs(dy);

    if (pointers.size === 1) {
      if (pointer.movedX + pointer.movedY > 6) setPanning(true);
      handlers.setCamera(panCamera(handlers.getCamera(), handlers.getViewport(), dx, dy));
      return;
    }

    if (pointers.size === 2) {
      setPanning(true);
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (pinchDistance > 0 && distance > 0) {
        const factor = distance / pinchDistance;
        const anchor = { x: (a.lastX + b.lastX) / 2, y: (a.lastY + b.lastY) / 2 };
        handlers.setCamera(
          zoomCameraAt(handlers.getCamera(), handlers.getViewport(), factor, anchor),
        );
      }
      pinchDistance = distance;
    }
  };

  const finishPointer = (event: PointerEvent, cancelled: boolean): void => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) setPanning(false);
    if (!pointer || cancelled) return;

    // Un pellizco nunca cuenta como pulsación.
    if (pinchDistance > 0) return;

    const sample = {
      movedX: pointer.movedX,
      movedY: pointer.movedY,
      elapsedMs: performance.now() - pointer.startedAt,
    };
    if (!isTap(sample)) return;

    const world = screenToWorld(handlers.getCamera(), handlers.getViewport(), {
      x: pointer.lastX,
      y: pointer.lastY,
    });
    handlers.onTap(world.x, world.y);
  };

  const onPointerUp = (event: PointerEvent): void => finishPointer(event, false);
  const onPointerCancel = (event: PointerEvent): void => finishPointer(event, true);
  const onPointerLeave = (): void => handlers.onHover(null);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * ZOOM_STEP_WHEEL);
    handlers.setCamera(
      zoomCameraAt(handlers.getCamera(), handlers.getViewport(), factor, toLocal(event)),
    );
  };

  const onContextMenu = (event: Event): void => event.preventDefault();

  /*
   * Tras un toque, el navegador emite los eventos de ratón de compatibilidad,
   * incluido un `click`. Ese click fantasma se dirige al elemento que hay bajo
   * el dedo *en ese momento*: si la pulsación acaba de colocar una torre, el
   * panel de la torre ya está ahí y el click cae sobre el botón de mejora,
   * gastando oro sin que el jugador lo haya pedido. Cancelar `touchend` es lo
   * único que suprime también el click; hacerlo es seguro porque el escenario
   * ya declara `touch-action: none`.
   */
  const onTouchEnd = (event: TouchEvent): void => event.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('touchend', onTouchEnd);
  };
}
