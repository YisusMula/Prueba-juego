import type { RecordRow } from '../../db/types.js';
import type { RecordType } from '../../schemas/index.js';
import { formatDateTimeEs } from '../../lib/dates.js';

export type ReportRecord = RecordRow & { amended_by: string | null; amended_at?: Date | null; amended_by_name?: string | null };

export interface Column {
  header: string;
  /** Peso relativo de anchura en el PDF. */
  weight: number;
}

/** Número es-ES: coma decimal (en el PDF, además, signo menos tipográfico). */
const num = (v: unknown): string => (typeof v === 'number' ? String(v).replace('.', ',') : '');
const pdfNum = (v: unknown): string => num(v).replace('-', '−');
const str = (v: unknown): string => (v == null ? '' : String(v));
const range = (min: unknown, max: unknown): string => {
  const a = typeof min === 'number' ? pdfNum(min) : null;
  const b = typeof max === 'number' ? pdfNum(max) : null;
  if (a && b) return `${a} a ${b} °C`;
  if (b) return `máx. ${b} °C`;
  if (a) return `mín. ${a} °C`;
  return '—';
};
export const signer = (r: RecordRow): string => [r.staff_name, r.user_name && !r.staff_name ? r.user_name : null].filter(Boolean).join(' / ') || '—';

export function notes(r: ReportRecord, tz = 'UTC'): string {
  const parts: string[] = [];
  if (r.amends_record_id) {
    parts.push(`CORRECCIÓN de un registro anterior, hecha el ${formatDateTimeEs(r.created_at, tz)} por ${signer(r)}. Motivo: ${r.amendment_reason ?? ''}`);
  }
  if (r.amended_by) {
    parts.push(
      r.amended_at
        ? `Corregido el ${formatDateTimeEs(r.amended_at, tz)} por ${r.amended_by_name ?? '—'} (ver la corrección a continuación)`
        : 'Corregido (ver la corrección a continuación)',
    );
  }
  return parts.join(' · ');
}

export const COLUMNS: Record<RecordType, Column[]> = {
  temperatura: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Equipo', weight: 1.6 },
    { header: 'Valor', weight: 0.7 },
    { header: 'Rango', weight: 1 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Acción correctora', weight: 2 },
    { header: 'Notas', weight: 1.6 },
  ],
  limpieza: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Plan', weight: 1.5 },
    { header: 'Realizado', weight: 0.8 },
    { header: 'No realizado', weight: 2 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Observaciones', weight: 1.6 },
    { header: 'Notas', weight: 1.3 },
  ],
  recepcion: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Proveedor', weight: 1.3 },
    { header: 'Producto', weight: 1.4 },
    { header: 'Lote', weight: 0.8 },
    { header: 'T.ª', weight: 0.6 },
    { header: 'Caducidad', weight: 0.9 },
    { header: 'Resultado', weight: 1.4 },
    { header: 'Firma', weight: 1 },
    { header: 'Notas', weight: 1.2 },
  ],
  aceite: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Freidora', weight: 1.4 },
    { header: 'Acción', weight: 0.9 },
    { header: 'C. polares', weight: 0.8 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Acción correctora', weight: 2 },
    { header: 'Notas', weight: 1.5 },
  ],
  plagas: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Resultado', weight: 1 },
    { header: 'Descripción', weight: 2 },
    { header: 'Acción', weight: 2 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Notas', weight: 1.4 },
  ],
  incidencia: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Descripción', weight: 2.4 },
    { header: 'Acción correctora', weight: 2.2 },
    { header: 'Estado', weight: 0.8 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Notas', weight: 1.4 },
  ],
  formacion: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Persona', weight: 1.3 },
    { header: 'Curso / contenido', weight: 2.2 },
    { header: 'Fecha formación', weight: 0.9 },
    { header: 'Entidad / formador', weight: 1.4 },
    { header: 'Horas', weight: 0.6 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Notas', weight: 1.2 },
  ],
};

