/**
 * Esquemas zod compartibles con el frontend. Este módulo solo depende de `zod`.
 * Importación sugerida desde el frontend: `import { schemas } from '../../server/src/schemas'`
 * o, como paquete, `enregla-server/schemas`.
 */
import { z } from 'zod';
import { esErrorMap } from './es.js';

// Mensajes de validación en español (servidor y frontend comparten este módulo).
z.config({ customError: esErrorMap });

export * from './es.js';
export * from './password-policy.js';

/** Longitudes máximas de los textos (las mismas en el formulario y en el servidor). */
export const LIMITS = {
  userName: 100,
  orgName: 120,
  staffName: 100,
  deviceName: 100,
  equipmentName: 100,
  planName: 120,
  cleaningArea: 150,
  supplierName: 150,
  dishName: 150,
  dishCategory: 100,
  dishDescription: 1000,
  product: 200,
  lot: 100,
  shortText: 1000,
  course: 300,
} as const;

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------
export const uuid = z.uuid();
/** Años admitidos en fechas: fuera de este rango PostgreSQL o los cálculos de fechas pueden fallar. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
export const isoDate = z.iso
  .date({ error: (i) => (i.input === undefined || i.input === null || i.input === '' ? 'Elige una fecha' : 'Escribe una fecha válida') })
  .refine((d) => {
    const y = Number(d.slice(0, 4));
    return y >= MIN_YEAR && y <= MAX_YEAR;
  }, `La fecha debe estar entre los años ${MIN_YEAR} y ${MAX_YEAR}`);
const text = (max: number) => z.string().trim().min(1).max(max);
/** Rango físico admitido para cualquier temperatura (°C). */
export const TEMP_MIN = -60;
export const TEMP_MAX = 300;
export const TEMP_RANGE_MESSAGE = `La temperatura debe estar entre −60 y 300 °C`;
/** Temperatura de mercancía recibida (°C). */
export const RECEPTION_TEMP_MIN = -60;
export const RECEPTION_TEMP_MAX = 100;
export const RECEPTION_TEMP_MESSAGE = 'La temperatura debe estar entre −60 y 100 °C';
const temperature = (min = TEMP_MIN, max = TEMP_MAX, message = TEMP_RANGE_MESSAGE) =>
  z.number({ error: (i) => (i.input === undefined || i.input === null ? 'Escribe la temperatura' : 'Escribe la temperatura con números (por ejemplo 3,5 o −18)') })
    .min(min, message)
    .max(max, message);
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
  .pipe(z.email({ error: 'Escribe un email válido (por ejemplo, nombre@dominio.es)' }));

/** La política completa (lista de comunes, etc.) se aplica en el servidor. */
export const password = z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(128, 'La contraseña no puede superar 128 caracteres');
export const token = z.string().min(20).max(200);
export const pin = z.string().regex(/^\d{4,6}$/, 'El PIN debe tener entre 4 y 6 cifras (solo números)');

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

// ---------------------------------------------------------------------------
// Auth y cuenta
// ---------------------------------------------------------------------------
export const registerBody = z.object({ email, password, name: text(LIMITS.userName) });
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const tokenBody = z.object({ token });
export const emailBody = z.object({ email });
export const passwordResetConfirmBody = z.object({ token, password });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const changeEmailBody = z.object({ password: z.string().min(1).max(128), newEmail: email });
export const passwordConfirmBody = z.object({ password: z.string().min(1).max(128) });
export const updateAccountBody = z.object({ name: text(LIMITS.userName) });

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
export const timezone = z.string().max(64).refine(isValidTimeZone, 'Elige una zona horaria de la lista');

