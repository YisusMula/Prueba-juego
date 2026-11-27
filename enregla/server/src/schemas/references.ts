/**
 * Valores de referencia ORIENTATIVOS de los registros de cocinado, regeneración y enfriamiento, y
 * fuentes de todos los valores que trae la aplicación. Cada local puede cambiarlos (Ajustes → Datos del
 * local → Valores de referencia): la aplicación no garantiza por sí misma el cumplimiento de la
 * normativa; el plan de autocontrol del local manda.
 *
 * Fuentes consultadas el 27/11/2026 (detalle y citas en docs/VALORES-DE-REFERENCIA.md):
 *  [RD1086] Real Decreto 1086/2020, art. 30 (texto consolidado, apartado 11 modificado por el RD
 *           1021/2022): https://www.boe.es/buscar/act.php?id=BOE-A-2020-15872
 *           · 30.2 mantenimiento en caliente ≥ 63 °C · 30.3 refrigeración ≤ 4 °C (vida útil > 24 h) u
 *             ≤ 8 °C (< 24 h) · 30.4 congelación ≤ −18 °C · 30.6 enfriamiento de 60 °C a 10 °C en menos de
 *             2 horas · 30.7 recalentamiento ≥ 74 °C en el centro durante al menos 15 s (se admiten
 *             temperaturas inferiores si son equivalentes).
 *  [EUS]    Plan genérico de autocontrol en hostelería, Gobierno Vasco:
 *           https://www.euskadi.eus/contenidos/informacion/comedores_colectivos/es_def/adjuntos/Plan-generico-hosteleria.pdf
 *           · Temperatura de cocinado: 65 °C en el centro · Regeneración: 70 °C en el centro ·
 *             Enfriamiento en abatidor: < 10 °C en dos horas · Mantenimiento en caliente > 65 °C ·
 *             Aceite: compuestos polares < 25 % · cloro diario si el agua es de suministro propio o
 *             depósito · controles mensuales de buenas prácticas · registros de al menos 12 meses.
 *  [VAL]    Criterios de autocontrol en establecimientos de comidas preparadas, Conselleria de Sanitat
 *           (Comunitat Valenciana), rev. 2, 2013:
 *           https://seguridadycalidadalimentaria.fundacionusal.es/wp-content/uploads/guias/restauracion/criterios_autocontrol_establecimientos_comidas_preparadas_Valencia.pdf
 *           · Regeneración ≥ 65 °C en el centro · abatidor: < 10 °C en 2 horas · cloro libre residual
 *             ≥ 0,2 mg/l (depósito intermedio: semanal; abastecimiento propio: diario) · verificación de
 *             termómetros semestral · aceite < 25 % compuestos polares.
 *  [MAD]    Comunidad de Madrid, «¿Qué requisitos deben cumplir los restaurantes…?»:
 *           https://www.comunidad.madrid/salud/quiero-montar-restaurante-requisitos-sanitarios-debo-cumplir
 *           · recalentamiento > 74 °C en el centro al menos 15 s · enfriamiento de 60 °C a 10 °C en
 *             menos de 2 horas · mantenimiento en caliente ≥ 63 °C.
 *  [RD3]    Real Decreto 3/2023 (agua de consumo), anexo I, parte C, parámetro 45: cloro libre residual,
 *           valor paramétrico 1,0 mg/l; art. 36.6: la concentración mínima la fija la autoridad
 *           sanitaria. https://www.boe.es/buscar/act.php?id=BOE-A-2023-628
 */
import { z } from 'zod';

export interface ReferenceValues {
  /** Cocinado: temperatura mínima en el centro del producto (°C). */
  cookingMinTemp: number;
  /** Regeneración (recalentamiento): temperatura mínima en el centro del producto (°C). */
  reheatMinTemp: number;
  /** Enfriamiento rápido: temperatura máxima al terminar (°C). */
  coolingTargetTemp: number;
  /** Enfriamiento rápido: tiempo máximo (minutos). */
  coolingMaxMinutes: number;
}

/** Valores por defecto (orientativos). Ver la cabecera del fichero para la fuente de cada uno. */
export const REFERENCE_DEFAULTS: ReferenceValues = {
  // [EUS] «Temperatura de cocinado»: 65 °C en el centro. La normativa estatal no fija una cifra.
  cookingMinTemp: 65,
  // [RD1086] art. 30.7 (y [MAD]): 74 °C en el centro durante al menos 15 s. [EUS] usa 70 °C y [VAL] 65 °C.
  reheatMinTemp: 74,
  // [RD1086] art. 30.6, [EUS], [VAL], [MAD]: de 60 °C a 10 °C en menos de 2 horas.
  coolingTargetTemp: 10,
  coolingMaxMinutes: 120,
};

/** Temperatura de partida de referencia del enfriamiento ([RD1086] art. 30.6): solo informativa. */
export const COOLING_REFERENCE_START_TEMP = 60;

/** Márgenes admitidos al cambiar los valores (evitan errores de tecleo, no son criterios sanitarios). */
export const REFERENCE_BOUNDS: Record<keyof ReferenceValues, { min: number; max: number; unit: string; label: string }> = {
  cookingMinTemp: { min: 50, max: 100, unit: '°C', label: 'Cocinado: temperatura mínima en el centro del producto' },
  reheatMinTemp: { min: 60, max: 100, unit: '°C', label: 'Regeneración: temperatura mínima en el centro del producto' },
  coolingTargetTemp: { min: 0, max: 15, unit: '°C', label: 'Enfriamiento rápido: temperatura máxima al terminar' },
  coolingMaxMinutes: { min: 30, max: 360, unit: 'min', label: 'Enfriamiento rápido: tiempo máximo' },
};

