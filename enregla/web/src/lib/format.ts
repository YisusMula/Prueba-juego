/** Formatos es-ES. Las fechas-hora llegan en UTC y se muestran en la zona horaria del local. */

const LOCALE = 'es-ES';

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz ?? ''}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat(LOCALE, opts);
    }
    cache.set(key, f);
  }
  return f;
}

export const formatTime = (iso: string, tz?: string) => dtf(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const formatDateTime = (iso: string, tz?: string) =>
  dtf(tz, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const formatDateShort = (iso: string, tz?: string) => dtf(tz, { day: 'numeric', month: 'short' }).format(new Date(iso));

/** "AAAA-MM-DD" (fecha local, sin hora) → "9 nov 2026". Se interpreta como fecha civil, sin zona. */
export function formatLocalDate(date: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return dtf('UTC', opts).format(new Date(Date.UTC(y, m - 1, d)));
}

export const formatLongDate = (date: string) => formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'long' });

/** Fecha local "AAAA-MM-DD" de un instante en una zona horaria. */
export function localDateIn(tz: string | undefined, at: Date = new Date()): string {
  const parts = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

const numberFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
/** Número calculado con un decimal como mucho: 3,5 · −18 (coma decimal y signo menos tipográfico «−»). */
export const formatNumber = (n: number) => numberFmt.format(n).replace(/^-/, '−');

const exactFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 6 });
/**
 * Dato REGISTRADO por una persona (temperatura, horas, porcentaje de polares…): se muestra tal como se
 * introdujo, sin redondear (27,5 no puede verse como «28»). Igual que el PDF y el CSV.
 */
export const formatDecimal = (n: number) => exactFmt.format(n).replace(/^-/, '−');

/**
 * Porcentaje con el criterio de la RAE: número, espacio fino de no separación y «%» («75 %»).
 * Conserva los decimales introducidos (es el formateador de los datos registrados). Para un porcentaje
 * calculado (cumplimiento) se usa `formatCompliance`, que lo redondea a entero.
 */
export const formatPercent = (n: number | null | undefined) => (n == null ? '—' : `${formatDecimal(n)}\u202F%`);

/** Porcentaje calculado (p. ej. cumplimiento de tareas): entero. */
export const formatCompliance = (n: number | null | undefined) => (n == null ? '—' : formatPercent(Math.round(n)));

/** 3,5 °C · −18 °C */
export const formatTemp = (n: number | null | undefined) => (n == null ? '—' : `${formatDecimal(n)} °C`);

export function formatRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${formatTemp(min)} a ${formatTemp(max)}`;
  if (max != null) return `máx. ${formatTemp(max)}`;
  if (min != null) return `mín. ${formatTemp(min)}`;
  return 'sin límites';
}

export const formatEuros = (n: number) =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);

/**
 * Convierte texto escrito por una persona en número: admite coma decimal, signo menos
 * tipográfico y espacios. Devuelve null si no es un número válido.
 */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace('−', '-').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Valor fuera de [min, max] (límites opcionales). */
export function isOutOfRange(value: number, min: number | null, max: number | null): boolean {
  return (min != null && value < min) || (max != null && value > max);
}

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

export function frequencyLabel(frequency: 'daily' | 'weekly' | 'monthly', weekday?: number | null, monthDay?: number | null): string {
  if (frequency === 'daily') return 'Cada día';
  if (frequency === 'weekly') return weekday ? `Cada ${WEEKDAYS[weekday - 1]}` : 'Semanal';
  return monthDay ? `Día ${monthDay} de cada mes` : 'Mensual';
}

export function relativeDays(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** «Queda 1 tarea» / «Quedan 3 tareas». */
export const quedan = (n: number, one: string, many: string) => (n === 1 ? `Queda 1 ${one}` : `Quedan ${n} ${many}`);

/** Error de un campo numérico escrito a mano: qué se espera (cifras, rango). `null` si está vacío o es válido. */
export function numberFieldError(text: string, opts: { notNumber: string; min: number; max: number; outOfRange: string }): string | null {
  if (!text.trim()) return null;
  const n = parseDecimal(text);
  if (n == null) return opts.notNumber;
  return n < opts.min || n > opts.max ? opts.outOfRange : null;
}
