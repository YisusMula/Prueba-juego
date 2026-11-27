/**
 * Datos del establecimiento (portada del PDF), plantillas de registros personalizados y verificación
 * del responsable. Solo depende de `zod`.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// NIF / CIF / NIE
// ---------------------------------------------------------------------------
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Quita espacios, guiones y puntos y pasa a mayúsculas. */
export function normalizeTaxId(v: string): string {
  return v.replace(/[\s.\-\u00A0]/g, '').toUpperCase();
}

/**
 * Comprueba un NIF (DNI con letra), NIE (X/Y/Z) o CIF/NIF de persona jurídica, con su carácter de
 * control. Devuelve null si es válido o el motivo si no lo es. Recibe el valor ya normalizado.
 */
export function taxIdError(id: string): string | null {
  if (/^\d{8}[A-Z]$/.test(id)) {
    return DNI_LETTERS[Number(id.slice(0, 8)) % 23] === id[8] ? null : 'La letra del NIF no corresponde al número';
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const n = Number(String('XYZ'.indexOf(id[0]!)) + id.slice(1, 8));
    return DNI_LETTERS[n % 23] === id[8] ? null : 'La letra del NIE no corresponde al número';
  }
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const digits = id.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) {
        const x = d * 2;
        sum += Math.floor(x / 10) + (x % 10);
      } else sum += d;
    }
    const c = (10 - (sum % 10)) % 10;
    const letter = 'JABCDEFGHI'[c]!;
    const ctrl = id[8]!;
    // Persona jurídica: unos tipos llevan letra, otros número y el resto admite los dos.
    const mustLetter = 'KPQRSNW'.includes(id[0]!);
    const mustDigit = 'ABEH'.includes(id[0]!);
    const ok = mustLetter ? ctrl === letter : mustDigit ? ctrl === String(c) : ctrl === letter || ctrl === String(c);
    return ok ? null : 'El carácter de control del CIF no es correcto';
  }
  return 'Escribe un NIF, NIE o CIF válido (por ejemplo, B12345674 o 12345678Z)';
}

// ---------------------------------------------------------------------------
// Registro Sanitario (RGSEAA) o autorización sanitaria autonómica
// ---------------------------------------------------------------------------
/**
 * Formato habitual del número de inscripción en el RGSEAA: «NN.NNNNN/XX» (clave de actividad, número y
 * provincia; el número puede tener 5 o 6 cifras). Las autorizaciones autonómicas tienen otros formatos,
 * así que si no encaja se acepta igualmente y solo se avisa.
 */
export const SANITARY_REGISTRY_RE = /^\d{2}\.\d{5,6}\/[A-Z]{1,3}$/;
export function sanitaryRegistryLooksValid(v: string | null | undefined): boolean {
  return !v || SANITARY_REGISTRY_RE.test(v.trim().toUpperCase());
}
export const SANITARY_REGISTRY_HINT =
  'El formato habitual del Registro Sanitario (RGSEAA) es NN.NNNNN/XX, por ejemplo 26.012345/M. Si tu número es una autorización autonómica con otro formato, puedes guardarlo igualmente.';

/** Código postal español (01–52). */
export const POSTAL_CODE_RE = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/;

export const ESTABLISHMENT_LIMITS = { legalName: 200, taxId: 20, address: 300, postalCode: 10, city: 100, province: 100, sanitaryRegistry: 60 } as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

/** Campos del establecimiento (todos opcionales; `null` o '' los deja vacíos). */
export const establishmentFields = {
  legalName: optText(ESTABLISHMENT_LIMITS.legalName),
  taxId: z
    .string()
    .trim()
    .max(ESTABLISHMENT_LIMITS.taxId)
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeTaxId(v);
      const err = taxIdError(n);
      if (err) {
        ctx.addIssue({ code: 'custom', message: err });
        return z.NEVER;
      }
      return n;
    }),
  address: optText(ESTABLISHMENT_LIMITS.address),
  postalCode: z
    .string()
    .trim()
    .max(ESTABLISHMENT_LIMITS.postalCode)
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!POSTAL_CODE_RE.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Escribe un código postal de 5 cifras (por ejemplo, 28001)' });
        return z.NEVER;
      }
      return v;
    }),
  city: optText(ESTABLISHMENT_LIMITS.city),
  province: optText(ESTABLISHMENT_LIMITS.province),
  /** Texto libre: si no sigue el formato habitual se guarda igual (la app avisa). */
  sanitaryRegistry: z
    .string()
    .trim()
    .max(ESTABLISHMENT_LIMITS.sanitaryRegistry)
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, ' ') : null)),
};
export type EstablishmentKey = keyof typeof establishmentFields;
export const ESTABLISHMENT_KEYS = Object.keys(establishmentFields) as EstablishmentKey[];
export const ESTABLISHMENT_LABELS: Record<EstablishmentKey, string> = {
  legalName: 'Razón social',
  taxId: 'NIF / CIF',
  address: 'Dirección',
  postalCode: 'Código postal',
  city: 'Municipio',
  province: 'Provincia',
  sanitaryRegistry: 'Nº de Registro Sanitario (RGSEAA) o autorización',
};

