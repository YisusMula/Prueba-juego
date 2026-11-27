/**
 * Datos iniciales de la demo: equivalentes a `server/src/scripts/seed-demo.ts` (mismo local, personal,
 * proveedores, platos y 30 días de registros generados con el mismo PRNG determinista), calculados
 * con la fecha actual del navegador.
 */
import { ALLERGENS, REFERENCE_DEFAULTS, SUGGESTED_TEMPLATES } from '@shared/schemas';
import { correctiveActionsFor } from '../../../../server/src/scripts/seed-actions';
import type { AllergenMap, RecordType } from '@/api/types';
import { STATE_VERSION, type DemoState, type DRecord, type DStaff, type DTemplate } from './state';
import { createOrganization } from './orgs';
import { isDue, periodSnapshot } from './tasks';
import { newDeviceToken, uuid } from './ids';
import { addDays, isoWeekday, localDate, localHour, localInstant } from './time';

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'Demo-EnRegla-2026';
export const DEMO_USER_NAME = 'Usuario Demo';
export const TZ = 'Europe/Madrid';
/** IP de ejemplo (rango reservado para documentación) para la auditoría de la demo. */
const SAMPLE_IP = '192.0.2.24';

export function emptyState(seededOn: string): DemoState {
  return {
    version: STATE_VERSION,
    seededOn,
    sessionUserId: null,
    users: [],
    orgs: [],
    memberships: [],
    staff: [],
    devices: [],
    equipment: [],
    plans: [],
    suppliers: [],
    dishes: [],
    records: [],
    templates: [],
    verifications: [],
    invitations: [],
    audit: [],
    auditSeq: 0,
    idempotency: {},
    pinFailsByDevice: {},
  };
}

