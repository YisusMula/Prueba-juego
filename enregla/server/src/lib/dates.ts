/** Fecha local YYYY-MM-DD de un instante en una zona horaria IANA. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Hora local (0–23) de un instante. */
export function localHour(instant: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant);
  return Number(h);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  const d = toUtc(date).getUTCDay();
  return d === 0 ? 7 : d;
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function startOfIsoWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function formatDateEs(date: string): string {
  return `${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]} de ${date.slice(0, 4)}`;
}

/** dd/mm/aaaa hh:mm en la zona del local. */
export function formatDateTimeEs(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(instant)
    .replace(',', '');
}