const esDate = (iso: unknown): string => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export function formatRow(type: RecordType, r: ReportRecord, tz: string): string[] {
  const d = r.data;
  // Fecha del HECHO (en una enmienda, la del registro original); cuándo y quién enmendó va en Notas.
  const when = formatDateTimeEs(r.effective_at, tz);
  switch (type) {
    case 'temperatura':
      return [when, str(d.equipmentName), `${pdfNum(d.value)} °C`, range(d.minTemp, d.maxTemp), signer(r), str(d.correctiveAction), notes(r, tz)];
    case 'limpieza': {
      const items = (d.items as { area: string; done: boolean }[] | undefined) ?? [];
      const doneCount = items.filter((i) => i.done).length;
      return [
        when,
        str(d.planName),
        doneCount === items.length ? `Completa (${doneCount} de ${items.length})` : `Parcial (${doneCount} de ${items.length})`,
        items.filter((i) => !i.done).map((i) => i.area).join('; '),
        signer(r),
        str(d.observations),
        notes(r, tz),
      ];
    }
    case 'recepcion':
      return [
        when,
        str(d.supplierName),
        str(d.product),
        str(d.lot),
        typeof d.temperature === 'number'
          ? `${pdfNum(d.temperature)} °C${typeof d.maxTemperature === 'number' ? ` (máx. ${pdfNum(d.maxTemperature)} °C)` : ''}`
          : '',
        `${esDate(d.expiryDate)}${d.expired ? ' (caducada)' : ''}`,
        d.accepted
          ? `Aceptada${d.correctiveAction ? `. Motivo/acción: ${str(d.correctiveAction)}` : ''}`
          : `Rechazada: ${str(d.rejectionReason)}`,
        signer(r),
        notes(r, tz),
      ];
    case 'aceite':
      return [
        when,
        str(d.fryerName),
        d.action === 'cambiado' ? 'Cambiado' : 'Revisado',
        typeof d.polarCompounds === 'number' ? `${pdfNum(d.polarCompounds)} %` : '',
        signer(r),
        str(d.correctiveAction),
        notes(r, tz),
      ];
    case 'plagas':
      return [when, d.result === 'con_indicios' ? 'Con indicios' : 'Sin indicios', str(d.description), str(d.action), signer(r), notes(r, tz)];
    case 'incidencia':
      return [when, str(d.description), str(d.correctiveAction), d.closed ? 'Cerrada' : 'Abierta', signer(r), notes(r, tz)];
    case 'formacion':
      return [when, str(d.traineeName), str(d.course), esDate(d.trainingDate), str(d.trainer), num(d.hours), signer(r), notes(r, tz)];
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export const CSV_HEADERS = [
  'id',
  'tipo',
  'fecha_hora',
  'firmado_por_personal',
  'firmado_por_usuario',
  'dispositivo_cocina',
  'alerta',
  'enmienda_de',
  'motivo_enmienda',
  'corregido_por',
  'equipo',
  'valor_c',
  'minimo_c',
  'maximo_c',
  'accion_correctora',
  'plan_limpieza',
  'items_realizados',
  'items_no_realizados',
  'observaciones',
  'proveedor',
  'producto',
  'lote',
  'temperatura_c',
  'caducidad',
  'resultado',
  'motivo_rechazo',
  'accion_aceite',
  'compuestos_polares_pct',
  'descripcion',
  'accion',
  'estado',
  'persona_formada',
  'curso',
  'fecha_formacion',
  'formador',
  'horas',
  // Añadidas al final (compatibilidad): hora real de inserción y, en enmiendas, quién enmendó.
  'fecha_registro',
  'enmendado_por',
  // Añadidas en la versión con limpieza parcial y recepción ampliada.
  'estado_limpieza',
  'temperatura_maxima_c',
  'caducada',
];

export function csvRow(r: ReportRecord, tz: string): string[] {
  const d = r.data;
  const items = (d.items as { area: string; done: boolean }[] | undefined) ?? [];
  const row: Record<string, string> = {
    id: r.id,
    tipo: r.type,
    fecha_hora: formatDateTimeEs(r.effective_at, tz),
    fecha_registro: formatDateTimeEs(r.created_at, tz),
    enmendado_por: r.amends_record_id ? signer(r) : '',
    firmado_por_personal: str(r.staff_name),
    firmado_por_usuario: str(r.user_name),
    dispositivo_cocina: r.device_id ? 'sí' : 'no',
    alerta: r.alert ? 'sí' : 'no',
    enmienda_de: str(r.amends_record_id),
    motivo_enmienda: str(r.amendment_reason),
    corregido_por: str(r.amended_by),
    estado_limpieza: r.type === 'limpieza' ? (items.every((i) => i.done) ? 'completa' : `parcial (${items.filter((i) => i.done).length} de ${items.length})`) : '',
    temperatura_maxima_c: num(d.maxTemperature),
    equipo: str(d.equipmentName ?? d.fryerName),
    valor_c: num(d.value),
    minimo_c: num(d.minTemp),
    maximo_c: num(d.maxTemp),
    accion_correctora: str(d.correctiveAction),
    caducada: r.type === 'recepcion' && d.expiryDate ? (d.expired ? 'sí' : 'no') : '',
    plan_limpieza: str(d.planName),
    items_realizados: r.type === 'limpieza' ? items.filter((i) => i.done).map((i) => i.area).join('; ') : '',
    items_no_realizados: r.type === 'limpieza' ? items.filter((i) => !i.done).map((i) => i.area).join('; ') : '',
    observaciones: str(d.observations),
    proveedor: str(d.supplierName),
    producto: str(d.product),
    lote: str(d.lot),
    temperatura_c: num(d.temperature),
    caducidad: esDate(d.expiryDate),
    resultado: r.type === 'recepcion' ? (d.accepted ? 'aceptada' : 'rechazada') : r.type === 'plagas' ? str(d.result) : '',
    motivo_rechazo: str(d.rejectionReason),
    accion_aceite: r.type === 'aceite' ? str(d.action) : '',
    compuestos_polares_pct: num(d.polarCompounds),
    descripcion: str(d.description),
    accion: str(d.action && r.type === 'plagas' ? d.action : ''),
    estado: r.type === 'incidencia' ? (d.closed ? 'cerrada' : 'abierta') : '',
    persona_formada: str(d.traineeName),
    curso: str(d.course),
    fecha_formacion: esDate(d.trainingDate),
    formador: str(d.trainer),
    horas: num(d.hours),
  };
  return CSV_HEADERS.map((h) => row[h] ?? '');
}

/**
 * Celda CSV segura: comillas siempre y prefijo ' en celdas que empiezan por = + - @ (o tab/CR)
 * para evitar inyección de fórmulas. Los números puros (p. ej. -18,5) no se alteran.
 */
export function csvCell(value: string): string {
  let v = value.replace(/\r\n|\r|\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(,\d+)?$/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function csvLine(cells: string[]): string {
  return `${cells.map(csvCell).join(';')}\r\n`;
}

// ---------------------------------------------------------------------------
// PDF: saneado de texto (fuente Unicode embebida, sin recortes)
// ---------------------------------------------------------------------------
/** Marcador para glifos que la fuente no tiene (emojis, escrituras no cubiertas). */
export const MISSING_GLYPH = '□';

/**
 * Prepara un texto para el PDF: NFC, sin caracteres de control y, si se indica `hasGlyph`, con
 * los caracteres sin glifo en la fuente sustituidos por un marcador (consecutivos → uno solo).
 * NUNCA recorta: las celdas crecen y, si hace falta, continúan en la página siguiente.
 */
export function pdfText(value: string, hasGlyph?: (codePoint: number) => boolean): string {
  const s = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- se eliminan caracteres de control a propósito
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\t/g, ' ')
    // Selectores de variación, unión de emojis y modificadores de tono: sin sentido sin el emoji.
    .replace(/\u200D|\uFE0E|\uFE0F|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}/gu, '');
  if (!hasGlyph) return s;
  let out = '';
  let lastMissing = false;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x0a || c === 0x20 || hasGlyph(c)) {
      out += ch;
      lastMissing = false;
    } else if (!lastMissing) {
      out += MISSING_GLYPH;
      lastMissing = true;
    }
  }
  return out;
}
