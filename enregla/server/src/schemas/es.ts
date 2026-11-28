/**
 * Mensajes de validación en español claro, compartidos por servidor y frontend.
 * Solo depende de `zod` (y de nada del servidor) para poder importarse desde la web.
 *
 * Los mensajes llevan el nombre del campo ("Escribe el nombre", "El lote es demasiado largo…"),
 * así que sirven tanto junto al campo como en un aviso general.
 */
import type { z } from 'zod';

type Gender = 'm' | 'f' | 'mp' | 'fp';
type Verb = 'Escribe' | 'Elige' | 'Indica' | 'Añade' | 'Marca';
interface FieldLabel {
  /** Nombre con artículo: "el nombre", "la temperatura". */
  n: string;
  g: Gender;
  /** Verbo para pedir el dato cuando falta. */
  v: Verb;
}

const f = (n: string, g: Gender = 'm', v: Verb = 'Escribe'): FieldLabel => ({ n, g, v });

/** Nombre legible de cada campo (por la última parte de su ruta). */
export const FIELD_LABELS: Record<string, FieldLabel> = {
  name: f('el nombre'),
  email: f('el email'),
  newEmail: f('el nuevo email'),
  password: f('la contraseña', 'f'),
  currentPassword: f('tu contraseña actual', 'f'),
  newPassword: f('la nueva contraseña', 'f'),
  token: f('el enlace', 'm', 'Indica'),
  businessType: f('el tipo de negocio', 'm', 'Elige'),
  timezone: f('la zona horaria', 'f', 'Elige'),
  reminderEnabled: f('el recordatorio', 'm', 'Indica'),
  reminderHour: f('la hora del recordatorio', 'f', 'Elige'),
  role: f('el rol', 'm', 'Elige'),
  dailyReminder: f('el recordatorio diario', 'm', 'Indica'),
  pin: f('el PIN'),
  active: f('el estado', 'm', 'Indica'),
  type: f('el tipo', 'm', 'Elige'),
  minTemp: f('la temperatura mínima', 'f'),
  maxTemp: f('la temperatura máxima', 'f'),
  checksPerDay: f('el número de controles al día', 'm', 'Elige'),
  frequency: f('la frecuencia', 'f', 'Elige'),
  weekday: f('el día de la semana', 'm', 'Elige'),
  monthDay: f('el día del mes', 'm', 'Elige'),
  items: f('las zonas', 'fp', 'Añade'),
  area: f('la zona', 'f'),
  itemId: f('la zona', 'f', 'Elige'),
  product: f('el producto'),
  products: f('los productos', 'mp'),
  method: f('el método'),
  contactName: f('la persona de contacto', 'f'),
  phone: f('el teléfono'),
  notes: f('las notas', 'fp'),
  value: f('la temperatura', 'f'),
  equipmentId: f('el equipo', 'm', 'Elige'),
  cleaningPlanId: f('el plan de limpieza', 'm', 'Elige'),
  observations: f('las observaciones', 'fp'),
  correctiveAction: f('la acción correctora', 'f', 'Indica'),
  supplierId: f('el proveedor', 'm', 'Elige'),
  supplierName: f('el nombre del proveedor'),
  lot: f('el lote'),
  temperature: f('la temperatura', 'f'),
  maxTemperature: f('la temperatura máxima admisible', 'f'),
  expiryDate: f('la fecha de caducidad', 'f', 'Indica'),
  accepted: f('si aceptas la mercancía', 'm', 'Indica'),
  rejectionReason: f('el motivo del rechazo', 'm', 'Indica'),
  expiredAcceptReason: f('el motivo para aceptar un producto caducado', 'm', 'Indica'),
  temperatureAcceptReason: f('el motivo para aceptar la mercancía', 'm', 'Indica'),
  polarCompounds: f('los compuestos polares', 'mp'),
  action: f('la acción', 'f', 'Indica'),
  result: f('el resultado', 'm', 'Elige'),
  description: f('la descripción', 'f'),
  closed: f('el estado', 'm', 'Elige'),
  traineeStaffId: f('la persona formada', 'f', 'Elige'),
  course: f('el curso'),
  trainingDate: f('la fecha de la formación', 'f', 'Indica'),
  trainer: f('el formador'),
  hours: f('las horas', 'fp'),
  reason: f('el motivo', 'm', 'Indica'),
  staffId: f('quién firma', 'm', 'Elige'),
  category: f('la categoría', 'f'),
  allergens: f('los alérgenos', 'mp', 'Marca'),
  allergensReviewed: f('la revisión de alérgenos', 'f', 'Marca'),
  visible: f('la visibilidad', 'f', 'Indica'),
  enabled: f('el estado', 'm', 'Indica'),
  plan: f('el plan', 'm', 'Elige'),
  from: f('la fecha inicial', 'f', 'Elige'),
  to: f('la fecha final', 'f', 'Elige'),
  types: f('los tipos de registro', 'mp', 'Elige'),
  limit: f('el número de elementos'),
  cursor: f('la página', 'f', 'Elige'),
  category_order: f('el orden de categorías'),
  'Idempotency-Key': f('la clave de idempotencia', 'f', 'Indica'),
};

const GENERIC: FieldLabel = f('este dato');

