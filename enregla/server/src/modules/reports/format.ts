import type { RecordRow } from '../../db/types.js';
import type { RecordType } from '../../schemas/index.js';
import { formatDateTimeEs } from '../../lib/dates.js';

export type ReportRecord = RecordRow & { amended_by: string | null };

export interface Column {
  header: string;
  /** Peso relativo de anchura en el PDF. */
  weight: number;
}

const num = (v: unknown): string => (typeof v === 'number' ? String(v).replace('.', ',') : '');
const str = (v: unknown): string => (v == null ? '' : String(v));
const range = (min: unknown, max: unknown): string => {
  const a = typeof min === 'number' ? num(min) : null;
  const b = typeof max === 'number' ? num(max) : null;
  if (a && b) return `${a} a ${b} °C`;
  if (b) return `<= ${b} °C`;
  if (a) return `>= ${a} °C`;
  return '—';
};
export const signer = (r: RecordRow): string => [r.staff_name, r.user_name && !r.staff_name ? r.user_name : null].filter(Boolean).join(' / ') || '—';

export function notes(r: ReportRecord): string {
  const parts: string[] = [];
  if (r.amends_record_id) parts.push(`ENMIENDA del registro ${r.amends_record_id.slice(0, 8)}. Motivo: ${r.amendment_reason ?? ''}`);
  if (r.amended_by) parts.push(`Corregido por el registro ${r.amended_by.slice(0, 8)}`);
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
  const when = formatDateTimeEs(r.created_at, tz);
  switch (type) {
    case 'temperatura':
      return [when, str(d.equipmentName), `${num(d.value)} °C`, range(d.minTemp, d.maxTemp), signer(r), str(d.correctiveAction), notes(r)];
    case 'limpieza': {
      const items = (d.items as { area: string; done: boolean }[] | undefined) ?? [];
      const doneCount = items.filter((i) => i.done).length;
      return [
        when,
        str(d.planName),
        `${doneCount}/${items.length}`,
        items.filter((i) => !i.done).map((i) => i.area).join('; '),
        signer(r),
        str(d.observations),
        notes(r),
      ];
    }
    case 'recepcion':
      return [
        when,
        str(d.supplierName),
        str(d.product),
        str(d.lot),
        typeof d.temperature === 'number' ? `${num(d.temperature)} °C` : '',
        esDate(d.expiryDate),
        d.accepted ? 'Aceptada' : `Rechazada: ${str(d.rejectionReason)}`,
        signer(r),
        notes(r),
      ];
    case 'aceite':
      return [
        when,
        str(d.fryerName),
        d.action === 'cambiado' ? 'Cambiado' : 'Revisado',
        typeof d.polarCompounds === 'number' ? `${num(d.polarCompounds)} %` : '',
        signer(r),
        str(d.correctiveAction),
        notes(r),
      ];
    case 'plagas':
      return [when, d.result === 'con_indicios' ? 'Con indicios' : 'Sin indicios', str(d.description), str(d.action), signer(r), notes(r)];
    case 'incidencia':
      return [when, str(d.description), str(d.correctiveAction), d.closed ? 'Cerrada' : 'Abierta', signer(r), notes(r)];
    case 'formacion':
      return [when, str(d.traineeName), str(d.course), esDate(d.trainingDate), str(d.trainer), num(d.hours), signer(r), notes(r)];
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
];

export function csvRow(r: ReportRecord, tz: string): string[] {
  const d = r.data;
  const items = (d.items as { area: string; done: boolean }[] | undefined) ?? [];
  const row: Record<string, string> = {
    id: r.id,
    tipo: r.type,
    fecha_hora: formatDateTimeEs(r.created_at, tz),
    firmado_por_personal: str(r.staff_name),
    firmado_por_usuario: str(r.user_name),
    dispositivo_cocina: r.device_id ? 'sí' : 'no',
    alerta: r.alert ? 'sí' : 'no',
    enmienda_de: str(r.amends_record_id),
    motivo_enmienda: str(r.amendment_reason),
    corregido_por: str(r.amended_by),
    equipo: str(d.equipmentName ?? d.fryerName),
    valor_c: num(d.value),
    minimo_c: num(d.minTemp),
    maximo_c: num(d.maxTemp),
    accion_correctora: str(d.correctiveAction),
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
// PDF: saneado de texto para las fuentes estándar (WinAnsi)
// ---------------------------------------------------------------------------
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfText(value: string, max = 600): string {
  const s = value
    .normalize('NFC')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/−/g, '-')
    // eslint-disable-next-line no-control-regex -- se eliminan caracteres de control a propósito
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch) ? ch : '?';
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
