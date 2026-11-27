import { useEffect, useState } from 'react';

/** Hora actual (ms) que se refresca sola cada `everyMs`: para avisos que dependen de la hora. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * #14: un equipo a «volver a medir» cuya hora de volver a medir (`remeasureFrom`) ya ha llegado. Sin
 * esa hora (lectura fuera de rango sin espera) toca en cuanto se ve. No es una notificación: solo se
 * resalta en pantalla (tablet y «Hoy»).
 */
export function remeasureDue(t: { remeasure?: boolean; remeasureFrom?: string | null }, now: number): boolean {
  if (!t.remeasure) return false;
  if (!t.remeasureFrom) return true;
  return Date.parse(t.remeasureFrom) <= now;
}