/** Concordancia: adj('válido', 'f') → "válida". */
function adj(base: string, g: Gender): string {
  const stem = base.slice(0, -1);
  return g === 'm' ? base : g === 'f' ? `${stem}a` : g === 'mp' ? `${stem}os` : `${stem}as`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const verbFor = (g: Gender, singular: string, plural: string) => (g === 'mp' || g === 'fp' ? plural : singular);
/** Número con coma decimal y signo menos tipográfico. */
export const esNumber = (n: number | bigint): string => String(n).replace('.', ',').replace('-', '−');

export function labelFor(path: readonly PropertyKey[] | undefined): FieldLabel {
  if (!path || path.length === 0) return GENERIC;
  for (let i = path.length - 1; i >= 0; i--) {
    const k = path[i];
    if (typeof k === 'string' && FIELD_LABELS[k]) return FIELD_LABELS[k];
  }
  return GENERIC;
}

/** Nombre legible del campo para mostrar al usuario ("Temperatura", "Nombre del proveedor"). */
export function fieldName(path: string): string {
  const parts = path.split('.');
  const l = labelFor(parts);
  return cap(l.n.replace(/^(el|la|los|las|tu|si) /, ''));
}

type Issue = z.core.$ZodRawIssue;

/** Mapa de errores de zod en español. Los mensajes propios de cada esquema tienen prioridad. */
export function esErrorMap(issue: Issue): string | undefined {
  const l = labelFor(issue.path);
  const N = cap(l.n);
  const es = verbFor(l.g, 'es', 'son');
  const debe = verbFor(l.g, 'debe', 'deben');
  const missing = issue.input === undefined || issue.input === null || issue.input === '';
  switch (issue.code) {
    case 'invalid_type':
      if (missing) return `${l.v} ${l.n}`;
      if (issue.expected === 'number') return `${N} ${debe} ser un número`;
      return `${N} no ${es} ${adj('válido', l.g)}`;
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') return min <= 1 ? `${l.v} ${l.n}` : `${N} ${debe} tener al menos ${min} caracteres`;
      if (issue.origin === 'array' || issue.origin === 'set') return min <= 1 ? `${l.v} al menos una` : `Añade al menos ${min}`;
      return issue.inclusive === false ? `${N} ${debe} ser mayor que ${esNumber(min)}` : `${N} no puede ser menor que ${esNumber(min)}`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `${N} ${es} demasiado ${adj('largo', l.g)} (máximo ${max} caracteres)`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Como máximo ${max}`;
      return issue.inclusive === false ? `${N} ${debe} ser menor que ${esNumber(max)}` : `${N} no puede ser mayor que ${esNumber(max)}`;
    }
    case 'invalid_format':
      if (issue.format === 'email') return 'Escribe un email válido (por ejemplo, nombre@dominio.es)';
      if (issue.format === 'uuid' || issue.format === 'guid') return `${l.v} ${l.n}`;
      if (issue.format === 'date') return `${N} no ${es} una fecha válida`;
      if (missing) return `${l.v} ${l.n}`;
      return `${N} no tiene un formato válido`;
    case 'invalid_value':
    case 'invalid_union':
      return missing ? `${l.v} ${l.n}` : `${l.v} una opción válida para ${l.n}`;
    case 'unrecognized_keys':
      return 'Hay datos que no se esperaban';
    case 'not_multiple_of':
      return `${N} no ${es} ${adj('válido', l.g)}`;
    default:
      return `Revisa ${l.n}`;
  }
}

// ---------------------------------------------------------------------------
// Zonas horarias con nombre legible (formularios, PDF)
// ---------------------------------------------------------------------------
export const TIMEZONE_LABELS: Record<string, string> = {
  'Europe/Madrid': 'Hora peninsular y de Baleares',
  'Atlantic/Canary': 'Hora de Canarias',
  'Africa/Ceuta': 'Hora de Ceuta y Melilla',
  'Europe/Lisbon': 'Hora de Portugal',
  'Europe/Andorra': 'Hora de Andorra',
  UTC: 'Hora universal (UTC)',
};

/** Nombre legible de una zona horaria IANA, sin jerga ("Europe/Madrid" → "Hora peninsular y de Baleares"). */
export function timezoneLabel(tz: string): string {
  if (TIMEZONE_LABELS[tz]) return TIMEZONE_LABELS[tz];
  try {
    const part = new Intl.DateTimeFormat('es-ES', { timeZone: tz, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    const city = tz.split('/').pop()?.replace(/_/g, ' ');
    if (part) return city && !part.includes(city) ? `${cap(part)} (${city})` : cap(part);
  } catch {
    // zona desconocida: se muestra la ciudad
  }
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

/**
 * Mensaje general de un error de validación: el del primer campo (que ya nombra el campo) y,
 * si hay más, cuántos quedan. Nunca un texto genérico en inglés ni un código interno.
 */
export function validationSummary(details: { path: string; message: string }[]): string {
  if (details.length === 0) return 'Revisa los datos del formulario';
  const first = details[0]!.message.replace(/\.$/, '');
  const rest = details.length - 1;
  return rest > 0 ? `${first}. Hay ${rest === 1 ? 'otro dato' : `${rest} datos más`} por revisar.` : `${first}.`;
}
