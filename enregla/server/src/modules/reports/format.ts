import type { RecordRow } from '../../db/types.js';
import { COOKING_PROCESS_LABELS, RECEPTION_CATEGORY_LABELS, recordCorrector, recordSignature, type CookingProcess, type ReceptionCategory, type RecordType } from '../../schemas/index.js';
import { formatDateTimeEs } from '../../lib/dates.js';

export type ReportRecord = Omit<RecordRow, 'seq'> & {
  seq?: number;
  amended_by: string | null;
  amended_at?: Date | null;
  /** Quién hizo la corrección que sustituye a este registro (usuario en la web, empleado en la tablet). */
  amended_by_name?: string | null;
  /** En una corrección: quién figuraba como autor en la versión anterior (empleado o, si no, usuario). */
  amends_signer?: string | null;
  /** Inicio de enfriamiento: id del registro que lo cierra (null = sin cerrar). */
  closed_by?: string | null;
  /** Inicio de enfriamiento: hora del cierre. */
  closed_at?: Date | null;
};

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
type SignerRow = Pick<RecordRow, 'staff_name' | 'user_name' | 'device_id' | 'amends_record_id'>;
/** Firma: «Ana Martín (anotado por Laura Gil)» si un usuario lo anotó en la web para un empleado. */
export const signer = (r: SignerRow): string =>
  recordSignature({ staffName: r.staff_name, userName: r.user_name, deviceId: r.device_id, isAmendment: r.amends_record_id != null });
/** Autor de una corrección: quien la hizo (nunca el firmante del original). */
export const corrector = (r: Pick<RecordRow, 'staff_name' | 'user_name'>): string => recordCorrector({ staffName: r.staff_name, userName: r.user_name });

/** La corrección cambió la persona que figura como autora del hecho. */
const signerChanged = (r: ReportRecord): boolean => r.amends_record_id != null && r.amends_signer != null && r.amends_signer !== (r.staff_name ?? r.user_name);

