/**
 * Datos iniciales de la demo: equivalentes a `server/src/scripts/seed-demo.ts` (mismo local, personal,
 * proveedores, platos y 30 días de registros generados con el mismo PRNG determinista), calculados
 * con la fecha actual del navegador.
 */
import { ALLERGENS } from '@shared/schemas';
import { correctiveActionsFor } from '../../../../server/src/scripts/seed-actions';
import type { AllergenMap, RecordType } from '@/api/types';
import { STATE_VERSION, type DemoState, type DRecord, type DStaff } from './state';
import { createOrganization } from './orgs';
import { isDue } from './tasks';
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

  const staff: DStaff[] = [
    { name: 'Ana Martín', pin: '1234' },
    { name: 'Luis Pérez', pin: null },
    { name: 'Marta Gil', pin: '5678' },
  ].map((s) => ({ id: uuid(), orgId: org.id, name: s.name, pin: s.pin, active: true, failed: 0, lockedUntil: null, createdAt: startTs }));
  db.staff.push(...staff);

  const suppliers = [
    { name: 'Frutas y Verduras Huerta Sol', contactName: 'Rosa', phone: '600 111 222', products: ['Tomate', 'Lechuga', 'Patata', 'Cebolla'] },
    { name: 'Carnes Hermanos López', contactName: 'Javier', phone: '600 333 444', products: ['Ternera', 'Pollo', 'Cerdo ibérico'] },
    { name: 'Pescados del Puerto', contactName: 'Carmen', phone: '600 555 666', products: ['Merluza', 'Gambas', 'Mejillones'] },
    { name: 'Lácteos La Vaca', contactName: null, phone: null, products: ['Leche', 'Nata', 'Queso manchego'] },
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
      push(
        date,
        10,
        'recepcion',
        {
          supplierId: s.id,
          supplierName: s.name,
          product,
          lot: `L${Math.floor(rand() * 90000 + 10000)}`,
          temperature: round1(1 + rand() * 3),
          maxTemperature: null,
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
  db.records = rows;
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
