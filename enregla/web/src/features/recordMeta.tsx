import { COOKING_PROCESS_LABELS, RECORD_TYPES, RECORD_TYPE_LABELS, recordCorrector, recordSignature } from '@shared/schemas';
import type { IconName } from '@/components/icons/Icon';
import type { AlertKind, AppRecord, RecordType } from '@/api/types';
import { formatLocalDate, formatPercent, formatTemp } from '@/lib/format';

/** «Completa» o «Parcial (2 de 5)»: el mismo texto en confirmación, Hoy, historial e informes. */
export function cleaningResult(items: { done: boolean }[]): string {
  const done = items.filter((i) => i.done).length;
  return done === items.length ? `Completa (${done} de ${items.length})` : `Parcial (${done} de ${items.length})`;
}

export { RECORD_TYPES, RECORD_TYPE_LABELS };

/** Nombre corto, en singular, para botones y tarjetas. */
export const RECORD_SHORT: Record<RecordType, string> = {
  temperatura: 'Temperatura',
  limpieza: 'Limpieza',
  recepcion: 'Recepción',
  aceite: 'Aceite',
  plagas: 'Plagas',
  incidencia: 'Incidencia',
  formacion: 'Formación',
  cocinado: 'Cocinado',
  enfriamiento: 'Enfriamiento',
  personalizado: 'Otros controles',
};

export const RECORD_HELP: Record<RecordType, string> = {
  temperatura: 'Cámaras, congeladores, vitrinas y mantenimiento en caliente',
  limpieza: 'Marca las zonas limpiadas de un plan',
  recepcion: 'Mercancía recibida: estado, temperatura y lote',
  aceite: 'Revisión o cambio del aceite de la freidora',
  plagas: 'Revisión de cebos, trampas e indicios',
  incidencia: 'Algo que ha ido mal y qué se ha hecho',
  formacion: 'Cursos y formación del personal',
  cocinado: 'Temperatura en el centro al cocinar o regenerar',
  enfriamiento: 'Abatidor: empieza y, al terminar, ciérralo',
  personalizado: 'Agua, termómetros, mantenimiento y tus propios controles',
};

export const RECORD_ICON: Record<RecordType, IconName> = {
  temperatura: 'thermometer',
  limpieza: 'sparkles',
  recepcion: 'truck',
  aceite: 'droplet',
  plagas: 'bug',
  incidencia: 'alert',
  formacion: 'graduation',
  cocinado: 'flame',
  enfriamiento: 'snowflake',
  personalizado: 'clipboard',
};

/** Clases del "chip" de icono de cada tipo (tono propio, independiente del semáforo). */
export const RECORD_TINT: Record<RecordType, string> = {
  temperatura: 'bg-[#dbeefa] text-[#155e8c] dark:bg-[#12324a] dark:text-[#8fcdf5]',
  limpieza: 'bg-[#e1f3ee] text-[#16705b] dark:bg-[#113a31] dark:text-[#86dcc4]',
  recepcion: 'bg-[#ece7fa] text-[#5a3fa8] dark:bg-[#2a2347] dark:text-[#c3b3f5]',
  aceite: 'bg-[#fbefd5] text-[#8a5a00] dark:bg-[#3a2c0c] dark:text-[#f2c36b]',
  plagas: 'bg-[#efe9e1] text-[#6b4f2d] dark:bg-[#33281b] dark:text-[#dcc19a]',
  incidencia: 'bg-[#fde6e2] text-[#a3281a] dark:bg-[#3e1915] dark:text-[#ff9f92]',
  formacion: 'bg-[#e6ecfb] text-[#2f4fa8] dark:bg-[#1c2647] dark:text-[#a8bdf5]',
  cocinado: 'bg-[#fde8d7] text-[#9a3d06] dark:bg-[#3d2110] dark:text-[#ffb98a]',
  enfriamiento: 'bg-[#dff3f8] text-[#0b6577] dark:bg-[#0f3540] dark:text-[#8ee0f0]',
  personalizado: 'bg-[#eef0f3] text-[#3f4a5a] dark:bg-[#262c35] dark:text-[#c5cdd8]',
};

export const isRecordType = (v: string | undefined): v is RecordType => !!v && (RECORD_TYPES as readonly string[]).includes(v);

export const ALERT_LABELS: Record<AlertKind, string> = {
  temperatura_fuera_de_rango: 'Temperatura fuera de rango',
  aceite_fuera_de_limite: 'Aceite por encima del límite',
  recepcion_rechazada: 'Mercancía rechazada',
  recepcion_con_incidencia: 'Mercancía aceptada con incidencia',
  plagas_con_indicios: 'Indicios de plagas',
  incidencia_abierta: 'Incidencia abierta',
  cocinado_por_debajo: 'Cocinado por debajo de la referencia',
  enfriamiento_fuera_de_criterio: 'Enfriamiento fuera de criterio',
  enfriamiento_sin_cerrar: 'Enfriamiento sin cerrar a tiempo',
  registro_personalizado_no_conforme: 'Control no conforme',
  registro_personalizado_vencido: 'Control periódico vencido',
};

