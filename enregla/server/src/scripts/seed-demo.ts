/**
 * Crea (o recrea) un usuario demo con un local y 30 días de registros de ejemplo.
 * Uso: npm run seed:demo   (requiere DATABASE_URL; aplica migraciones si faltan)
 */
import { sql, type InsertObject } from 'kysely';
import { createDb, createPool, json } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { hashSecret } from '../lib/password.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { addDays, isoWeekday, localDate } from '../lib/dates.js';
import { createOrganization } from '../modules/orgs/routes.js';
import { isDue } from '../modules/tasks/service.js';
import { periodSnapshot } from '../modules/reports/summary.js';
import { ALLERGENS, REFERENCE_DEFAULTS, SUGGESTED_TEMPLATES } from '../schemas/index.js';
import type { Database, Staff } from '../db/types.js';
import { correctiveActionsFor } from './seed-actions.js';

type NewRecord = InsertObject<Database, 'records'>;

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'Demo-EnRegla-2026';
const TZ = 'Europe/Madrid';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL es obligatorio');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Negado: no se ejecuta el seed demo en producción (define ALLOW_DEMO_SEED=true si de verdad lo quieres).');
  process.exit(1);
}

// PRNG determinista (mulberry32) para datos reproducibles.
let seed = 20261109;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const round1 = (n: number) => Math.round(n * 10) / 10;

const pool = createPool(url, 2);
const db = createDb(pool);

