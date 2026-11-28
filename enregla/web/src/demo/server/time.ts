/**
 * Fechas en la zona horaria del local, sin base de datos (equivalente a los
 * `(fecha::date)::timestamp AT TIME ZONE tz` del servidor).
 */
export { addDays, dayOfMonth, diffDays, eachDay, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from '../../../../server/src/lib/dates';

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

/** Diferencia (ms) entre la hora local de `tz` y UTC en el instante dado. */
function offsetMs(instant: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(instant))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Instante (ms) de la hora local `hour:minute` del día `date` (AAAA-MM-DD) en `tz`. */
export function localInstant(date: string, tz: string, hour = 0, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

/** Inicio (00:00 local) del día. */
export const dayStart = (date: string, tz: string) => localInstant(date, tz);

/** Hora local (0–23). */
export function localHour(instant: number, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(instant)));
}

export const iso = (ms: number) => new Date(ms).toISOString();