/** «Todo correcto (3 de 3)» / «No conforme (2 de 3)» / «0,4 mg/l» / «Sí»: resultado de un registro personalizado. */
export function customResult(d: { kind: string; items?: { ok: boolean }[]; reading?: number; unit?: string | null; outOfRange?: boolean; answer?: boolean }): string {
  if (d.kind === 'checklist') {
    const items = d.items ?? [];
    const ok = items.filter((i) => i.ok).length;
    return ok === items.length ? `Todo correcto (${ok} de ${items.length})` : `No conforme (${ok} de ${items.length} correctos)`;
  }
  if (d.kind === 'numeric') return `${formatNumber(d.reading)}${d.unit ? ` ${d.unit}` : ''}${d.outOfRange ? ' · fuera de rango' : ''}`;
  return d.answer === true ? 'Sí' : d.answer === false ? 'No' : '';
}

/** Número con coma decimal y signo menos tipográfico. */
export const formatNumber = (n: number | null | undefined) => (n == null ? '—' : String(n).replace('.', ',').replace('-', '−'));

/** Resumen de una línea de un registro (título + detalle), en lenguaje llano. */
export function recordSummary(r: AppRecord): { title: string; detail: string } {
  switch (r.type) {
    case 'temperatura':
      return {
        title: `${r.data.equipmentName}: ${formatTemp(r.data.value)}`,
        detail: r.data.outOfRange ? `Fuera de rango${r.data.correctiveAction ? ` · ${r.data.correctiveAction}` : ''}` : 'Dentro de rango',
      };
    case 'limpieza': {
      return { title: r.data.planName, detail: cleaningResult(r.data.items) };
    }
    case 'recepcion':
      return {
        title: `${r.data.product} · ${r.data.supplierName}`,
        detail: r.data.accepted
          ? [
              r.alert ? 'Aceptada con alerta' : 'Aceptada',
              r.data.temperature != null ? formatTemp(r.data.temperature) : null,
              r.data.temperatureOutOfRange && r.data.maxTemperature != null && r.data.temperature != null && r.data.temperature > r.data.maxTemperature
                ? `por encima de ${formatTemp(r.data.maxTemperature)}`
                : null,
              r.data.temperatureOutOfRange && r.data.minTemperature != null && r.data.temperature != null && r.data.temperature < r.data.minTemperature
                ? `por debajo de ${formatTemp(r.data.minTemperature)}`
                : null,
              r.data.expired ? 'caducada' : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : `Rechazada · ${r.data.rejectionReason ?? ''}`,
      };
    case 'aceite':
      return {
        title: `${r.data.fryerName}: aceite ${r.data.action}`,
        detail:
          r.data.polarCompounds != null
            ? `${formatPercent(r.data.polarCompounds)} de compuestos polares${r.data.overLimit ? ' · por encima del límite' : ''}`
            : 'Sin medición',
      };
    case 'plagas':
      return {
        title: r.data.result === 'sin_indicios' ? 'Sin indicios de plagas' : 'Con indicios de plagas',
        detail: r.data.description ?? 'Revisión hecha',
      };
    case 'incidencia':
      return { title: r.data.description, detail: r.data.closed ? 'Cerrada' : 'Abierta' };
    case 'formacion':
      return { title: `${r.data.traineeName}: ${r.data.course}`, detail: formatLocalDate(r.data.trainingDate) };
    case 'cocinado':
      return {
        title: `${r.data.product}: ${formatTemp(r.data.coreTemp)} en el centro`,
        detail: `${COOKING_PROCESS_LABELS[r.data.process]} · ${r.data.outOfRange ? `por debajo de ${formatTemp(r.data.referenceTemp)}` : `referencia ${formatTemp(r.data.referenceTemp)}`}${r.data.correctiveAction ? ` · ${r.data.correctiveAction}` : ''}`,
      };
    case 'enfriamiento':
      return r.data.phase === 'inicio'
        ? { title: `Enfriamiento de ${r.data.product}: inicio`, detail: `Empieza a ${formatTemp(r.data.startTemp)}${r.data.belowStartReference ? ` · por debajo de ${formatTemp(r.data.startReferenceTemp ?? null)}: ${r.data.startReason ?? ''}` : ''}` }
        : {
            title: `Enfriamiento de ${r.data.product ?? '—'}: fin`,
            detail: r.data.discarded
              ? `Producto desechado${r.data.correctiveAction ? ` · ${r.data.correctiveAction}` : ''}`
              : `${r.data.startTemp != null ? `${formatTemp(r.data.startTemp)} → ` : ''}${formatTemp(r.data.endTemp ?? 0)} en ${r.data.minutes} min${r.data.outOfRange ? ' · fuera de criterio' : ''}`,
          };
    case 'personalizado':
      return { title: r.data.templateName, detail: customResult(r.data) };
  }
}

/**
 * Firma, igual que en el PDF y el CSV: «Ana Martín (anotado por Laura Gil)» cuando un usuario lo
 * registró en la web para un empleado; el empleado desde la tablet; el usuario si no indicó a nadie.
 * En una corrección, quien figura como autor del hecho (quién corrigió: `corrector`).
 */
export function signer(r: AppRecord): string {
  return r.signature ?? recordSignature({ staffName: r.staff?.name ?? null, userName: r.user?.name ?? null, deviceId: r.deviceId, isAmendment: r.amendsRecordId != null });
}

/** Quién hizo una corrección: el usuario (web) o el empleado (tablet); nunca el firmante del original. */
export function corrector(r: AppRecord): string {
  return r.correctedBy ?? recordCorrector({ staffName: r.staff?.name ?? null, userName: r.user?.name ?? null });
}
