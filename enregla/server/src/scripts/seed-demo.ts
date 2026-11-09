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
import { ALLERGENS } from '../schemas/index.js';
import type { Database, Staff } from '../db/types.js';

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
  await runMigrations(pool, (m) => console.log(m));

  // Limpieza de una ejecución anterior
  const old = await db.selectFrom('users').select('id').where('email', '=', DEMO_EMAIL).executeTakeFirst();
  if (old) {
    const orgs = await db.selectFrom('memberships').select('organization_id').where('user_id', '=', old.id).where('role', '=', 'owner').execute();
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
  await db.updateTable('organizations').set({ subscription_status: 'active', public_menu_enabled: true, created_at: startTs }).where('id', '=', org.id).execute();
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
      { organization_id: org.id, name: 'Frutas y Verduras Huerta Sol', contact_name: 'Rosa', phone: '600 111 222', products: json(['Tomate', 'Lechuga', 'Patata', 'Cebolla']) },
      { organization_id: org.id, name: 'Carnes Hermanos López', contact_name: 'Javier', phone: '600 333 444', products: json(['Ternera', 'Pollo', 'Cerdo ibérico']) },
      { organization_id: org.id, name: 'Pescados del Puerto', contact_name: 'Carmen', phone: '600 555 666', products: json(['Merluza', 'Gambas', 'Mejillones']) },
      { organization_id: org.id, name: 'Lácteos La Vaca', products: json(['Leche', 'Nata', 'Queso manchego']) },
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
      ].map((d) => ({ organization_id: org.id, name: d.name, category: d.category, description: null, allergens: json({ ...allNo, ...d.a }) })),
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
          correctiveAction = pick([
            'Puerta mal cerrada: se cierra y se vuelve a medir a los 30 min',
            'Producto trasladado a otra cámara y aviso al técnico de frío',
            'Se recalienta el producto por encima de 75 °C antes del servicio',
          ]);
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
