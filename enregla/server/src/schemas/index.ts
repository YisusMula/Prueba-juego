/**
 * Esquemas zod compartibles con el frontend. Este módulo solo depende de `zod`.
 * Importación sugerida desde el frontend: `import { schemas } from '../../server/src/schemas'`
 * o, como paquete, `enregla-server/schemas`.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------
export const uuid = z.uuid({ error: 'Identificador no válido' });
/** Años admitidos en fechas: fuera de este rango PostgreSQL o los cálculos de fechas pueden fallar. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
export const isoDate = z.iso
  .date({ error: 'Fecha no válida (formato AAAA-MM-DD)' })
  .refine((d) => {
    const y = Number(d.slice(0, 4));
    return y >= MIN_YEAR && y <= MAX_YEAR;
  }, `La fecha debe estar entre los años ${MIN_YEAR} y ${MAX_YEAR}`);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Email no válido' }));

/** La política completa (lista de comunes, etc.) se aplica en el servidor. */
export const password = z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(128, 'La contraseña no puede superar 128 caracteres');
export const token = z.string().min(20).max(200);
export const pin = z.string().regex(/^\d{4,6}$/, 'El PIN debe tener entre 4 y 6 dígitos');

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

// ---------------------------------------------------------------------------
// Auth y cuenta
// ---------------------------------------------------------------------------
export const registerBody = z.object({ email, password, name: text(100) });
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const tokenBody = z.object({ token });
export const emailBody = z.object({ email });
export const passwordResetConfirmBody = z.object({ token, password });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const changeEmailBody = z.object({ password: z.string().min(1).max(128), newEmail: email });
export const passwordConfirmBody = z.object({ password: z.string().min(1).max(128) });
export const updateAccountBody = z.object({ name: text(100) });

// ---------------------------------------------------------------------------
// Organizaciones
// ---------------------------------------------------------------------------
export const BUSINESS_TYPES = ['bar', 'restaurante', 'cafeteria', 'obrador', 'catering', 'tienda'] as const;
export const businessType = z.enum(BUSINESS_TYPES);
export const BUSINESS_TYPE_LABELS: Record<(typeof BUSINESS_TYPES)[number], string> = {
  bar: 'Bar',
  restaurante: 'Restaurante',
  cafeteria: 'Cafetería',
  obrador: 'Panadería / obrador',
  catering: 'Catering',
  tienda: 'Tienda de alimentación',
};

/**
 * Solo nombres IANA (más `UTC`). Desplazamientos como `+01:00` los acepta Intl pero
 * PostgreSQL los interpreta con el signo invertido (convención POSIX), así que se rechazan.
 */
let timeZones: Set<string> | null = null;
export function isValidTimeZone(tz: string): boolean {
  timeZones ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  return timeZones.has(tz);
}
export const timezone = z.string().max(64).refine(isValidTimeZone, 'Zona horaria no válida (usa un nombre IANA, p. ej. Europe/Madrid)');