export const createOrgBody = z.object({
  name: text(LIMITS.orgName),
  businessType,
  timezone: timezone.default('Europe/Madrid'),
});
export const updateOrgBody = z
  .object({
    name: text(LIMITS.orgName),
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
export const createStaffBody = z.object({ name: text(LIMITS.staffName), pin: pin.optional().nullable() });
export const updateStaffBody = z
  .object({ name: text(LIMITS.staffName), pin: pin.nullable(), active: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
export const createDeviceBody = z.object({ name: text(LIMITS.deviceName) });

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
const temp = temperature();
const equipmentFields = z.object({
  name: text(LIMITS.equipmentName),
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
    name: text(LIMITS.equipmentName),
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
  area: text(LIMITS.cleaningArea),
  product: optionalText(150),
  method: optionalText(300),
});
const cleaningPlanFields = {
  name: text(LIMITS.planName),
  frequency: z.enum(FREQUENCIES),
  /** 1 = lunes … 7 = domingo (ISO). Obligatorio si frequency = weekly. */
  weekday: z.number().int().min(1).max(7).nullable().default(null),
  /** 1–28. Obligatorio si frequency = monthly. */
  monthDay: z.number().int().min(1).max(28).nullable().default(null),
  items: z.array(cleaningItemInput).min(1, 'Añade al menos una zona').max(100, 'Como máximo 100 zonas por plan'),
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
  name: text(LIMITS.supplierName),
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
    name: text(LIMITS.supplierName),
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
  value: temperature(),
  /** Obligatoria si el valor queda fuera del rango del equipo (lo comprueba el servidor). */
  correctiveAction: optionalText(1000),
});
export const limpiezaData = z.object({
  cleaningPlanId: uuid,
  items: z
    .array(z.object({ itemId: z.string().min(1).max(64), done: z.boolean() }))
    .max(100)
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, 'Hay zonas repetidas')
    .refine((items) => items.some((i) => i.done), 'Marca al menos una zona hecha'),
  observations: optionalText(1000),
});
export const recepcionData = z
  .object({
    supplierId: uuid.optional().nullable(),
    supplierName: optionalText(150),
    product: text(LIMITS.product),
    lot: optionalText(LIMITS.lot),
    temperature: temperature(RECEPTION_TEMP_MIN, RECEPTION_TEMP_MAX, RECEPTION_TEMP_MESSAGE).optional().nullable(),
    /** Temperatura máxima admisible para este producto (p. ej. 4 °C refrigerado, −18 °C congelado). Opcional. */
    maxTemperature: temperature(RECEPTION_TEMP_MIN, RECEPTION_TEMP_MAX, RECEPTION_TEMP_MESSAGE).optional().nullable(),
    expiryDate: isoDate.optional().nullable(),
    accepted: z.boolean({ error: 'Indica si aceptas o rechazas la mercancía' }),
    rejectionReason: optionalText(LIMITS.shortText),
    /** Obligatoria si se ACEPTA mercancía caducada o por encima de la temperatura máxima (lo comprueba el servidor). */
    correctiveAction: optionalText(LIMITS.shortText),
  })
  .superRefine((d, ctx) => {
    if (!d.supplierId && !d.supplierName) ctx.addIssue({ code: 'custom', path: ['supplierName'], message: 'Indica el proveedor' });
    if (!d.accepted && !d.rejectionReason) ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Indica el motivo del rechazo' });
    if (d.accepted && receptionOverTemperature(d) && !d.correctiveAction) {
      ctx.addIssue({ code: 'custom', path: ['correctiveAction'], message: 'La temperatura supera la máxima admisible: indica qué has hecho o por qué la aceptas' });
    }
  });

/** Recepción por encima de la temperatura máxima admisible indicada. */
export function receptionOverTemperature(d: { temperature?: number | null; maxTemperature?: number | null }): boolean {
  return d.temperature != null && d.maxTemperature != null && d.temperature > d.maxTemperature;
}
/** Atajos de temperatura máxima admisible en recepción (orientativos). */
export const RECEPTION_MAX_TEMP_PRESETS = [
  { label: 'Refrigerado', value: 4 },
  { label: 'Congelado', value: -18 },
] as const;
export const aceiteData = z.object({
  equipmentId: uuid,
  action: z.enum(['revisado', 'cambiado']),
  polarCompounds: z.number().min(0, 'Los compuestos polares deben estar entre 0 y 100 %').max(100, 'Los compuestos polares deben estar entre 0 y 100 %').optional().nullable(),
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
  course: text(LIMITS.course),
  /** No puede ser futura (lo comprueba también el servidor con la fecha local del local). */
  trainingDate: isoDate,
  trainer: optionalText(200),
  hours: z.number().min(0, 'Las horas no pueden ser negativas').max(1000, 'Como máximo 1000 horas').optional().nullable(),
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
/**
 * Nombre corto de cada alérgeno: el MISMO en todas las vistas (gestión, tabla imprimible, carta pública).
 * La denominación completa del Reglamento (ALLERGEN_LABELS) se usa como aclaración.
 */
export const ALLERGEN_NAMES: Record<AllergenId, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevos',
  fish: 'Pescado',
  peanuts: 'Cacahuetes',
  soybeans: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Sésamo',
  sulphites: 'Sulfitos',
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
  name: text(LIMITS.dishName),
  category: optionalText(LIMITS.dishCategory),
  description: optionalText(LIMITS.dishDescription),
  allergens: allergenMap,
  /**
   * Revisión explícita de alérgenos. Un plato nace SIN REVISAR (false) y no aparece en la carta
   * pública hasta que alguien confirma que ha decidido los 14 alérgenos.
   */
  allergensReviewed: z.boolean().default(false),
  visible: z.boolean().default(true),
});
export const updateDishBody = z
  .object({
    name: text(LIMITS.dishName),
    category: optionalText(LIMITS.dishCategory),
    description: optionalText(LIMITS.dishDescription),
    allergens: allergenMap,
    allergensReviewed: z.boolean(),
    visible: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
export const publicMenuSettingsBody = z.object({ enabled: z.boolean() });

/**
 * Orden lógico de las categorías de una carta (entrantes → principales → postres → bebidas).
 * Las categorías que no se reconocen van entre principales y postres, por orden alfabético;
 * los platos sin categoría, al final.
 */
const CATEGORY_GROUPS: [number, RegExp][] = [
  [0, /^(entrante|aperitivo|para picar|tapa|raci[oó]n|racion|ensalada|sopa|crema|primer|entrada|starter)/i],
  [1, /^(principal|segundo|plato|carne|pescado|marisco|arroz|paella|pasta|pizza|hamburgues|bocadillo|s[aá]ndwich|tosta|men[uú]|guiso|verdura|vegetal|huevo)/i],
  [3, /^(postre|dulce|helado|tarta)/i],
  [4, /^(bebida|vino|cerveza|refresco|caf[eé]|infusi[oó]n|c[oó]ctel|licor|zumo|agua)/i],
];
export function categoryRank(category: string | null | undefined): number {
  const c = (category ?? '').trim();
  if (!c) return 9;
  for (const [rank, re] of CATEGORY_GROUPS) if (re.test(c)) return rank;
  return 2;
}
export function compareMenuCategories(a: string | null | undefined, b: string | null | undefined): number {
  return categoryRank(a) - categoryRank(b) || (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// Auditoría: etiqueta legible de TODOS los eventos que emite el servidor
// ---------------------------------------------------------------------------
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  // Cuenta (no aparecen en la auditoría del local)
  'auth.register': 'Cuenta creada',
  'auth.email_verified': 'Email confirmado',
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Intento de entrada fallido',
  'auth.logout': 'Cierre de sesión',
  'auth.logout_all': 'Cierre de todas las sesiones',
  'auth.password_changed': 'Contraseña cambiada',
  'auth.password_reset_requested': 'Recuperación de contraseña solicitada',
  'auth.password_reset': 'Contraseña restablecida',
  'auth.email_change_requested': 'Cambio de email solicitado',
  'auth.email_changed': 'Email cambiado',
  'account.deleted': 'Cuenta eliminada',
  // Local
  'org.created': 'Local creado',
  'org.updated': 'Datos del local cambiados',
  'org.exported': 'Datos exportados',
  'org.deletion_scheduled': 'Eliminación del local programada',
  'org.restored': 'Local restaurado (eliminación cancelada)',
  'org.deleted': 'Local eliminado definitivamente',
  'member.invited': 'Invitación enviada',
  'member.invitation_revoked': 'Invitación anulada',
  'member.joined': 'Se unió al local',
  'member.role_changed': 'Rol cambiado',
  'member.removed': 'Acceso retirado',
  'device.created': 'Dispositivo de cocina vinculado',
  'device.revoked': 'Dispositivo de cocina desvinculado',
  'device.revoked_with_member': 'Dispositivo desvinculado al salir quien lo vinculó',
  'staff.pin_changed': 'PIN del personal cambiado',
  'staff.pin_failed': 'PIN incorrecto en la cocina',
  'staff.pin_locked': 'PIN bloqueado por intentos fallidos',
  'report.generated': 'Informe descargado',
  'public_menu.updated': 'Carta pública cambiada',
  'billing.checkout_started': 'Inicio de contratación',
  'billing.subscription_updated': 'Suscripción actualizada',
  'billing.subscription_canceled': 'Suscripción cancelada',
};

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

// ---------------------------------------------------------------------------
// Kiosko
// ---------------------------------------------------------------------------
/** Comprobación del PIN al identificarse en la tablet (antes de registrar nada). */
export const kioskVerifyPinBody = z.object({
  staffId: uuid,
  pin: z.string().max(12),
});
