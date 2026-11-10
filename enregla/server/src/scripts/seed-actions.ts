/** Acciones correctoras de ejemplo (datos de demostración) coherentes con el tipo de equipo. */
const COLD_ACTIONS = [
  'Producto trasladado a otra cámara y termostato regulado',
  'Puerta mal cerrada: se cierra y se vuelve a medir a los 30 min',
  'Aviso al técnico de frío y producto trasladado a otra cámara',
] as const;
const HOT_ACTIONS = [
  'Se recalienta el producto por encima de 75 °C antes del servicio',
  'Se sube la temperatura del equipo y se vuelve a medir a los 30 min',
] as const;
const OTHER_ACTIONS = ['Se revisa el equipo y se vuelve a medir a los 30 min'] as const;

/** Frío (cámara, congelador, vitrina, abatidor) → acciones de frío; mesa caliente → recalentar; otro → neutras. */
export function correctiveActionsFor(type: string): readonly string[] {
  if (type === 'mesa_caliente') return HOT_ACTIONS;
  if (type === 'otro' || type === 'freidora') return OTHER_ACTIONS;
  return COLD_ACTIONS;
}