try {
  // Con roles separados (1.8) el rol de la app no puede migrar: MIGRATE_ON_START=false lo omite.
  if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(pool, (m) => console.log(m));

  // Limpieza de una ejecución anterior
  const old = await db.selectFrom('users').select('id').where('email', '=', DEMO_EMAIL).executeTakeFirst();
  if (old) {
    const orgs = await db.selectFrom('memberships').select('organization_id').where('user_id', '=', old.id).where('role', '=', 'owner').execute();
    // El seed se ejecuta con el rol propietario (o superusuario): borra directamente los locales demo
    // anteriores (la app no puede hacerlo; ver E2E_SEED_DATABASE_URL).
    for (const o of orgs) await db.deleteFrom('organizations').where('id', '=', o.organization_id).execute();
    await db.deleteFrom('users').where('id', '=', old.id).execute();
  }

  const user = await db
    .insertInto('users')
    .values({ email: DEMO_EMAIL, name: 'Usuario Demo', password_hash: await hashSecret(DEMO_PASSWORD), email_verified_at: new Date() })
    .returningAll()
    .executeTakeFirstOrThrow();
  const org = await createOrganization(db, { name: 'Restaurante La Demo', businessType: 'restaurante', timezone: TZ, ownerId: user.id, trialDays: 14 });
  const start = addDays(localDate(new Date(), TZ), -30);
  const startTs = sql<Date>`((${start}::date)::timestamp AT TIME ZONE ${TZ})`;
  // Datos de demostración: suscripción activa (sin Stripe) y configuración "antigua" para que el cumplimiento cuente 30 días.
  await db
    .updateTable('organizations')
    .set({
      subscription_status: 'active',
      public_menu_enabled: true,
      created_at: startTs,
      // Fase 2: datos del establecimiento (ficticios) para la portada del PDF.
      legal_name: 'Restauración La Demo S.L.',
      tax_id: 'B12345674',
      address: 'Calle Mayor 12',
      postal_code: '28013',
      city: 'Madrid',
      province: 'Madrid',
      sanitary_registry: '26.012345/M',
    })
    .where('id', '=', org.id)
    .execute();
  await db.updateTable('equipment').set({ created_at: startTs }).where('organization_id', '=', org.id).execute();
  await db.updateTable('cleaning_plans').set({ created_at: startTs }).where('organization_id', '=', org.id).execute();
  await db.updateTable('memberships').set({ created_at: startTs }).where('organization_id', '=', org.id).execute();

  const staffDefs = [
    { name: 'Ana Martín', pin: '1234' },
    { name: 'Luis Pérez', pin: null },
    { name: 'Marta Gil', pin: '5678' },
  ];
  const staff: Staff[] = [];
  for (const s of staffDefs) {
    staff.push(
      await db
        .insertInto('staff')
        .values({ organization_id: org.id, name: s.name, pin_hash: s.pin ? await hashSecret(s.pin) : null, created_at: startTs })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  const suppliers = await db
    .insertInto('suppliers')
    .values([
      { organization_id: org.id, name: 'Frutas y Verduras Huerta Sol', contact_name: 'Rosa', phone: '600 111 222', products: json(['Tomate', 'Lechuga', 'Patata', 'Cebolla']), default_category: 'ambiente' },
      { organization_id: org.id, name: 'Carnes Hermanos López', contact_name: 'Javier', phone: '600 333 444', products: json(['Ternera', 'Pollo', 'Cerdo ibérico']), default_category: 'refrigerado' },
      { organization_id: org.id, name: 'Pescados del Puerto', contact_name: 'Carmen', phone: '600 555 666', products: json(['Merluza', 'Gambas', 'Mejillones']), default_category: 'refrigerado' },
      { organization_id: org.id, name: 'Lácteos La Vaca', products: json(['Leche', 'Nata', 'Queso manchego']), default_category: 'refrigerado' },
    ])
    .returningAll()
    .execute();

  const allNo = Object.fromEntries(ALLERGENS.map((a) => [a, 'no']));
  await db
    .insertInto('dishes')
    .values(
      [
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
      ].map((d) => ({
        organization_id: org.id,
        name: d.name,
        category: d.category,
        description: null,
        allergens: json({ ...allNo, ...d.a }),
        allergens_reviewed: !('pending' in d),
        allergens_reviewed_at: 'pending' in d ? null : startTs,
      })),
    )
    .execute();

  const kioskToken = 'kd_' + randomToken();
  const device = await db
    .insertInto('devices')
    .values({ organization_id: org.id, name: 'Tablet cocina', token_hash: sha256(kioskToken), created_by: user.id, created_at: startTs })
    .returningAll()
    .executeTakeFirstOrThrow();

  const equipment = await db.selectFrom('equipment').selectAll().where('organization_id', '=', org.id).execute();
  const plans = await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).execute();
  const fryer = equipment.find((e) => e.type === 'freidora');
  const today = localDate(new Date(), TZ);
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

  // Fase 2: registros personalizados sugeridos (cloro diario, verificación de termómetros, buenas prácticas).
  const templates = [] as { id: string; key: string; name: string; kind: string; items: { id: string; label: string }[]; unit: string | null; min: number | null; max: number | null }[];
  for (const key of ['agua_cloro', 'termometros', 'buenas_practicas']) {
    const t = SUGGESTED_TEMPLATES.find((x) => x.key === key)!;
    const items = (t.items ?? []).map((label) => ({ id: crypto.randomUUID(), label }));
    const row = await db
      .insertInto('custom_record_templates')
      .values({
        organization_id: org.id,
        name: t.name,
        kind: t.kind,
        items: json(items),
        unit: t.unit ?? null,
        min_value: t.min ?? null,
        max_value: t.max ?? null,
        frequency: t.frequency,
        times_per_day: t.timesPerDay ?? 1,
        weekday: t.weekday ?? null,
        month_day: t.monthDay ?? null,
        instructions: t.instructions,
        reminder_months: t.reminderMonths ?? null,
        suggestion_key: t.key,
        source: t.source,
        created_at: startTs,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    templates.push({ id: row.id, key, name: t.name, kind: t.kind, items, unit: t.unit ?? null, min: t.min ?? null, max: t.max ?? null });
  }

  /** Instante (JS) de una hora local de Madrid. */
  const jsAt = (date: string, hour: number, minute: number): Date => {
    const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
    const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
    const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
  };
  const at = (date: string, hour: number, minute: number) =>
    sql<Date>`((${date}::date + make_time(${hour}, ${minute}, 0)) AT TIME ZONE ${TZ})`;
  const rows: NewRecord[] = [];
  const signer = () => pick(staff);
  const push = (date: string, hour: number, type: string, data: Record<string, unknown>, extra: Partial<NewRecord> = {}) => {
    if (date === today && hour >= nowHour) return; // nada en el futuro
    const s = extra.user_id ? null : signer();
    rows.push({
      organization_id: org.id,
      type,
      data: json(data),
      staff_id: s?.id ?? null,
      staff_name: s?.name ?? null,
      device_id: s ? (rand() < 0.7 ? device.id : null) : null,
      user_id: null,
      user_name: null,
      alert: false,
      created_at: at(date, hour, Math.floor(rand() * 50)),
      ...extra,
    });
  };

  let mondays = 0;
  for (let i = 0; i <= 30; i++) {
    const date = addDays(start, i);
    // Temperaturas
    for (const e of equipment) {
      const hours = [9, 17, 13, 20, 11, 15].slice(0, e.checks_per_day);
      for (const h of hours) {
        if (rand() < 0.06) continue; // algún control olvidado
        let value: number;
        if (e.max_temp != null && e.min_temp == null) value = round1(e.max_temp - 0.5 - rand() * 3);
        else if (e.min_temp != null && e.max_temp == null) value = round1(e.min_temp + 2 + rand() * 10);
        else value = round1(((e.min_temp ?? 0) + (e.max_temp ?? 4)) / 2);
        let outOfRange = false;
        let correctiveAction: string | null = null;
        if (rand() < 0.04) {
          value = e.max_temp != null ? round1(e.max_temp + 1.5 + rand() * 3) : round1((e.min_temp ?? 63) - 4);
          outOfRange = true;
          correctiveAction = pick(correctiveActionsFor(e.type));
        }
        push(date, h, 'temperatura', { equipmentId: e.id, equipmentName: e.name, value, minTemp: e.min_temp, maxTemp: e.max_temp, outOfRange, correctiveAction }, {
          equipment_id: e.id,
          alert: outOfRange,
        });
      }
    }
    // Limpieza
    for (const p of plans) {
      if (!isDue(p, date) || rand() < 0.08) continue;
      const items = p.items.map((it) => ({ itemId: it.id, area: it.area, done: rand() > 0.05 }));
      push(date, 22, 'limpieza', { cleaningPlanId: p.id, planName: p.name, items, completed: items.every((x) => x.done), observations: null }, { cleaning_plan_id: p.id });
    }
    // Recepción de mercancía
    const deliveries = isoWeekday(date) === 7 ? 0 : 1 + Math.floor(rand() * 2);
    for (let d = 0; d < deliveries; d++) {
      const s = pick(suppliers);
      const product = pick(s.products);
      const accepted = rand() > 0.05;
      const chilled = s.default_category === 'refrigerado';
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
          category: s.default_category,
          categoryAssumed: false,
          maxTemperature: chilled ? 4 : null,
          minTemperature: null,
          temperatureOutOfRange: false,
          expired: false,
          correctiveAction: null,
          expiryDate: addDays(date, 3 + Math.floor(rand() * 10)),
          accepted,
          rejectionReason: accepted ? null : 'Envase dañado / temperatura de llegada superior a la acordada',
        },
        { alert: !accepted },
      );
    }
    // Aceite
    if (fryer) {
      const change = i % 5 === 4;
      const polar = round1(change ? 22 + rand() * 4 : 8 + (i % 5) * 3.5 + rand() * 2);
      const overLimit = polar > 25;
      push(
        date,
        12,
        'aceite',
        { equipmentId: fryer.id, fryerName: fryer.name, action: change ? 'cambiado' : 'revisado', polarCompounds: polar, overLimit, correctiveAction: overLimit ? 'Aceite sustituido' : null },
        { equipment_id: fryer.id, alert: overLimit },
      );
    }
    // Fase 2 — cocinado y regeneración (1–2 al día), con algún caso por debajo de la referencia.
    const cookProducts = ['Pollo asado', 'Albóndigas en salsa', 'Merluza al horno', 'Hamburguesa de ternera', 'Tortilla de patata'];
    const cookTemp = round1(70 + rand() * 12);
    const lowCook = i === 9;
    push(date, 13, 'cocinado', {
      product: pick(cookProducts),
      process: 'cocinado',
      freshEgg: false,
      coreTemp: lowCook ? 61.5 : cookTemp,
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
    // Enfriamiento rápido cada 3 días (inicio y, dos horas después, el cierre enlazado).
    if (i % 3 === 1 || date === today) {
      const startId = crypto.randomUUID();
      const product = pick(['Caldo de ave', 'Fondo oscuro', 'Arroz para ensalada', 'Salsa de tomate']);
      // Un día empieza ya templado (por debajo de 60 °C): se anota el motivo (H-M3).
      const warm = i === 7;
      const startTemp = warm ? 52 : round1(68 + rand() * 12);
      const startHour = date === today ? Math.max(0, nowHour - 1) : 16;
      const beforeLen = rows.length;
      const startedAt = jsAt(date, startHour, 5 + Math.floor(rand() * 20));
      push(date, startHour, 'enfriamiento', { phase: 'inicio', product, startTemp, startReferenceTemp: REFERENCE_DEFAULTS.coolingStartTemp, belowStartReference: warm, startReason: warm ? 'Ya venía templado: sobrante del servicio de mediodía' : null, notes: 'En abatidor' }, { id: startId, created_at: startedAt });
      if (rows.length > beforeLen && date !== today) {
        const startRow = rows[rows.length - 1]!;
        const slow = i === 13;
        const minutes = slow ? 150 : 85 + Math.floor(rand() * 30);
        const endTemp = slow ? 9 : round1(3 + rand() * 5);
        const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
        push(date, startHour, 'enfriamiento', {
          phase: 'fin',
          startRecordId: startId,
          product,
          startTemp,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          endTemp,
          minutes,
          targetTemp: REFERENCE_DEFAULTS.coolingTargetTemp,
          maxMinutes: REFERENCE_DEFAULTS.coolingMaxMinutes,
          overTemp: false,
          overTime: slow,
          discarded: false,
          outOfRange: slow,
          correctiveAction: slow ? 'El abatidor iba sobrecargado: producto regenerado y consumido en el día' : null,
        }, { related_record_id: startId, alert: slow, staff_id: startRow.staff_id, staff_name: startRow.staff_name, device_id: startRow.device_id, created_at: endedAt });
      }
    }
    // Registros personalizados: cloro del agua cada día y buenas prácticas el día 1.
    const chlorine = templates.find((t) => t.key === 'agua_cloro')!;
    if (rand() > 0.1) {
      const low = i === 21;
      const reading = low ? 0.1 : round1(0.3 + rand() * 0.5);
      push(date, 9, 'personalizado', {
        templateId: chlorine.id,
        templateName: chlorine.name,
        kind: 'numeric',
        notes: null,
        reading,
        unit: chlorine.unit,
        min: chlorine.min,
        max: chlorine.max,
        outOfRange: low,
        correctiveAction: low ? 'Recloración del depósito y nueva medición a la hora: 0,4 mg/l' : null,
      }, { custom_template_id: chlorine.id, alert: low });
    }
    if (date.endsWith('-01')) {
      const bp = templates.find((t) => t.key === 'buenas_practicas')!;
      const items = bp.items.map((it, n) => ({ itemId: it.id, label: it.label, ok: n !== 4 }));
      push(date, 11, 'personalizado', {
        templateId: bp.id,
        templateName: bp.name,
        kind: 'checklist',
        notes: null,
        items,
        failed: 1,
        correctiveAction: 'Retiradas las cajas de cartón de la zona de elaboración y recordado al equipo',
      }, { custom_template_id: bp.id, alert: true });
    }
    if (i === 10) {
      const th = templates.find((t) => t.key === 'termometros')!;
      push(date, 12, 'personalizado', {
        templateId: th.id,
        templateName: th.name,
        kind: 'checklist',
        notes: 'Comparado con el termómetro de referencia en agua con hielo',
        items: th.items.map((it) => ({ itemId: it.id, label: it.label, ok: true })),
        failed: 0,
        correctiveAction: null,
      }, { custom_template_id: th.id });
    }
    // Plagas (semanal, lunes)
    if (isoWeekday(date) === 1) {
      mondays += 1;
      const signs = mondays === 3;
      push(
        date,
        8,
        'plagas',
        { result: signs ? 'con_indicios' : 'sin_indicios', description: signs ? 'Restos de roedor junto al almacén de secos' : null, action: signs ? 'Aviso a la empresa de control de plagas y refuerzo de limpieza' : null },
        { alert: signs },
      );
    }
  }
  // Incidencias y formación
  const incDate = addDays(today, -12);
  push(incDate, 16, 'incidencia', { description: 'Avería del lavavajillas durante el servicio', correctiveAction: 'Lavado manual con desinfección hasta la reparación', closed: false }, { alert: true });
  push(addDays(today, -2), 19, 'incidencia', { description: 'Corte de luz de 40 minutos', correctiveAction: 'Comprobadas temperaturas de cámaras tras el corte', closed: false }, { alert: true });
  push(addDays(today, -20), 11, 'formacion', { traineeStaffId: staff[1]!.id, traineeName: staff[1]!.name, course: 'Manipulador de alimentos (nivel básico)', trainingDate: addDays(today, -20), trainer: 'Academia Hostelería Segura', hours: 10 });
  push(addDays(today, -6), 11, 'formacion', { traineeStaffId: staff[2]!.id, traineeName: staff[2]!.name, course: 'Gestión de alérgenos en cocina', trainingDate: addDays(today, -6), trainer: 'Formación interna', hours: 3 });

  // Inserción por lotes
  for (let i = 0; i < rows.length; i += 500) {
    await db.insertInto('records').values(rows.slice(i, i + 500)).execute();
  }

  // Enmiendas: cierre de la primera incidencia y corrección de una temperatura mal tecleada
  const inc = await db
    .selectFrom('records')
    .selectAll()
    .where('organization_id', '=', org.id)
    .where('type', '=', 'incidencia')
    .orderBy('created_at')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('records')
    .values({
      organization_id: org.id,
      type: 'incidencia',
      data: json({ ...inc.data, correctiveAction: 'Técnico repara el lavavajillas; verificada temperatura de aclarado', closed: true }),
      user_id: user.id,
      user_name: user.name,
      amends_record_id: inc.id,
      amendment_reason: 'Incidencia resuelta',
      alert: false,
      created_at: at(addDays(incDate, 1), 10, 5),
    })
    .execute();
  const bad = await db
    .selectFrom('records')
    .selectAll()
    .where('organization_id', '=', org.id)
    .where('type', '=', 'temperatura')
    .where('alert', '=', true)
    .orderBy('created_at')
    .executeTakeFirst();
  if (bad) {
    const fixedValue = bad.data.maxTemp != null ? round1(Number(bad.data.maxTemp) - 1) : round1(Number(bad.data.minTemp ?? 63) + 5);
    await db
      .insertInto('records')
      .values({
        organization_id: org.id,
        type: 'temperatura',
        data: json({ ...bad.data, value: fixedValue, outOfRange: false, correctiveAction: null }),
        user_id: user.id,
        user_name: user.name,
        equipment_id: bad.equipment_id,
        amends_record_id: bad.id,
        amendment_reason: `Error al anotar: el termómetro marcaba ${String(fixedValue).replace('.', ',')} °C`,
        alert: false,
        created_at: sql<Date>`${bad.created_at.toISOString()}::timestamptz + interval '20 minutes'`,
      })
      .execute();
  }

  // Fase 2: verificación del responsable de las semanas anteriores (la última semana queda sin revisar,
  // para que «Hoy» muestre el aviso).
  const thisMonday = addDays(today, 1 - isoWeekday(today));
  const orgRow = await db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();
  for (let w = 2; w <= 4; w++) {
    const from = addDays(thisMonday, -7 * w);
    const to = addDays(from, 6);
    if (from < start) continue;
    // Foto del periodo en el momento de verificar (H-M1).
    const snapshot = await periodSnapshot(db, orgRow, from, to, jsAt(addDays(to, 1), 10, 15));
    await db
      .insertInto('responsible_verifications')
      .values({
        organization_id: org.id,
        period_from: from,
        period_to: to,
        period_kind: 'week',
        comment: w === 3 ? 'Revisadas las alertas de la cámara de carnes con el equipo' : null,
        user_id: user.id,
        user_name: user.name,
        user_role: 'owner',
        snapshot: json(snapshot),
        created_at: at(addDays(to, 1), 10, 15),
      })
      .execute();
  }

  const total = await db.selectFrom('records').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', org.id).executeTakeFirstOrThrow();
  const slug = (await db.selectFrom('organizations').select('public_menu_slug').where('id', '=', org.id).executeTakeFirstOrThrow()).public_menu_slug;
  console.log('\n✔ Datos demo creados');
  console.log(`  Usuario:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña:   ${DEMO_PASSWORD}`);
  console.log(`  Local:        Restaurante La Demo (${org.id})`);
  console.log(`  Registros:    ${total.n} (30 días)`);
  console.log('  Personal:     Ana Martín (PIN 1234), Luis Pérez (sin PIN), Marta Gil (PIN 5678)');
  console.log(`  Kiosko:       Authorization: Bearer ${kioskToken}`);
  console.log(`  Carta pública: GET /api/public/menu/${slug}\n`);
} finally {
  await db.destroy();
}