export const createOrgBody = z.object({
  name: text(120),
  businessType,
  timezone: timezone.default('Europe/Madrid'),
});
export const updateOrgBody = z
  .object({
    name: text(120),
    timezone,
    reminderEnabled: z.boolean(),
    reminderHour: z.number().int().min(0).max(23),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');

export const ROLES = ['owner', 'manager'] as const;
export const role = z.enum(ROLES);
export const inviteBody = z.object({ email, role: role.default('manager') });
export const updateMemberBody = z.object({ role });
export const membershipPrefsBody = z.object({ dailyReminder: z.boolean() });

// ---------------------------------------------------------------------------
// Personal, dispositivos
// ---------------------------------------------------------------------------
export const createStaffBody = z.object({ name: text(100), pin: pin.optional().nullable() });
export const updateStaffBody = z
  .object({ name: text(100), pin: pin.nullable(), active: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
export const createDeviceBody = z.object({ name: text(100) });

// ---------------------------------------------------------------------------
// Equipos
// ---------------------------------------------------------------------------
export const EQUIPMENT_TYPES = ['camara', 'congelador', 'vitrina', 'mesa_caliente', 'abatidor', 'freidora', 'otro'] as const;
export const equipmentType = z.enum(EQUIPMENT_TYPES);
export const EQUIPMENT_TYPE_LABELS: Record<(typeof EQUIPMENT_TYPES)[number], string> = {
  camara: 'Cámara frigorífica',
  congelador: 'Congelador',
  vitrina: 'Vitrina refrigerada',
  mesa_caliente: 'Mantenimiento en caliente',
  abatidor: 'Abatidor',
  freidora: 'Freidora',
  otro: 'Otro',
};
const temp = z.number().min(-60).max(300);
const equipmentFields = z.object({
  name: text(100),
  type: equipmentType,
  minTemp: temp.nullable().default(null),
  maxTemp: temp.nullable().default(null),
  checksPerDay: z.number().int().min(0).max(12).default(1),
  active: z.boolean().default(true),
});
export const createEquipmentBody = equipmentFields.refine(
  (e) => e.minTemp == null || e.maxTemp == null || e.minTemp <= e.maxTemp,
  { message: 'La temperatura mínima no puede ser mayor que la máxima', path: ['minTemp'] },
);
export const updateEquipmentBody = z
  .object({
    name: text(100),
    type: equipmentType,
    minTemp: temp.nullable(),
    maxTemp: temp.nullable(),
    checksPerDay: z.number().int().min(0).max(12),
    active: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');

// ---------------------------------------------------------------------------
// Planes de limpieza
// ---------------------------------------------------------------------------
export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export const cleaningItemInput = z.object({
  id: z.string().min(1).max(64).optional(),
  area: text(150),
  product: optionalText(150),
  method: optionalText(300),
});
const cleaningPlanFields = {
  name: text(120),
  frequency: z.enum(FREQUENCIES),
  /** 1 = lunes … 7 = domingo (ISO). Obligatorio si frequency = weekly. */
  weekday: z.number().int().min(1).max(7).nullable().default(null),
  /** 1–28. Obligatorio si frequency = monthly. */
  monthDay: z.number().int().min(1).max(28).nullable().default(null),
  items: z.array(cleaningItemInput).min(1).max(100),
  active: z.boolean().default(true),
};
export const createCleaningPlanBody = z.object(cleaningPlanFields).superRefine((p, ctx) => {
  if (p.frequency === 'weekly' && p.weekday == null) ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'Indica el día de la semana' });
  if (p.frequency === 'monthly' && p.monthDay == null) ctx.addIssue({ code: 'custom', path: ['monthDay'], message: 'Indica el día del mes' });
});
export const updateCleaningPlanBody = z
  .object({
    name: cleaningPlanFields.name,
    frequency: cleaningPlanFields.frequency,
    weekday: z.number().int().min(1).max(7).nullable(),
    monthDay: z.number().int().min(1).max(28).nullable(),
    items: cleaningPlanFields.items,
    active: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
export const supplierBody = z.object({
  name: text(150),
  contactName: optionalText(150),
  phone: optionalText(40),
  email: z
    .union([email, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  products: z.array(text(100)).max(200).default([]),
  notes: optionalText(1000),
});
export const updateSupplierBody = z
  .object({
    name: text(150),
    contactName: optionalText(150),
    phone: optionalText(40),
    email: z.union([email, z.literal(''), z.null()]).transform((v) => (v ? v : null)),
    products: z.array(text(100)).max(200),
    notes: optionalText(1000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------
export const RECORD_TYPES = ['temperatura', 'limpieza', 'recepcion', 'aceite', 'plagas', 'incidencia', 'formacion'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const recordType = z.enum(RECORD_TYPES);
export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  temperatura: 'Temperaturas',
  limpieza: 'Limpieza',
  recepcion: 'Recepción de mercancía',
  aceite: 'Aceite de fritura',
  plagas: 'Control de plagas',
  incidencia: 'Incidencias',
  formacion: 'Formación de manipuladores',
};

/** Umbral de referencia de compuestos polares (%): por encima exige acción correctora. */
export const POLAR_COMPOUNDS_LIMIT = 25;

export const temperaturaData = z.object({
  equipmentId: uuid,
  value: z.number().min(-60).max(300),
  /** Obligatoria si el valor queda fuera del rango del equipo (lo comprueba el servidor). */
  correctiveAction: optionalText(1000),
});
export const limpiezaData = z.object({
  cleaningPlanId: uuid,
  items: z
    .array(z.object({ itemId: z.string().min(1).max(64), done: z.boolean() }))
    .max(100)
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, 'Ítems duplicados'),
  observations: optionalText(1000),
});
export const recepcionData = z
  .object({
    supplierId: uuid.optional().nullable(),
    supplierName: optionalText(150),
    product: text(200),
    lot: optionalText(100),
    temperature: z.number().min(-60).max(100).optional().nullable(),
    expiryDate: isoDate.optional().nullable(),
    accepted: z.boolean(),
    rejectionReason: optionalText(1000),
  })
  .superRefine((d, ctx) => {
    if (!d.supplierId && !d.supplierName) ctx.addIssue({ code: 'custom', path: ['supplierName'], message: 'Indica el proveedor' });
    if (!d.accepted && !d.rejectionReason) ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Indica el motivo del rechazo' });
  });
export const aceiteData = z.object({
  equipmentId: uuid,
  action: z.enum(['revisado', 'cambiado']),
  polarCompounds: z.number().min(0).max(100).optional().nullable(),
  /** Obligatoria si polarCompounds > 25 (lo comprueba el servidor). */
  correctiveAction: optionalText(1000),
});
export const plagasData = z
  .object({
    result: z.enum(['sin_indicios', 'con_indicios']),
    description: optionalText(1000),
    action: optionalText(1000),
  })
  .superRefine((d, ctx) => {
    if (d.result === 'con_indicios') {
      if (!d.description) ctx.addIssue({ code: 'custom', path: ['description'], message: 'Describe los indicios' });
      if (!d.action) ctx.addIssue({ code: 'custom', path: ['action'], message: 'Indica la acción tomada' });
    }
  });
export const incidenciaData = z.object({
  description: text(2000),
  correctiveAction: optionalText(2000),
  closed: z.boolean(),
});
export const formacionData = z.object({
  traineeStaffId: uuid,
  course: text(300),
  trainingDate: isoDate,
  trainer: optionalText(200),
  hours: z.number().min(0).max(1000).optional().nullable(),
});

export const recordDataSchemas = {
  temperatura: temperaturaData,
  limpieza: limpiezaData,
  recepcion: recepcionData,
  aceite: aceiteData,
  plagas: plagasData,
  incidencia: incidenciaData,
  formacion: formacionData,
} as const;

export const createRecordBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('temperatura'), staffId: uuid.optional().nullable(), data: temperaturaData }),
  z.object({ type: z.literal('limpieza'), staffId: uuid.optional().nullable(), data: limpiezaData }),
  z.object({ type: z.literal('recepcion'), staffId: uuid.optional().nullable(), data: recepcionData }),
  z.object({ type: z.literal('aceite'), staffId: uuid.optional().nullable(), data: aceiteData }),
  z.object({ type: z.literal('plagas'), staffId: uuid.optional().nullable(), data: plagasData }),
  z.object({ type: z.literal('incidencia'), staffId: uuid.optional().nullable(), data: incidenciaData }),
  z.object({ type: z.literal('formacion'), staffId: uuid.optional().nullable(), data: formacionData }),
]);
export const kioskRecordBody = z.object({
  staffId: uuid,
  pin: z.string().max(12).optional().nullable(),
  type: recordType,
  data: z.unknown(),
});
export const amendmentBody = z.object({
  reason: text(1000),
  staffId: uuid.optional().nullable(),
  /** Datos completos corregidos, con el mismo esquema que el tipo del registro original. */
  data: z.unknown(),
});

export const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');
export const listRecordsQuery = pagination.extend({
  type: recordType.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  equipmentId: uuid.optional(),
  staffId: uuid.optional(),
  alert: booleanString.optional(),
});

// ---------------------------------------------------------------------------
// Alérgenos (Anexo II del Reglamento (UE) 1169/2011, en ese orden)
// ---------------------------------------------------------------------------
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type AllergenId = (typeof ALLERGENS)[number];
export const ALLERGEN_LABELS: Record<AllergenId, string> = {
  gluten: 'Cereales que contienen gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevos',
  fish: 'Pescado',
  peanuts: 'Cacahuetes',
  soybeans: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Granos de sésamo',
  sulphites: 'Dióxido de azufre y sulfitos',
  lupin: 'Altramuces',
  molluscs: 'Moluscos',
};
export const ALLERGEN_STATUSES = ['contains', 'traces', 'no'] as const;
export const ALLERGEN_STATUS_LABELS = { contains: 'Contiene', traces: 'Puede contener trazas', no: 'No contiene' } as const;
const allergenStatus = z.enum(ALLERGEN_STATUSES);
export const allergenMap = z.object(
  Object.fromEntries(ALLERGENS.map((a) => [a, allergenStatus])) as Record<AllergenId, typeof allergenStatus>,
).strict();

export const dishBody = z.object({
  name: text(150),
  category: optionalText(100),
  description: optionalText(1000),
  allergens: allergenMap,
  visible: z.boolean().default(true),
});
export const updateDishBody = z
  .object({
    name: text(150),
    category: optionalText(100),
    description: optionalText(1000),
    allergens: allergenMap,
    visible: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
export const publicMenuSettingsBody = z.object({ enabled: z.boolean() });

// ---------------------------------------------------------------------------
// Tareas, informes, facturación
// ---------------------------------------------------------------------------
export const dateRangeQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['from'] });

export const reportQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    /** Lista separada por comas; vacío = todos los tipos. */
    types: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return [...RECORD_TYPES];
        const list = Array.from(new Set(v.split(',').map((s) => s.trim()).filter(Boolean)));
        for (const t of list) {
          if (!(RECORD_TYPES as readonly string[]).includes(t)) {
            ctx.addIssue({ code: 'custom', message: `Tipo de registro desconocido: ${t}` });
            return z.NEVER;
          }
        }
        return list as RecordType[];
      }),
  })
  .refine((q) => q.from <= q.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['from'] });

export const PLANS = ['monthly', 'annual'] as const;
export const checkoutBody = z.object({ plan: z.enum(PLANS) });

export type RegisterBody = z.infer<typeof registerBody>;
export type CreateOrgBody = z.infer<typeof createOrgBody>;
export type CreateRecordBody = z.infer<typeof createRecordBody>;
export type DishBody = z.infer<typeof dishBody>;