/** Dirección completa en una línea (vacía si no hay ningún dato). */
export function fullAddress(e: { address?: string | null; postalCode?: string | null; city?: string | null; province?: string | null }): string {
  const place = [e.postalCode, e.city].filter(Boolean).join(' ');
  const prov = e.province && e.province !== e.city ? `(${e.province})` : '';
  return [e.address, [place, prov].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Plantillas de registros personalizados
// ---------------------------------------------------------------------------
export const CUSTOM_KINDS = ['checklist', 'numeric', 'yesno'] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];
export const CUSTOM_KIND_LABELS: Record<CustomKind, string> = { checklist: 'Lista de comprobación', numeric: 'Valor con número', yesno: 'Sí / No' };
export const CUSTOM_FREQUENCIES = ['daily', 'weekly', 'monthly', 'on_demand'] as const;
export type CustomFrequency = (typeof CUSTOM_FREQUENCIES)[number];
export const CUSTOM_FREQUENCY_LABELS: Record<CustomFrequency, string> = { daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual', on_demand: 'Cuando ocurra' };

const tplItem = z.object({ id: z.string().min(1).max(64).optional(), label: z.string().trim().min(1, 'Escribe el punto a comprobar').max(200) });
const tplFields = {
  name: z.string().trim().min(1, 'Escribe el nombre del registro').max(120),
  items: z.array(tplItem).max(50, 'Como máximo 50 puntos'),
  unit: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .transform((v) => (v ? v : null)),
  min: z.number().min(-1_000_000).max(1_000_000).nullable(),
  max: z.number().min(-1_000_000).max(1_000_000).nullable(),
  frequency: z.enum(CUSTOM_FREQUENCIES, { error: 'Elige la frecuencia' }),
  timesPerDay: z.number().int().min(1, 'Al menos 1 vez al día').max(12, 'Como máximo 12 veces al día'),
  weekday: z.number().int().min(1).max(7).nullable(),
  monthDay: z.number().int().min(1).max(28).nullable(),
  instructions: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((v) => (v ? v : null)),
  active: z.boolean(),
  /** Aviso en Hoy (y en el email) si pasan estos meses sin registrarlo; útil para «cuando ocurra». */
  reminderMonths: z.number().int().min(1, 'Al menos 1 mes').max(36, 'Como máximo 36 meses').nullable(),
};

function checkTemplate(t: Partial<{ kind: CustomKind; items: unknown[]; min: number | null; max: number | null; frequency: CustomFrequency; weekday: number | null; monthDay: number | null }>, ctx: z.RefinementCtx) {
  if (t.kind === 'checklist' && t.items !== undefined && t.items.length === 0) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Añade al menos un punto a comprobar' });
  if (t.min != null && t.max != null && t.min > t.max) ctx.addIssue({ code: 'custom', path: ['min'], message: 'El mínimo no puede ser mayor que el máximo' });
  if (t.frequency === 'weekly' && t.weekday == null) ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'Indica el día de la semana' });
  if (t.frequency === 'monthly' && t.monthDay == null) ctx.addIssue({ code: 'custom', path: ['monthDay'], message: 'Indica el día del mes' });
}

export const createCustomTemplateBody = z
  .object({
    ...tplFields,
    kind: z.enum(CUSTOM_KINDS, { error: 'Elige el tipo de registro' }),
    items: tplFields.items.default([]),
    unit: tplFields.unit.optional().transform((v) => v ?? null),
    min: tplFields.min.optional().transform((v) => v ?? null),
    max: tplFields.max.optional().transform((v) => v ?? null),
    timesPerDay: tplFields.timesPerDay.default(1),
    weekday: tplFields.weekday.default(null),
    monthDay: tplFields.monthDay.default(null),
    instructions: tplFields.instructions.optional().transform((v) => v ?? null),
    active: tplFields.active.default(true),
    reminderMonths: tplFields.reminderMonths.optional().transform((v) => v ?? null),
  })
  .superRefine(checkTemplate);

/** El tipo (lista, número, sí/no) no se cambia: los registros ya hechos lo usan. */
export const updateCustomTemplateBody = z
  .object(tplFields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios')
  .superRefine(checkTemplate);

export const activateSuggestionBody = z.object({ key: z.string().min(1).max(40) });

// ---------------------------------------------------------------------------
// Verificación del responsable
// ---------------------------------------------------------------------------
export const VERIFICATION_KINDS = ['week', 'month', 'custom'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export const VERIFICATION_KIND_LABELS: Record<VerificationKind, string> = { week: 'Semana', month: 'Mes', custom: 'Periodo' };
