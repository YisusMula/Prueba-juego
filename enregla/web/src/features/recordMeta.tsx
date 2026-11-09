import { RECORD_TYPES, RECORD_TYPE_LABELS } from '@shared/schemas';
import type { IconName } from '@/components/icons/Icon';
import type { AlertKind, AppRecord, RecordType } from '@/api/types';
import { formatLocalDate, formatNumber, formatTemp } from '@/lib/format';

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
};

export const RECORD_HELP: Record<RecordType, string> = {
  temperatura: 'Cámaras, congeladores, vitrinas y mantenimiento en caliente',
  limpieza: 'Marca las zonas limpiadas de un plan',
  recepcion: 'Mercancía recibida: estado, temperatura y lote',
  aceite: 'Revisión o cambio del aceite de la freidora',
  plagas: 'Revisión de cebos, trampas e indicios',
  incidencia: 'Algo que ha ido mal y qué se ha hecho',
  formacion: 'Cursos y formación del personal',
};

export const RECORD_ICON: Record<RecordType, IconName> = {
  temperatura: 'thermometer',
  limpieza: 'sparkles',
  recepcion: 'truck',
  aceite: 'droplet',
  plagas: 'bug',
  incidencia: 'alert',
  formacion: 'graduation',
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
};

export const isRecordType = (v: string | undefined): v is RecordType => !!v && (RECORD_TYPES as readonly string[]).includes(v);

export const ALERT_LABELS: Record<AlertKind, string> = {
  temperatura_fuera_de_rango: 'Temperatura fuera de rango',
  aceite_fuera_de_limite: 'Aceite por encima del límite',
  recepcion_rechazada: 'Mercancía rechazada',
  plagas_con_indicios: 'Indicios de plagas',
  incidencia_abierta: 'Incidencia abierta',
};

/** Resumen de una línea de un registro (título + detalle), en lenguaje llano. */
export function recordSummary(r: AppRecord): { title: string; detail: string } {
  switch (r.type) {
    case 'temperatura':
      return {
        title: `${r.data.equipmentName}: ${formatTemp(r.data.value)}`,
        detail: r.data.outOfRange ? `Fuera de rango${r.data.correctiveAction ? ` · ${r.data.correctiveAction}` : ''}` : 'Dentro de rango',
      };
    case 'limpieza': {
      const done = r.data.items.filter((i) => i.done).length;
      return { title: r.data.planName, detail: r.data.completed ? 'Todo limpio' : `${done} de ${r.data.items.length} zonas hechas` };
    }
    case 'recepcion':
      return {
        title: `${r.data.product} · ${r.data.supplierName}`,
        detail: r.data.accepted
          ? `Aceptada${r.data.temperature != null ? ` · ${formatTemp(r.data.temperature)}` : ''}`
          : `Rechazada · ${r.data.rejectionReason ?? ''}`,
      };
    case 'aceite':
      return {
        title: `${r.data.fryerName}: aceite ${r.data.action}`,
        detail:
          r.data.polarCompounds != null
            ? `${formatNumber(r.data.polarCompounds)} % compuestos polares${r.data.overLimit ? ' · por encima del límite' : ''}`
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
  }
}

export function signer(r: AppRecord): string {
  const parts = [r.staff?.name, r.user && r.user.name !== r.staff?.name ? r.user.name : null].filter(Boolean);
  if (parts.length === 0) return r.deviceId ? 'Tablet de cocina' : '—';
  return parts.join(' · ');
}