export function seedDemo(nowMs = Date.now()): DemoState {
  // PRNG determinista (mulberry32), la misma semilla que el seed del servidor.
  let seed = 20261109;
  const rand = (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const today = localDate(new Date(nowMs), TZ);
  const db = emptyState(today);
  const start = addDays(today, -30);
  const startTs = localInstant(start, TZ);

  const user = { id: uuid(), email: DEMO_EMAIL, name: DEMO_USER_NAME, password: DEMO_PASSWORD, createdAt: startTs, trialEndsAt: startTs + 14 * 86_400_000 };
  db.users.push(user);
  db.sessionUserId = user.id;
  const org = createOrganization(db, { name: 'Restaurante La Demo', businessType: 'restaurante', timezone: TZ, ownerId: user.id, now: startTs });
  // Suscripción activa (sin Stripe), carta pública activada y configuración «antigua» para que cuenten los 30 días.
  org.subscriptionStatus = 'active';
  org.publicMenuEnabled = true;
  // Fase 2: datos del establecimiento (ficticios) para la portada del PDF, como el seed del servidor.
  Object.assign(org, {
    legalName: 'Restauración La Demo S.L.',
    taxId: 'B12345674',
    address: 'Calle Mayor 12',
    postalCode: '28013',
    city: 'Madrid',
    province: 'Madrid',
    sanitaryRegistry: '26.012345/M',
  });
  // Registros personalizados sugeridos: cloro del agua, verificación de termómetros y buenas prácticas.
  const templates: DTemplate[] = ['agua_cloro', 'termometros', 'buenas_practicas'].map((key) => {
    const t = SUGGESTED_TEMPLATES.find((x) => x.key === key)!;
    const freq = { frequency: t.frequency, timesPerDay: t.timesPerDay ?? 1, weekday: t.weekday ?? null, monthDay: t.monthDay ?? null };
    return {
      id: uuid(),
      orgId: org.id,
      name: t.name,
      kind: t.kind,
      items: (t.items ?? []).map((label) => ({ id: uuid(), label })),
      unit: t.unit ?? null,
      min: t.min ?? null,
      max: t.max ?? null,
      ...freq,
      instructions: t.instructions,
      reminderMonths: t.reminderMonths ?? null,
      suggestionKey: t.key,
      source: t.source,
      active: true,
      createdAt: startTs,
      history: [{ validFrom: startTs, ...freq, active: true, name: t.name }],
    };
  });
  db.templates.push(...templates);

  const staff: DStaff[] = [
    { name: 'Ana Martín', pin: '1234' },
    { name: 'Luis Pérez', pin: null },
    { name: 'Marta Gil', pin: '5678' },
  ].map((s) => ({ id: uuid(), orgId: org.id, name: s.name, pin: s.pin, active: true, failed: 0, lockedUntil: null, createdAt: startTs }));
  db.staff.push(...staff);

  const suppliers = [
    { name: 'Frutas y Verduras Huerta Sol', contactName: 'Rosa', phone: '600 111 222', products: ['Tomate', 'Lechuga', 'Patata', 'Cebolla'], defaultCategory: 'ambiente' as const },
    { name: 'Carnes Hermanos López', contactName: 'Javier', phone: '600 333 444', products: ['Ternera', 'Pollo', 'Cerdo ibérico'], defaultCategory: 'refrigerado' as const },
    { name: 'Pescados del Puerto', contactName: 'Carmen', phone: '600 555 666', products: ['Merluza', 'Gambas', 'Mejillones'], defaultCategory: 'refrigerado' as const },
    { name: 'Lácteos La Vaca', contactName: null, phone: null, products: ['Leche', 'Nata', 'Queso manchego'], defaultCategory: 'refrigerado' as const },
  ].map((s) => ({ id: uuid(), orgId: org.id, email: null, notes: null, createdAt: startTs, ...s }));
  db.suppliers.push(...suppliers);

  const allNo = Object.fromEntries(ALLERGENS.map((a) => [a, 'no'])) as AllergenMap;
  const dishes: { name: string; category: string; a: Partial<AllergenMap>; pending?: boolean }[] = [
    { name: 'Croquetas de jamón', category: 'Entrantes', a: { gluten: 'contains', milk: 'contains', eggs: 'contains' } },
    { name: 'Ensalada de la huerta', category: 'Entrantes', a: { mustard: 'contains', sulphites: 'traces' } },
    { name: 'Gambas al ajillo', category: 'Entrantes', a: { crustaceans: 'contains' } },
    { name: 'Merluza a la romana', category: 'Principales', a: { fish: 'contains', gluten: 'contains', eggs: 'contains' } },
    { name: 'Entrecot a la brasa', category: 'Principales', a: {} },
    { name: 'Mejillones a la marinera', category: 'Principales', a: { molluscs: 'contains', celery: 'contains', sulphites: 'contains' } },
    { name: 'Tarta de queso', category: 'Postres', a: { milk: 'contains', eggs: 'contains', gluten: 'contains', nuts: 'traces' } },
    { name: 'Flan casero', category: 'Postres', a: { milk: 'contains', eggs: 'contains' } },
    { name: 'Agua mineral', category: 'Bebidas', a: {} },
    // Plato recién añadido, con los alérgenos SIN REVISAR: no sale en la carta pública.
    { name: 'Pulpo a la gallega', category: 'Principales', a: {}, pending: true },
  ];
  for (const d of dishes) {
    db.dishes.push({
      id: uuid(),
      orgId: org.id,
      name: d.name,
      category: d.category,
      description: null,
      allergens: { ...allNo, ...d.a },
      allergensReviewed: !d.pending,
      allergensReviewedAt: d.pending ? null : startTs,
      visible: true,
      createdAt: startTs,
      updatedAt: startTs,
    });
  }

  const device = { id: uuid(), orgId: org.id, name: 'Tablet cocina', token: newDeviceToken(), createdBy: user.id, createdAt: startTs, lastUsedAt: null as number | null, revokedAt: null };
  db.devices.push(device);

  const equipment = db.equipment.filter((e) => e.orgId === org.id);
  const plans = db.plans.filter((p) => p.orgId === org.id);
  const fryer = equipment.find((e) => e.type === 'freidora');
  const nowHour = localHour(nowMs, TZ);

  const rows: DRecord[] = [];
  const push = (date: string, hour: number, type: RecordType, data: Record<string, unknown>, extra: Partial<DRecord> = {}) => {
    if (date === today && hour >= nowHour) return; // nada en el futuro
    const s = extra.userId ? null : pick(staff);
    const at = localInstant(date, TZ, hour, Math.floor(rand() * 50));
    rows.push({
      id: uuid(),
      orgId: org.id,
      type,
      data,
      staffId: s?.id ?? null,
      staffName: s?.name ?? null,
      deviceId: s ? (rand() < 0.7 ? device.id : null) : null,
      userId: null,
      userName: null,
      equipmentId: null,
      cleaningPlanId: null,
      amendsRecordId: null,
      amendmentReason: null,
      alert: false,
      createdAt: at,
      effectiveAt: at,
      ...extra,
    });
  };

  let mondays = 0;
  for (let i = 0; i <= 30; i++) {
    const date = addDays(start, i);
    for (const e of equipment) {
      const hours = [9, 17, 13, 20, 11, 15].slice(0, e.checksPerDay);
      for (const h of hours) {
        if (rand() < 0.06) continue; // algún control olvidado
        let value: number;
        if (e.maxTemp != null && e.minTemp == null) value = round1(e.maxTemp - 0.5 - rand() * 3);
        else if (e.minTemp != null && e.maxTemp == null) value = round1(e.minTemp + 2 + rand() * 10);
        else value = round1(((e.minTemp ?? 0) + (e.maxTemp ?? 4)) / 2);
        let outOfRange = false;
        let correctiveAction: string | null = null;
        if (rand() < 0.04) {
          value = e.maxTemp != null ? round1(e.maxTemp + 1.5 + rand() * 3) : round1((e.minTemp ?? 63) - 4);
          outOfRange = true;
          correctiveAction = pick(correctiveActionsFor(e.type));
        }
        push(date, h, 'temperatura', { equipmentId: e.id, equipmentName: e.name, value, minTemp: e.minTemp, maxTemp: e.maxTemp, outOfRange, correctiveAction }, { equipmentId: e.id, alert: outOfRange });
      }
    }
    for (const p of plans) {
      if (!isDue(p, date) || rand() < 0.08) continue;
      const items = p.items.map((it) => ({ itemId: it.id, area: it.area, done: rand() > 0.05 }));
      push(date, 22, 'limpieza', { cleaningPlanId: p.id, planName: p.name, items, completed: items.every((x) => x.done), observations: null }, { cleaningPlanId: p.id });
    }
    const deliveries = isoWeekday(date) === 7 ? 0 : 1 + Math.floor(rand() * 2);
    for (let d = 0; d < deliveries; d++) {
      const s = pick(suppliers);
      const product = pick(s.products);
      const accepted = rand() > 0.05;
      const chilled = s.defaultCategory === 'refrigerado';
      push(
        date,
        10,
        'recepcion',
        {
          supplierId: s.id,
          supplierName: s.name,
          product,
          lot: `L${Math.floor(rand() * 90000 + 10000)}`,
          temperature: chilled ? round1(1 + rand() * 3) : null,
          category: s.defaultCategory,
          categoryAssumed: false,
          maxTemperature: chilled ? 4 : null,
          minTemperature: null,
          temperatureOutOfRange: false,
          expiryDate: addDays(date, 3 + Math.floor(rand() * 10)),
          expired: false,
          accepted,
          rejectionReason: accepted ? null : 'Envase dañado / temperatura de llegada superior a la acordada',
          correctiveAction: null,
        },
        { alert: !accepted },
      );
    }
    if (fryer) {
      const change = i % 5 === 4;
      const polar = round1(change ? 22 + rand() * 4 : 8 + (i % 5) * 3.5 + rand() * 2);
      const overLimit = polar > 25;
      push(
        date,
        12,
        'aceite',
        { equipmentId: fryer.id, fryerName: fryer.name, action: change ? 'cambiado' : 'revisado', polarCompounds: polar, overLimit, correctiveAction: overLimit ? 'Aceite sustituido' : null },
        { equipmentId: fryer.id, alert: overLimit },
      );
    }
    // Fase 2 — cocinado y regeneración, enfriamiento rápido en dos registros y registros personalizados.
    const lowCook = i === 9;
    push(date, 13, 'cocinado', {
      product: pick(['Pollo asado', 'Albóndigas en salsa', 'Merluza al horno', 'Hamburguesa de ternera', 'Tortilla de patata']),
      process: 'cocinado',
      freshEgg: false,
      coreTemp: lowCook ? 61.5 : round1(70 + rand() * 12),
      minutes: 20 + Math.floor(rand() * 40),
      referenceTemp: REFERENCE_DEFAULTS.cookingMinTemp,
      outOfRange: lowCook,
      correctiveAction: lowCook ? 'Se prolongó la cocción hasta superar 70 °C en el centro' : null,
    }, { alert: lowCook });
    if (i % 2 === 0) {
      const lowReheat = i === 16;
      push(date, 20, 'cocinado', {
        product: pick(['Lentejas estofadas', 'Crema de verduras', 'Callos a la madrileña']),
        process: 'regeneracion',
        coreTemp: lowReheat ? 68 : round1(75 + rand() * 8),
        minutes: null,
        referenceTemp: REFERENCE_DEFAULTS.reheatMinTemp,
        outOfRange: lowReheat,
        correctiveAction: lowReheat ? 'Se volvió a calentar hasta 78 °C antes de servir' : null,
      }, { alert: lowReheat });
    }
    if (i % 3 === 1 || date === today) {
      const product = pick(['Caldo de ave', 'Fondo oscuro', 'Arroz para ensalada', 'Salsa de tomate']);
      // Un día empieza ya templado (por debajo de 60 °C): se anota el motivo (H-M3).
      const warm = i === 7;
      const startTemp = warm ? 52 : round1(68 + rand() * 12);
      const startHour = date === today ? Math.max(0, nowHour - 1) : 16;
      const before = rows.length;
      push(date, startHour, 'enfriamiento', {
        phase: 'inicio',
        product,
        startTemp,
        startReferenceTemp: REFERENCE_DEFAULTS.coolingStartTemp,
        belowStartReference: warm,
        startReason: warm ? 'Ya venía templado: sobrante del servicio de mediodía' : null,
        notes: 'En abatidor',
      });
      if (rows.length > before && date !== today) {
        const st = rows[rows.length - 1]!;
        const slow = i === 13;
        const minutes = slow ? 150 : 85 + Math.floor(rand() * 30);
        const endedAt = st.createdAt + minutes * 60_000;
        rows.push({
          ...st,
          id: uuid(),
          data: {
            phase: 'fin',
            startRecordId: st.id,
            product,
            startTemp,
            startedAt: new Date(st.createdAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            endTemp: slow ? 9 : round1(3 + rand() * 5),
            minutes,
            targetTemp: REFERENCE_DEFAULTS.coolingTargetTemp,
            maxMinutes: REFERENCE_DEFAULTS.coolingMaxMinutes,
            overTemp: false,
            overTime: slow,
            discarded: false,
            outOfRange: slow,
            correctiveAction: slow ? 'El abatidor iba sobrecargado: producto regenerado y consumido en el día' : null,
          },
          relatedRecordId: st.id,
          alert: slow,
          createdAt: endedAt,
          effectiveAt: endedAt,
        });
      }
    }
    const chlorine = templates[0]!;
    if (rand() > 0.1) {
      const low = i === 21;
      push(date, 9, 'personalizado', {
        templateId: chlorine.id,
        templateName: chlorine.name,
        kind: 'numeric',
        notes: null,
        reading: low ? 0.1 : round1(0.3 + rand() * 0.5),
        unit: chlorine.unit,
        min: chlorine.min,
        max: chlorine.max,
        outOfRange: low,
        correctiveAction: low ? 'Recloración del depósito y nueva medición a la hora: 0,4 mg/l' : null,
      }, { customTemplateId: chlorine.id, alert: low });
    }
    if (date.endsWith('-01')) {
      const bp = templates[2]!;
      push(date, 11, 'personalizado', {
        templateId: bp.id,
        templateName: bp.name,
        kind: 'checklist',
        notes: null,
        items: bp.items.map((it, n) => ({ itemId: it.id, label: it.label, ok: n !== 4 })),
        failed: 1,
        correctiveAction: 'Retiradas las cajas de cartón de la zona de elaboración y recordado al equipo',
      }, { customTemplateId: bp.id, alert: true });
    }
    if (i === 10) {
      const th = templates[1]!;
      push(date, 12, 'personalizado', {
        templateId: th.id,
        templateName: th.name,
        kind: 'checklist',
        notes: 'Comparado con el termómetro de referencia en agua con hielo',
        items: th.items.map((it) => ({ itemId: it.id, label: it.label, ok: true })),
        failed: 0,
        correctiveAction: null,
      }, { customTemplateId: th.id });
    }
    if (isoWeekday(date) === 1) {
      mondays += 1;
      const signs = mondays === 3;
      push(
        date,
        8,
        'plagas',
        {
          result: signs ? 'con_indicios' : 'sin_indicios',
          description: signs ? 'Restos de roedor junto al almacén de secos' : null,
          action: signs ? 'Aviso a la empresa de control de plagas y refuerzo de limpieza' : null,
        },
        { alert: signs },
      );
    }
  }
  const incDate = addDays(today, -12);
  push(incDate, 16, 'incidencia', { description: 'Avería del lavavajillas durante el servicio', correctiveAction: 'Lavado manual con desinfección hasta la reparación', closed: false }, { alert: true });
  push(addDays(today, -2), 19, 'incidencia', { description: 'Corte de luz de 40 minutos', correctiveAction: 'Comprobadas temperaturas de cámaras tras el corte', closed: false }, { alert: true });
  push(addDays(today, -20), 11, 'formacion', {
    traineeStaffId: staff[1]!.id,
    traineeName: staff[1]!.name,
    course: 'Manipulador de alimentos (nivel básico)',
    trainingDate: addDays(today, -20),
    trainer: 'Academia Hostelería Segura',
    hours: 10,
  });
  push(addDays(today, -6), 11, 'formacion', {
    traineeStaffId: staff[2]!.id,
    traineeName: staff[2]!.name,
    course: 'Gestión de alérgenos en cocina',
    trainingDate: addDays(today, -6),
    trainer: 'Formación interna',
    hours: 3,
  });

  // Enmiendas: cierre de la primera incidencia y corrección de una temperatura mal tecleada.
  const byCreated = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  const inc = byCreated.find((r) => r.type === 'incidencia');
  if (inc) {
    const at = localInstant(addDays(incDate, 1), TZ, 10, 5);
    rows.push({
      ...inc,
      id: uuid(),
      data: { ...inc.data, correctiveAction: 'Técnico repara el lavavajillas; verificada temperatura de aclarado', closed: true },
      staffId: null,
      staffName: null,
      deviceId: null,
      userId: user.id,
      userName: user.name,
      amendsRecordId: inc.id,
      amendmentReason: 'Incidencia resuelta',
      alert: false,
      createdAt: at,
      effectiveAt: inc.effectiveAt,
    });
  }
  const bad = byCreated.find((r) => r.type === 'temperatura' && r.alert);
  if (bad) {
    const d = bad.data as { maxTemp: number | null; minTemp: number | null };
    const fixedValue = d.maxTemp != null ? round1(Number(d.maxTemp) - 1) : round1(Number(d.minTemp ?? 63) + 5);
    rows.push({
      ...bad,
      id: uuid(),
      data: { ...bad.data, value: fixedValue, outOfRange: false, correctiveAction: null },
      staffId: null,
      staffName: null,
      deviceId: null,
      userId: user.id,
      userName: user.name,
      amendsRecordId: bad.id,
      amendmentReason: `Error al anotar: el termómetro marcaba ${String(fixedValue).replace('.', ',')} °C`,
      alert: false,
      createdAt: bad.createdAt + 20 * 60_000,
      effectiveAt: bad.effectiveAt,
    });
  }
  // Los cierres de enfriamiento se añadieron tras su inicio, pero el orden de inserción es el de su hora.
  db.records = rows.sort((a, b) => a.createdAt - b.createdAt);
  // Verificación del responsable de las semanas anteriores (la última semana queda sin revisar).
  const thisMonday = addDays(today, 1 - isoWeekday(today));
  for (let w = 2; w <= 4; w++) {
    const from = addDays(thisMonday, -7 * w);
    const to = addDays(from, 6);
    if (from < start) continue;
    db.verifications.push({
      id: uuid(),
      orgId: org.id,
      from,
      to,
      kind: 'week',
      comment: w === 3 ? 'Revisadas las alertas de la cámara de carnes con el equipo' : null,
      userId: user.id,
      userName: user.name,
      userRole: 'owner',
      createdAt: localInstant(addDays(to, 1), TZ, 10, 15),
      snapshot: periodSnapshot(db, org, from, to, localInstant(addDays(to, 1), TZ, 10, 15)),
    });
  }
  device.lastUsedAt = rows.filter((r) => r.deviceId === device.id).reduce((m, r) => Math.max(m, r.createdAt), 0) || null;

  // Actividad de ejemplo para el registro de auditoría.
  const audit = (event: string, at: number, metadata: Record<string, unknown> = {}, userId: string | null = user.id) => {
    db.auditSeq += 1;
    db.audit.push({ id: db.auditSeq, orgId: org.id, event, userId, ip: userId ? SAMPLE_IP : null, metadata, createdAt: at });
  };
  audit('org.created', startTs + 60_000, { businessType: 'restaurante' });
  audit('device.created', startTs + 5 * 60_000, { deviceId: device.id, name: device.name });
  audit('public_menu.updated', startTs + 10 * 60_000, { enabled: true });
  audit('staff.pin_changed', startTs + 12 * 60_000, { staffId: staff[0]!.id, removed: false });
  audit('org.updated', localInstant(addDays(today, -15), TZ, 9, 30), { fields: ['reminderHour'] });
  audit('report.generated', localInstant(addDays(today, -7), TZ, 18, 12), { format: 'pdf', from: addDays(today, -37), to: addDays(today, -7), types: [] });
  audit('staff.pin_failed', localInstant(addDays(today, -3), TZ, 13, 2), { staffId: staff[2]!.id, deviceId: device.id }, null);
  return db;
}