/** Fuente legible de cada valor por defecto (se muestra junto al campo en Ajustes). */
export const REFERENCE_SOURCES: Record<keyof ReferenceValues, string> = {
  cookingMinTemp: 'Plan genérico de autocontrol en hostelería del Gobierno Vasco (65 °C en el centro). La normativa estatal no fija una cifra.',
  reheatMinTemp: 'RD 1086/2020, art. 30.7: al menos 74 °C en el centro durante 15 s (admite valores inferiores equivalentes; el plan vasco usa 70 °C).',
  coolingTargetTemp: 'RD 1086/2020, art. 30.6: de 60 °C a 10 °C en menos de dos horas.',
  coolingMaxMinutes: 'RD 1086/2020, art. 30.6: de 60 °C a 10 °C en menos de dos horas.',
};

const bounded = (k: keyof ReferenceValues) => {
  const b = REFERENCE_BOUNDS[k];
  const msg = `${b.label}: entre ${b.min} y ${b.max} ${b.unit}`;
  const base = z.number({ error: msg }).min(b.min, msg).max(b.max, msg);
  return k === 'coolingMaxMinutes' ? base.int('Escribe los minutos sin decimales') : base;
};

/** Cambio de los valores de referencia del local (parcial; `null` vuelve al valor por defecto). */
export const referenceValuesBody = z
  .object({
    cookingMinTemp: bounded('cookingMinTemp').nullable(),
    reheatMinTemp: bounded('reheatMinTemp').nullable(),
    coolingTargetTemp: bounded('coolingTargetTemp').nullable(),
    coolingMaxMinutes: bounded('coolingMaxMinutes').nullable(),
  })
  .partial()
  .strict();

/** Valores vigentes: los del local y, donde no haya, los de referencia. */
export function effectiveReferenceValues(stored: unknown): ReferenceValues {
  const out = { ...REFERENCE_DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(REFERENCE_DEFAULTS) as (keyof ReferenceValues)[]) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plantillas sugeridas de registros personalizados (se activan con un toque)
// ---------------------------------------------------------------------------
export interface SuggestedTemplate {
  key: string;
  name: string;
  kind: 'checklist' | 'numeric' | 'yesno';
  items?: string[];
  unit?: string;
  min?: number | null;
  max?: number | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand';
  timesPerDay?: number;
  weekday?: number | null;
  monthDay?: number | null;
  instructions: string;
  /** Para quién tiene sentido (se muestra al sugerirla). */
  when: string;
  source: string;
}

export const SUGGESTED_TEMPLATES: SuggestedTemplate[] = [
  {
    key: 'agua_cloro',
    name: 'Cloro libre del agua',
    kind: 'numeric',
    unit: 'mg/l',
    min: 0.2,
    max: 1,
    frequency: 'daily',
    timesPerDay: 1,
    instructions: 'Mide el cloro libre residual en un grifo de la cocina con el kit (DPD) y anota el resultado. Si sale fuera de rango, no uses el agua para cocinar ni limpiar y avisa al responsable.',
    when: 'Solo si el agua viene de un pozo o un depósito propio. Con agua de la red municipal sin depósito no hace falta.',
    source:
      'Plan genérico de hostelería del Gobierno Vasco (control diario de cloro con depósito o suministro propio); criterios de la Comunitat Valenciana (cloro libre residual ≥ 0,2 mg/l); RD 3/2023, anexo I parte C (valor paramétrico 1,0 mg/l).',
  },
  {
    key: 'termometros',
    name: 'Verificación de termómetros',
    kind: 'checklist',
    items: [
      'Termómetro de sonda comparado con el de referencia (diferencia de 1 °C o menos)',
      'Visores de cámaras y congeladores comparados con el termómetro de sonda',
      'Pilas y sonda en buen estado',
    ],
    frequency: 'on_demand',
    instructions: 'Compara cada termómetro con uno de referencia (o en agua con hielo, que debe marcar 0 °C). Anota cualquier diferencia y corrígela o cambia el termómetro.',
    when: 'Recomendado al menos cada seis meses.',
    source: 'Criterios de autocontrol de la Comunitat Valenciana: verificación semestral de los equipos de medida de temperatura.',
  },
  {
    key: 'mantenimiento',
    name: 'Mantenimiento de instalaciones y equipos',
    kind: 'checklist',
    items: [
      'Juntas de cámaras y congeladores en buen estado',
      'Superficies, paredes y suelos sin desperfectos',
      'Mosquiteras, desagües y rejillas en buen estado',
      'Iluminación protegida y funcionando',
      'Equipos de frío y calor funcionando correctamente',
    ],
    frequency: 'monthly',
    monthDay: 1,
    instructions: 'Revisa las instalaciones y anota lo que no está bien y qué vas a hacer (avisar al técnico, reparar…).',
    when: 'Para cualquier local.',
    source: 'Plan genérico de hostelería del Gobierno Vasco: controles mensuales de instalaciones y buenas prácticas.',
  },
  {
    key: 'buenas_practicas',
    name: 'Revisión de buenas prácticas de higiene',
    kind: 'checklist',
    items: [
      'Ropa de trabajo limpia y exclusiva',
      'Manos limpias, uñas cortas, sin joyas',
      'Alimentos tapados, etiquetados y separados (crudos y cocinados)',
      'Productos de limpieza en su sitio, lejos de los alimentos',
      'Sin cajas ni envases de cartón en la zona de elaboración',
    ],
    frequency: 'monthly',
    monthDay: 1,
    instructions: 'Revisa la cocina y al personal. Si algo no se cumple, explícalo en la acción correctora y recuérdalo al equipo.',
    when: 'Para cualquier local.',
    source: 'Plan genérico de hostelería del Gobierno Vasco: registro mensual de control de buenas prácticas.',
  },
];
