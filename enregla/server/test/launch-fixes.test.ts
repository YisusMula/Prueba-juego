/**
 * Ronda de correcciones previa al lanzamiento: validación en español, contraseñas, limpieza
 * parcial, recepción (caducidad y temperatura máxima), formación, revisión de alérgenos,
 * verificación de PIN en el kiosko, email de soporte, etiquetas de auditoría y textos del PDF.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import * as S from '../src/schemas/index.js';
import { notes } from '../src/modules/reports/format.js';
import {
  ALL_NO,
  Client,
  FIXED_NOW,
  FIXED_TODAY,
  backdateConfig,
  closeTestApp,
  createStaff,
  createTestApp,
  firstEquipment,
  json,
  resetDb,
  setupOwner,
  type TestCtx,
} from './helpers.js';
import { addDays } from '../src/lib/dates.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW, env: { SUPPORT_EMAIL: 'ayuda@example.com' } });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const ENGLISH = /Too (small|big)|Invalid|expected|received|Required/;

describe('validación en español (cliente y servidor comparten el mapa de errores)', () => {
  it('el mapa de errores produce mensajes humanos con el nombre del campo', () => {
    const r = S.createOrgBody.safeParse({ name: '', businessType: 'x' });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toContain('Escribe el nombre');
    expect(msgs).toContain('Elige una opción válida para el tipo de negocio');
    expect(msgs.join(' ')).not.toMatch(ENGLISH);

    const t = S.temperaturaData.safeParse({ equipmentId: '', value: 999 });
    expect(t.error!.issues.map((i) => i.message)).toEqual(['Elige el equipo', 'La temperatura debe estar entre −60 y 300 °C']);
    expect(S.temperaturaData.safeParse({ equipmentId: crypto.randomUUID(), value: -99 }).error!.issues[0]!.message).toBe(
      'La temperatura debe estar entre −60 y 300 °C',
    );
    expect(S.temperaturaData.safeParse({ equipmentId: crypto.randomUUID() }).error!.issues[0]!.message).toBe('Escribe la temperatura');
    const long = S.createStaffBody.safeParse({ name: 'x'.repeat(101) });
    expect(long.error!.issues[0]!.message).toBe('El nombre es demasiado largo (máximo 100 caracteres)');
    expect(S.emailBody.safeParse({ email: 'no' }).error!.issues[0]!.message).toMatch(/^Escribe un email válido/);
    expect(S.formacionData.safeParse({ traineeStaffId: crypto.randomUUID(), course: 'X', trainingDate: '2026-01-01', hours: -1 }).error!.issues[0]!.message).toBe(
      'Las horas no pueden ser negativas',
    );
    expect(S.fieldName('data.supplierName')).toBe('Nombre del proveedor');
    expect(S.validationSummary([{ path: 'a', message: 'Escribe el nombre' }, { path: 'b', message: 'X' }])).toBe('Escribe el nombre. Hay otro dato por revisar.');
  });

  it('los errores 400 del servidor salen en español, con el campo, y nunca en inglés', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const res = await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 999 } });
    expect(res.statusCode).toBe(400);
    const err = json(res).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('La temperatura debe estar entre −60 y 300 °C.');
    expect(err.details).toEqual([{ path: 'data.value', message: 'La temperatura debe estar entre −60 y 300 °C' }]);

    const bad = await client.post('/api/orgs', { name: '', businessType: 'bar' });
    expect(json(bad).error.message).toBe('Escribe el nombre.');
    const staff = await client.post(`${base}/staff`, { name: 'Ana', pin: '12ab' });
    expect(json(staff).error.details[0].message).toBe('El PIN debe tener entre 4 y 6 cifras (solo números)');
    for (const r of [res, bad, staff]) expect(r.body).not.toMatch(ENGLISH);
  });
});

describe('contraseñas: solo coincidencia exacta y mensaje que explica el motivo', () => {
  it('reglas compartidas', () => {
    expect(S.checkPasswordPolicy('Contrasena-Larga-77x')).toBeNull();
    expect(S.checkPasswordPolicy('CONTRASENA1')).toMatch(/más usadas/);
    expect(S.checkPasswordPolicy('ana.martin.cocina', { email: 'ana.martin.cocina@example.com' })).toMatch(/email ni a tu nombre/);
    expect(S.checkPasswordPolicy('Ana Martín Gil', { name: 'ana martín gil' })).toMatch(/email ni a tu nombre/);
    expect(S.checkPasswordPolicy('anamartingil-2026', { name: 'Ana Martín Gil', email: 'ana@example.com' })).toBeNull();
    expect(S.checkPasswordPolicy('zzzzzzzzzzzz')).toMatch(/repetido/);
    expect(S.passwordRules('corta').find((r) => !r.ok)?.id).toBe('length');
  });

  it('el registro acepta "Contrasena-Larga-77x" y rechaza las comunes explicando por qué', async () => {
    const c = new Client(ctx.app);
    expect((await c.post('/api/auth/register', { email: 'nueva@example.com', password: 'Contrasena-Larga-77x', name: 'Nueva' })).statusCode).toBe(202);
    const common = await c.post('/api/auth/register', { email: 'otra@example.com', password: 'qwertyuiop', name: 'Otra' });
    expect(common.statusCode).toBe(400);
    expect(json(common).error.details[0]).toMatchObject({ path: 'password', message: expect.stringMatching(/más usadas/) });
    const name = await c.post('/api/auth/register', { email: 'pepe@example.com', password: 'Pepe Gotera', name: 'Pepe Gotera' });
    expect(json(name).error.details[0].message).toMatch(/nombre/);
  });
});

describe('limpieza parcial', () => {
  it('exige al menos una zona y una parcial no cuenta como hecha (Hoy y cumplimiento)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await backdateConfig(ctx, org.id);
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('frequency', '=', 'daily').executeTakeFirstOrThrow();
    expect(plan.items.length).toBeGreaterThan(1);

    const none = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: plan.items.map((i) => ({ itemId: i.id, done: false })) } });
    expect(none.statusCode).toBe(400);
    expect(json(none).error.details[0]).toEqual({ path: 'data.items', message: 'Marca al menos una zona hecha' });
    const empty = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: [] } });
    expect(empty.statusCode).toBe(400);

    const partial = await client.post(`${base}/records`, {
      type: 'limpieza',
      data: { cleaningPlanId: plan.id, items: [{ itemId: plan.items[0]!.id, done: true }] },
    });
    expect(partial.statusCode).toBe(201);
    expect(json(partial).record.data.completed).toBe(false);

    let today = json(await client.get(`${base}/tasks/today`));
    let task = today.cleaning.find((c: { cleaningPlanId: string }) => c.cleaningPlanId === plan.id);
    expect(task).toMatchObject({ status: 'pending', completedAt: null, partial: { done: 1, total: plan.items.length } });
    const before = today.summary.done;
    let comp = json(await client.get(`${base}/tasks/compliance?from=${FIXED_TODAY}&to=${FIXED_TODAY}`));
    const doneBefore = comp.overall.done;

    const full = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: plan.items.map((i) => ({ itemId: i.id, done: true })) } });
    expect(full.statusCode).toBe(201);
    today = json(await client.get(`${base}/tasks/today`));
    task = today.cleaning.find((c: { cleaningPlanId: string }) => c.cleaningPlanId === plan.id);
    expect(task).toMatchObject({ status: 'done', partial: null });
    expect(today.summary.done).toBe(before + 1);
    comp = json(await client.get(`${base}/tasks/compliance?from=${FIXED_TODAY}&to=${FIXED_TODAY}`));
    expect(comp.overall.done).toBe(doneBefore + 1);
  });
});

describe('recepción: caducidad pasada y temperatura máxima admisible', () => {
  it('aceptar mercancía caducada o demasiado caliente exige motivo y genera alerta', async () => {
    const { client, base } = await setupOwner(ctx);
    const yesterday = addDays(FIXED_TODAY, -1);
    const baseData = { supplierName: 'Proveedor', product: 'Pollo', accepted: true };
    const expired = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, expiryDate: yesterday } });
    expect(expired.statusCode).toBe(400);
    expect(json(expired).error.details[0]).toMatchObject({ path: 'data.correctiveAction', message: expect.stringMatching(/caducidad ya ha pasado/) });

    const rejected = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, expiryDate: yesterday, accepted: false, rejectionReason: 'Caducado' } });
    expect(rejected.statusCode).toBe(201);
    expect(json(rejected).record).toMatchObject({ alert: true, data: { expired: true, accepted: false } });

    const accepted = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, expiryDate: yesterday, correctiveAction: 'Se usa hoy para personal' } });
    expect(accepted.statusCode).toBe(201);
    expect(json(accepted).record).toMatchObject({ alert: true, data: { expired: true, correctiveAction: 'Se usa hoy para personal' } });

    const hot = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, temperature: 12, maxTemperature: 4 } });
    expect(hot.statusCode).toBe(400);
    expect(json(hot).error.details[0].path).toBe('data.correctiveAction');
    const hotOk = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, temperature: 12, maxTemperature: 4, correctiveAction: 'Devuelto al proveedor' } });
    expect(json(hotOk).record).toMatchObject({ alert: true, data: { temperatureOutOfRange: true, maxTemperature: 4 } });
    const fine = await client.post(`${base}/records`, { type: 'recepcion', data: { ...baseData, temperature: 3, maxTemperature: 4, expiryDate: addDays(FIXED_TODAY, 3) } });
    expect(json(fine).record).toMatchObject({ alert: false, data: { temperatureOutOfRange: false, expired: false } });

    const today = json(await client.get(`${base}/tasks/today`));
    expect(today.alerts.filter((a: { kind: string }) => a.kind === 'recepcion_con_incidencia')).toHaveLength(2);
    expect(today.alerts.find((a: { kind: string }) => a.kind === 'recepcion_rechazada').message).toBe('Mercancía rechazada: Pollo (Proveedor)');
  });

  it('formación: sin fechas futuras ni horas negativas', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const st = await createStaff(ctx, org.id, 'Ana');
    const future = await client.post(`${base}/records`, { type: 'formacion', data: { traineeStaffId: st.id, course: 'Alérgenos', trainingDate: addDays(FIXED_TODAY, 1) } });
    expect(future.statusCode).toBe(400);
    expect(json(future).error.details[0]).toEqual({ path: 'data.trainingDate', message: 'La fecha de la formación no puede ser futura' });
    const neg = await client.post(`${base}/records`, { type: 'formacion', data: { traineeStaffId: st.id, course: 'Alérgenos', trainingDate: FIXED_TODAY, hours: -2 } });
    expect(json(neg).error.details[0]).toEqual({ path: 'data.hours', message: 'Las horas no pueden ser negativas' });
    expect((await client.post(`${base}/records`, { type: 'formacion', data: { traineeStaffId: st.id, course: 'Alérgenos', trainingDate: FIXED_TODAY, hours: 2 } })).statusCode).toBe(201);
  });
});

describe('alérgenos: revisión explícita antes de publicar', () => {
  it('un plato nuevo nace sin revisar y no sale en la carta hasta revisarlo; categorías en orden de carta', async () => {
    const { client, base } = await setupOwner(ctx);
    await client.patch(`${base}/public-menu`, { enabled: true });
    const slug = json(await client.get(`${base}/public-menu`)).publicMenu.slug;
    const menu = async () => json(await ctx.app.inject({ method: 'GET', url: `/api/public/menu/${slug}` }));

    const created = json(await client.post(`${base}/dishes`, { name: 'Pulpo', category: 'Principales', allergens: ALL_NO }));
    expect(created.dish).toMatchObject({ allergensReviewed: false, allergensReviewedAt: null });
    expect((await menu()).dishes).toEqual([]);

    const reviewed = json(await client.patch(`${base}/dishes/${created.dish.id}`, { allergensReviewed: true }));
    expect(reviewed.dish.allergensReviewed).toBe(true);
    expect(reviewed.dish.allergensReviewedAt).toEqual(expect.any(String));
    expect((await menu()).dishes.map((d: { name: string }) => d.name)).toEqual(['Pulpo']);

    for (const [name, category] of [
      ['Agua', 'Bebidas'],
      ['Flan', 'Postres'],
      ['Croquetas', 'Entrantes'],
      ['Especial', 'Sugerencias'],
      ['Pan', null],
    ] as const) {
      await client.post(`${base}/dishes`, { name, category, allergens: ALL_NO, allergensReviewed: true });
    }
    const body = await menu();
    expect(body.dishes.map((d: { category: string | null }) => d.category)).toEqual(['Entrantes', 'Principales', 'Sugerencias', 'Postres', 'Bebidas', null]);
    expect(body.notice).toMatch(/consulta siempre al personal/);
    expect(body.notice).toMatch(/contaminación cruzada/);
    expect(body.dishes[0]).not.toHaveProperty('allergensReviewed');
  });

  it('migración 0004: los platos existentes solo quedan revisados si tienen algún alérgeno marcado', async () => {
    const { org } = await setupOwner(ctx);
    const db = ctx.deps.db;
    await db
      .insertInto('dishes')
      .values([
        { organization_id: org.id, name: 'Con gluten', allergens: JSON.stringify({ ...ALL_NO, gluten: 'contains' }) as never, allergens_reviewed: false },
        { organization_id: org.id, name: 'Con trazas', allergens: JSON.stringify({ ...ALL_NO, nuts: 'traces' }) as never, allergens_reviewed: false },
        { organization_id: org.id, name: 'Todo no', allergens: JSON.stringify(ALL_NO) as never, allergens_reviewed: false },
      ])
      .execute();
    await sql.raw(readFileSync(path.join(MIGRATIONS_DIR, '0004_allergen_review.sql'), 'utf8')).execute(db);
    const rows = await db.selectFrom('dishes').select(['name', 'allergens_reviewed', 'allergens_reviewed_at']).orderBy('name').execute();
    expect(rows.map((r) => [r.name, r.allergens_reviewed, r.allergens_reviewed_at != null])).toEqual([
      ['Con gluten', true, true],
      ['Con trazas', true, true],
      ['Todo no', false, false],
    ]);
  });
});

describe('modo cocina: verificación del PIN al identificarse', () => {
  async function setupKiosk() {
    const owner = await setupOwner(ctx);
    const res = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet' }));
    const headers = { authorization: `Bearer ${res.token}` };
    const k = (url: string, payload: unknown): Promise<LightMyRequestResponse> => ctx.app.inject({ method: 'POST', url, headers, payload: payload as object });
    return { ...owner, k };
  }

  it('acepta el PIN correcto, rechaza el incorrecto y bloquea al quinto fallo; el alta sigue exigiendo el PIN', async () => {
    const { k, org } = await setupKiosk();
    const ana = await createStaff(ctx, org.id, 'Ana', '1234');
    const luis = await createStaff(ctx, org.id, 'Luis');
    expect(json(await k('/api/kiosk/verify-pin', { staffId: luis.id, pin: '' })).staff).toEqual({ id: luis.id, name: 'Luis', hasPin: false });
    const ok = await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).staff).toMatchObject({ id: ana.id, hasPin: true });
    const empty = await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '' });
    expect(json(empty).error.code).toBe('PIN_REQUIRED');
    for (let i = 1; i <= 4; i++) {
      const bad = await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '9999' });
      expect(bad.statusCode).toBe(401);
      expect(json(bad).error.code).toBe('INVALID_PIN');
    }
    const locked = await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '9999' });
    expect(locked.statusCode).toBe(429);
    expect(json(locked).error.code).toBe('PIN_LOCKED');
    expect(locked.headers['retry-after']).toBeDefined();
    // Bloqueado: ni siquiera el correcto entra (y el alta tampoco).
    expect(json(await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' })).error.code).toBe('PIN_LOCKED');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    expect(json(await k('/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } })).error.code).toBe('PIN_LOCKED');
    // Sin PIN el alta sigue pidiéndolo aunque se verificara antes.
    await ctx.deps.db.updateTable('staff').set({ pin_failed_count: 0, pin_locked_until: null }).where('id', '=', ana.id).execute();
    expect(json(await k('/api/kiosk/records', { staffId: ana.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } })).error.code).toBe('PIN_REQUIRED');
    expect((await k('/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } })).statusCode).toBe(201);
  });

  it('ráfaga concurrente de PIN erróneos: nunca se comprueban más de 5', async () => {
    const { k, org } = await setupKiosk();
    const ana = await createStaff(ctx, org.id, 'Ana', '1234');
    const results = await Promise.all(Array.from({ length: 20 }, () => k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '0000' })));
    const codes = results.map((r) => json(r).error.code as string);
    expect(codes.every((c) => c === 'INVALID_PIN' || c === 'PIN_LOCKED' || c === 'RATE_LIMITED')).toBe(true);
    expect(codes.filter((c) => c === 'INVALID_PIN').length).toBeLessThanOrEqual(4);
    const failed = await ctx.deps.db.selectFrom('audit_events').select('id').where('event', '=', 'staff.pin_failed').execute();
    expect(failed.length).toBeLessThanOrEqual(5);
    const st = await ctx.deps.db.selectFrom('staff').select(['pin_locked_until']).where('id', '=', ana.id).executeTakeFirstOrThrow();
    expect(st.pin_locked_until).not.toBeNull();
  });

  it('sin token de dispositivo responde 401', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/kiosk/verify-pin', payload: { staffId: crypto.randomUUID(), pin: '1234' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('textos visibles', () => {
  it('los emails incluyen el email de soporte si está configurado', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/password-reset/request', { email: 'nadie@example.com' });
    const { createUser } = await import('./helpers.js');
    await createUser(ctx, 'alguien@example.com');
    await c.post('/api/auth/password-reset/request', { email: 'alguien@example.com' });
    const mail = ctx.mailer.outbox.find((m) => m.to === 'alguien@example.com')!;
    expect(mail.text).toContain('¿Necesitas ayuda? Escríbenos a ayuda@example.com.');
    expect(mail.html).toContain('mailto:ayuda@example.com');
  });

  it('enlace no válido: un único mensaje claro y bien puntuado', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/verify-email', { token: 'x'.repeat(43) });
    expect(json(res).error.message).toBe('Este enlace no es válido: puede que haya caducado o que ya se haya usado.');
  });

  it('PDF: «Corregido el … por …» sin ids internos y zona horaria legible', () => {
    const base = {
      id: '9b0fc55d-0000-4000-8000-000000000000',
      created_at: new Date('2026-11-09T10:00:00Z'),
      effective_at: new Date('2026-11-09T09:00:00Z'),
      staff_name: 'Ana',
      user_name: null,
      amendment_reason: 'Error al apuntar',
    } as never as Parameters<typeof notes>[0];
    const original = { ...base, amends_record_id: null, amended_by: 'aaaaaaaa-1111-4000-8000-000000000000', amended_at: new Date('2026-11-09T10:00:00Z'), amended_by_name: 'Luis' };
    const amendment = { ...base, amends_record_id: '9b0fc55d-0000-4000-8000-000000000000', amended_by: null };
    expect(notes(original as never, 'Europe/Madrid')).toMatch(/^Corregido el .+ por Luis/);
    expect(notes(original as never, 'Europe/Madrid')).not.toMatch(/aaaaaaaa|9b0fc55d/);
    expect(notes(amendment as never, 'Europe/Madrid')).not.toMatch(/9b0fc55d/);
    expect(notes(amendment as never, 'Europe/Madrid')).toMatch(/Motivo: Error al apuntar/);
    expect(S.timezoneLabel('Europe/Madrid')).toBe('Hora peninsular y de Baleares');
    expect(S.timezoneLabel('Atlantic/Canary')).toBe('Hora de Canarias');
    expect(S.timezoneLabel('America/Mexico_City')).not.toMatch(/\//);
  });

  it('todos los eventos de auditoría que emite el servidor tienen etiqueta legible', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(srcDir);
    const events = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/event:\s*'([a-z_]+\.[a-z_]+)'/g)) events.add(m[1]!);
    expect(events.size).toBeGreaterThan(20);
    const missing = [...events].filter((e) => !S.AUDIT_EVENT_LABELS[e]);
    expect(missing).toEqual([]);
    expect(S.AUDIT_EVENT_LABELS['org.deletion_scheduled']).toBeDefined();
    expect(S.AUDIT_EVENT_LABELS['org.restored']).toBeDefined();
  });
});