export function notes(r: ReportRecord, tz = 'UTC'): string {
  const parts: string[] = [];
  // 1.12: una lectura fuera de rango cuenta como control hecho, pero «con alerta» (también en el PDF).
  if (r.type === 'temperatura' && r.alert && !r.amended_by) parts.push('Hecho con alerta: lectura fuera de rango');
  if (r.amends_record_id) {
    const changed = signerChanged(r) ? ` · Firmante anterior: ${r.amends_signer}` : '';
    parts.push(
      `CORRECCIÓN de un registro anterior. Firmó: ${signer(r)} · Corrigió: ${corrector(r)} el ${formatDateTimeEs(r.created_at, tz)} · Motivo: ${r.amendment_reason ?? ''}${changed}`,
    );
  }
  if (r.type === 'enfriamiento' && (r.data as { phase?: string }).phase === 'inicio' && r.amends_record_id == null) {
    parts.push(r.closed_at ? `Cerrado el ${formatDateTimeEs(r.closed_at, tz)} (ver el cierre)` : 'SIN CERRAR: no consta el final del enfriamiento');
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
    { header: 'Lote', weight: 0.7 },
    { header: 'T.ª (límite)', weight: 1.2 },
    { header: 'Caducidad', weight: 0.8 },
    { header: 'Resultado', weight: 1.5 },
    { header: 'Firma', weight: 1.1 },
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
  cocinado: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Producto', weight: 1.6 },
    { header: 'Proceso', weight: 1 },
    { header: 'T.ª en el centro', weight: 0.8 },
    { header: 'Referencia orientativa del local', weight: 1 },
    { header: 'Tiempo', weight: 0.6 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Acción correctora', weight: 1.7 },
    { header: 'Notas', weight: 1.4 },
  ],
  enfriamiento: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Producto', weight: 1.5 },
    { header: 'Fase', weight: 0.7 },
    { header: 'Temperaturas', weight: 1.3 },
    { header: 'Tiempo (criterio)', weight: 1.3 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Acción correctora', weight: 1.6 },
    { header: 'Notas', weight: 1.5 },
  ],
  personalizado: [
    { header: 'Fecha y hora', weight: 1.1 },
    { header: 'Registro', weight: 1.3 },
    { header: 'Resultado', weight: 1.1 },
    { header: 'Detalle', weight: 2 },
    { header: 'Firma', weight: 1.1 },
    { header: 'Acción correctora', weight: 1.6 },
    { header: 'Notas', weight: 1.3 },
  ],
};

/** «3 de 5 correctos» / valor con unidad / Sí-No de un registro personalizado. */
export function customResult(d: Record<string, unknown>): string {
  if (d.kind === 'checklist') {
    const items = (d.items as { ok: boolean }[] | undefined) ?? [];
    const ok = items.filter((i) => i.ok).length;
    return ok === items.length ? `Todo correcto (${ok} de ${items.length})` : `No conforme (${ok} de ${items.length} correctos)`;
  }
  if (d.kind === 'numeric') return `${pdfNum(d.reading)}${d.unit ? ` ${str(d.unit)}` : ''}${d.outOfRange ? ' (fuera de rango)' : ''}`;
  return d.answer === true ? 'Sí' : d.answer === false ? 'No' : '';
}

/** Detalle de un registro personalizado: puntos no conformes, rango o pregunta. */
export function customDetail(d: Record<string, unknown>): string {
  if (d.kind === 'checklist') {
    const bad = ((d.items as { label: string; ok: boolean }[] | undefined) ?? []).filter((i) => !i.ok).map((i) => i.label);
    return bad.length ? `No cumple: ${bad.join('; ')}` : '';
  }
  if (d.kind === 'numeric') {
    const unit = d.unit ? ` ${str(d.unit)}` : '';
    const a = typeof d.min === 'number' ? pdfNum(d.min) : null;
    const b = typeof d.max === 'number' ? pdfNum(d.max) : null;
    return a && b ? `Rango: ${a} a ${b}${unit}` : a ? `Mínimo: ${a}${unit}` : b ? `Máximo: ${b}${unit}` : '';
  }
  return '';
}

/** Texto de temperaturas y tiempos de un registro de enfriamiento (inicio o cierre). */
function coolingTemps(d: Record<string, unknown>): string {
  if (d.phase === 'inicio') {
    const below = d.belowStartReference
      ? ` (por debajo de ${pdfNum(d.startReferenceTemp)} °C (referencia orientativa); motivo: ${str(d.startReason)})`
      : '';
    return `Inicio: ${pdfNum(d.startTemp)} °C${below}`;
  }
  const end = d.discarded ? (typeof d.endTemp === 'number' ? `${pdfNum(d.endTemp)} °C (desechado)` : 'Desechado sin medir') : `${pdfNum(d.endTemp)} °C`;
  return `Inicio: ${typeof d.startTemp === 'number' ? `${pdfNum(d.startTemp)} °C` : '—'} → fin: ${end}`;
}
function coolingTime(d: Record<string, unknown>, tz: string): string {
  if (d.phase === 'inicio') return '';
  const crit = `criterio orientativo: ≤ ${pdfNum(d.targetTemp)} °C en menos de ${str(d.maxMinutes)} min`;
  const start = typeof d.startedAt === 'string' ? `desde ${formatDateTimeEs(new Date(d.startedAt), tz)}, ` : '';
  const flags = [d.overTime ? 'fuera de tiempo' : null, d.overTemp ? 'por encima de la temperatura' : null].filter(Boolean).join(', ');
  return `${start}${str(d.minutes)} min (${crit})${flags ? `: ${flags}` : ''}`;
}

/** « (Refrigerado, máx. 4 °C)»: categoría y límite aplicados a la recepción (vacío si no hay ninguno). */
function receptionLimitText(d: Record<string, unknown>): string {
  const cat = typeof d.category === 'string' ? (RECEPTION_CATEGORY_LABELS[d.category as ReceptionCategory] ?? d.category) : null;
  const lim = [typeof d.minTemperature === 'number' ? `mín. ${pdfNum(d.minTemperature)} °C` : null, typeof d.maxTemperature === 'number' ? `máx. ${pdfNum(d.maxTemperature)} °C` : null]
    .filter(Boolean)
    .join(', ');
  const own = d.limitDiffersFromReference === true ? 'límite del proveedor' : null;
  const amb =
    d.categoryDiffersFromSupplier === true
      ? `el proveedor suele ser otro tipo; motivo: ${String(d.categoryReason ?? '')}`
      : typeof d.categoryChangedFrom === 'string'
        ? `antes ${(RECEPTION_CATEGORY_LABELS[d.categoryChangedFrom as ReceptionCategory] ?? d.categoryChangedFrom).toLowerCase()}; motivo: ${String(d.categoryReason ?? '')}`
        : null;
  const parts = [cat ? `${cat}${d.categoryAssumed ? ' por defecto' : ''}` : null, lim || (cat ? 'sin límite' : null), own, amb].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

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
        typeof d.temperature === 'number' ? `${pdfNum(d.temperature)} °C${receptionLimitText(d)}` : `Sin medir${receptionLimitText(d)}`,
        `${esDate(d.expiryDate)}${d.expired ? ' (caducada)' : ''}`,
        d.accepted
          ? `${d.temperatureOutOfRange ? 'Aceptada con alerta: supera el límite de temperatura' : d.expired ? 'Aceptada con alerta: caducada' : 'Aceptada'}${d.correctiveAction ? `. Motivo/acción: ${str(d.correctiveAction)}` : ''}`
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
    case 'cocinado':
      return [
        when,
        str(d.product),
        COOKING_PROCESS_LABELS[d.process as CookingProcess] ?? str(d.process),
        `${pdfNum(d.coreTemp)} °C${d.outOfRange ? ' (no llega)' : ''}`,
        typeof d.referenceTemp === 'number' ? `≥ ${pdfNum(d.referenceTemp)} °C${d.freshEgg ? ' (huevo fresco)' : ''}` : '',
        typeof d.minutes === 'number' ? `${d.minutes} min` : '',
        signer(r),
        str(d.correctiveAction),
        notes(r, tz),
      ];
    case 'enfriamiento':
      return [when, str(d.product), d.phase === 'fin' ? 'Fin' : 'Inicio', coolingTemps(d), coolingTime(d, tz), signer(r), str(d.correctiveAction), notes(r, tz)];
    case 'personalizado':
      return [when, str(d.templateName), customResult(d), [customDetail(d), d.notes ? `Observaciones: ${str(d.notes)}` : ''].filter(Boolean).join(' · '), signer(r), str(d.correctiveAction), notes(r, tz)];
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
  // Añadidas en la fase 1 (firma legible, autoría de las correcciones y categoría de la recepción).
  'firma',
  'corregido_por_nombre',
  'firmante_anterior',
  'categoria_producto',
  'temperatura_minima_c',
  // Evaluación de la fase 1: la recepción usó el límite propio del proveedor (distinto del de referencia).
  'limite_del_proveedor',
  // Fase 2: cocinado y regeneración, enfriamiento rápido y registros personalizados.
  'proceso',
  'temperatura_centro_c',
  'referencia_c',
  'minutos',
  'fase_enfriamiento',
  'inicio_enfriamiento_de',
  'temperatura_inicio_c',
  'temperatura_fin_c',
  'criterio_temperatura_c',
  'criterio_minutos',
  'desechado',
  'registro_personalizado',
  'resultado_personalizado',
  'detalle_personalizado',
  // Evaluación de la fase 2: huevo fresco (cocinado) y motivo de un enfriamiento que empieza por debajo de 60 °C.
  'huevo_fresco',
  'motivo_inicio_enfriamiento',
];

export function csvRow(r: ReportRecord, tz: string): string[] {
  const d = r.data;
  const items = (d.items as { area: string; done: boolean }[] | undefined) ?? [];
  const row: Record<string, string> = {
    id: r.id,
    tipo: r.type,
    fecha_hora: formatDateTimeEs(r.effective_at, tz),
    fecha_registro: formatDateTimeEs(r.created_at, tz),
    // Quién hizo la corrección (usuario en la web, empleado en la tablet), no el firmante del hecho.
    enmendado_por: r.amends_record_id ? corrector(r) : '',
    firma: signer(r),
    corregido_por_nombre: str(r.amended_by_name),
    firmante_anterior: signerChanged(r) ? str(r.amends_signer) : '',
    categoria_producto: r.type === 'recepcion' ? str(d.category) : '',
    temperatura_minima_c: num(d.minTemperature),
    limite_del_proveedor: r.type === 'recepcion' && d.limitDiffersFromReference === true ? 'sí' : '',
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
    observaciones: str(d.observations ?? d.notes),
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
    proceso: r.type === 'cocinado' ? str(COOKING_PROCESS_LABELS[d.process as CookingProcess] ?? d.process) : '',
    temperatura_centro_c: r.type === 'cocinado' ? num(d.coreTemp) : '',
    referencia_c: r.type === 'cocinado' ? num(d.referenceTemp) : '',
    minutos: r.type === 'cocinado' || r.type === 'enfriamiento' ? num(d.minutes) : '',
    fase_enfriamiento: r.type === 'enfriamiento' ? (d.phase === 'fin' ? 'fin' : 'inicio') : '',
    inicio_enfriamiento_de: r.type === 'enfriamiento' ? str(d.startRecordId) : '',
    temperatura_inicio_c: r.type === 'enfriamiento' ? num(d.startTemp) : '',
    temperatura_fin_c: r.type === 'enfriamiento' ? num(d.endTemp) : '',
    criterio_temperatura_c: r.type === 'enfriamiento' ? num(d.targetTemp) : '',
    criterio_minutos: r.type === 'enfriamiento' ? num(d.maxMinutes) : '',
    desechado: r.type === 'enfriamiento' && d.phase === 'fin' ? (d.discarded ? 'sí' : 'no') : '',
    registro_personalizado: r.type === 'personalizado' ? str(d.templateName) : '',
    resultado_personalizado: r.type === 'personalizado' ? customResult(d).replace('−', '-') : '',
    detalle_personalizado: r.type === 'personalizado' ? customDetail(d).replace(/−/g, '-') : '',
    huevo_fresco: r.type === 'cocinado' ? (d.freshEgg ? 'sí' : 'no') : '',
    motivo_inicio_enfriamiento: r.type === 'enfriamiento' && d.belowStartReference ? str(d.startReason) : '',
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
