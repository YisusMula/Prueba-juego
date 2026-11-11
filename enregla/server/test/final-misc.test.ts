/**
 * Auditoría de seguridad final — resto de hallazgos: B-1, B-2, B-3, B-5, B-6 (restaurar vs purga),
 * I-1, I-4, I-5, I-6 e I-7.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import {
  Client,
  PASSWORD,
  addMember,
  closeTestApp,
  createStaff,
  createTestApp,
  createUser,
  json,
  login,
  resetDb,
  setupOwner,
  testConfig,
  tokenFromMail,
  type TestCtx,
  FIXED_NOW,
  FIXED_TODAY,
  backdateConfig,
} from './helpers.js';
import { enqueueEmail, processOutbox, MAX_ATTEMPTS } from '../src/lib/outbox.js';
import type { Mailer, MailMessage } from '../src/lib/mailer.js';
import { TrySemaphore } from '../src/lib/semaphore.js';
import { runRetention } from '../src/modules/reminders/scheduler.js';
import { renderPdfInWorker } from '../src/modules/reports/pdf-render.js';
import { computeCompliance } from '../src/modules/tasks/service.js';
import { addDays } from '../src/lib/dates.js';
import { json as toJson } from '../src/db/index.js';
import * as S from '../src/schemas/index.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TZ = 'Europe/Madrid';

async function seedTemperatures(c: TestCtx, orgId: string, n: number) {
  const fridge = await c.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', orgId).where('type', '=', 'camara').executeTakeFirstOrThrow();
  const st = await createStaff(c, orgId, 'Ana');
  await sql`
    INSERT INTO records (organization_id, type, data, staff_id, staff_name, equipment_id, alert, created_at)
    SELECT ${orgId}, 'temperatura',
      jsonb_build_object('equipmentId', ${fridge.id}::text, 'equipmentName', 'Cámara', 'value', 3, 'minTemp', null, 'maxTemp', 4, 'outOfRange', false, 'correctiveAction', null),
      ${st.id}, 'Ana', ${fridge.id}, false, ${FIXED_NOW.toISOString()}::timestamptz - (g || ' seconds')::interval
    FROM generate_series(1, ${n}) g`.execute(c.deps.db);
}

describe('B-1 invitaciones de un local pendiente de eliminación', () => {
  it('al pedir el borrado se revocan, y aceptar exige que el local no esté pendiente', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.post(`${base}/invitations`, { email: 'nuevo@example.com', role: 'owner' })).statusCode).toBe(201);
    const token = tokenFromMail(ctx.mailer, 'nuevo@example.com');
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    const inv = await ctx.deps.db.selectFrom('invitations').selectAll().where('organization_id', '=', org.id).executeTakeFirstOrThrow();
    expect(inv.revoked_at).not.toBeNull();
    // Aunque la invitación siguiera vigente (p. ej. datos anteriores al arreglo), no se acepta.
    await ctx.deps.db.updateTable('invitations').set({ revoked_at: null }).where('id', '=', inv.id).execute();
    await createUser(ctx, 'nuevo@example.com');
    const invitee = await login(ctx, 'nuevo@example.com');
    expect((await invitee.post('/api/invitations/preview', { token })).statusCode).toBe(400);
    const res = await invitee.post('/api/invitations/accept', { token });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('INVALID_TOKEN');
    expect(await ctx.deps.db.selectFrom('memberships').selectAll().where('organization_id', '=', org.id).execute()).toHaveLength(1);
  });
});

describe('B-2 reparto justo de la generación de PDF', () => {
  const q = `from=${FIXED_TODAY}&to=${FIXED_TODAY}`;

  it('como mucho 1 PDF a la vez por local (aunque lo pidan usuarios distintos) y por usuario', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    await seedTemperatures(ctx, org.id, 1500);
    const [r1, r2] = await Promise.all([client.get(`${base}/reports/pdf?${q}`), mgr.get(`${base}/reports/pdf?${q}`)]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 429]);
    const busy = [r1, r2].find((r) => r.statusCode === 429)!;
    expect(json(busy).error.message).toMatch(/de este local/);
    expect(Number(busy.headers['retry-after'])).toBeGreaterThan(0);

    // Mismo usuario en dos locales distintos.
    const other = json(await client.post('/api/orgs', { name: 'Otro', businessType: 'bar' })).organization.id as string;
    const [s1, s2] = await Promise.all([client.get(`${base}/reports/pdf?${q}`), client.get(`/api/orgs/${other}/reports/pdf?${q}`)]);
    expect([s1.statusCode, s2.statusCode].sort()).toEqual([200, 429]);
    expect(json([s1, s2].find((r) => r.statusCode === 429)!).error.message).toMatch(/Ya estás generando/);
  });

  it('con los huecos globales ocupados, la petición espera en cola (no 429 inmediato) y se atiende al liberarse', async () => {
    const { client, base } = await setupOwner(ctx);
    const a = ctx.app.pdfSlots.tryAcquire()!;
    const b = ctx.app.pdfSlots.tryAcquire()!;
    const pending = client.get(`${base}/reports/pdf?${q}`);
    await sleep(300);
    expect(ctx.app.pdfSlots.queued).toBe(1);
    a();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    b();
    expect(ctx.app.pdfSlots.inUse).toBe(0);
  });

  it('la espera en cola está acotada: pasado el máximo, 429 con Retry-After', async () => {
    const short = await createTestApp({ now: () => FIXED_NOW, config: { reports: { ...testConfig().reports, pdfQueueMaxWaitMs: 200 } } });
    try {
      await resetDb(short);
      const { client, base } = await setupOwner(short);
      const a = short.app.pdfSlots.tryAcquire()!;
      const b = short.app.pdfSlots.tryAcquire()!;
      const t0 = Date.now();
      const res = await client.get(`${base}/reports/pdf?${q}`);
      expect(res.statusCode).toBe(429);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
      expect(res.headers['retry-after']).toBeDefined();
      a();
      b();
    } finally {
      await closeTestApp(short);
    }
  });

  it('la cola se atiende por orden de llegada (FIFO) y tiene longitud máxima', async () => {
    const sem = new TrySemaphore(1, 2);
    const first = sem.tryAcquire()!;
    const order: string[] = [];
    const w1 = sem.acquire(5_000).then((r) => (order.push('w1'), r));
    const w2 = sem.acquire(5_000).then((r) => (order.push('w2'), r));
    expect(await sem.acquire(5_000)).toBeNull(); // cola llena
    expect(sem.tryAcquire()).toBeNull(); // nadie se cuela por delante de la cola
    first();
    (await w1)!();
    (await w2)!();
    expect(order).toEqual(['w1', 'w2']);
    expect(sem.inUse).toBe(0);
  });

  it('presupuesto de tiempo de generación por local y hora', async () => {
    const tight = await createTestApp({ now: () => FIXED_NOW, config: { reports: { ...testConfig().reports, pdfBudgetMsPerHour: 1 } } });
    try {
      await resetDb(tight);
      const { client, base, org } = await setupOwner(tight);
      expect((await client.get(`${base}/reports/pdf?${q}`)).statusCode).toBe(200);
      const res = await client.get(`${base}/reports/pdf?${q}`);
      expect(res.statusCode).toBe(429);
      expect(json(res).error.message).toMatch(/agotado el tiempo de generación/);
      // Otro local no se ve afectado.
      const other = await setupOwner(tight, 'otro@example.com');
      expect((await other.client.get(`${other.base}/reports/pdf?${q}`)).statusCode).toBe(200);
      const row = await tight.deps.db.selectFrom('rate_limits').selectAll().where('key', '=', `pdf-budget:org:${org.id}`).executeTakeFirstOrThrow();
      expect(row.count).toBeGreaterThan(0);
    } finally {
      await closeTestApp(tight);
    }
  });

  it('el PDF se genera en un worker_thread', async () => {
    const { org } = await setupOwner(ctx);
    const pdf = await renderPdfInWorker({
      appName: 'EnRegla',
      org,
      from: FIXED_TODAY,
      to: FIXED_TODAY,
      types: ['incidencia'],
      records: {},
      maxRows: 10,
      dayNotes: [],
      maxBytes: 64 * 1024 * 1024,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('B-3 la bandeja de emails no conserva tokens en claro', () => {
  it('al enviarse (o fallar definitivamente) se vacían los cuerpos en el mismo UPDATE', async () => {
    const db = ctx.deps.db;
    const msg: MailMessage = { to: 'a@example.com', subject: 'Enlace', text: 'https://x/#token=SECRETO', html: '<a href="https://x/#token=SECRETO">x</a>' };
    const ok = await enqueueEmail(db, msg);
    await processOutbox(db, ctx.mailer, { ids: [ok] });
    const sent = await db.selectFrom('email_outbox').selectAll().where('id', '=', ok).executeTakeFirstOrThrow();
    expect(sent).toMatchObject({ status: 'sent', text_body: '', html_body: '' });
    expect(ctx.mailer.outbox[0]!.text).toContain('SECRETO');

    const failing: Mailer = { send: () => Promise.reject(new Error('SMTP caído')) };
    const bad = await enqueueEmail(db, msg);
    await db.updateTable('email_outbox').set({ attempts: MAX_ATTEMPTS - 1 }).where('id', '=', bad).execute();
    await processOutbox(db, failing, { ids: [bad] });
    const failed = await db.selectFrom('email_outbox').selectAll().where('id', '=', bad).executeTakeFirstOrThrow();
    expect(failed).toMatchObject({ status: 'failed', text_body: '', html_body: '' });
    // Un fallo con reintentos pendientes conserva el cuerpo (hace falta para reenviarlo).
    const retry = await enqueueEmail(db, msg);
    await processOutbox(db, failing, { ids: [retry] });
    expect((await db.selectFrom('email_outbox').selectAll().where('id', '=', retry).executeTakeFirstOrThrow()).text_body).toContain('SECRETO');
  });
});

describe('B-5 sin envíos duplicados con varias instancias y SMTP lento', () => {
  it('las filas se reclaman de una en una: lo no enviado no queda reservado por un lote', async () => {
    const db = ctx.deps.db;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await enqueueEmail(db, { to: `d${i}@example.com`, subject: `S${i}`, text: 't', html: 'h' }));
    await db.updateTable('email_outbox').set({ next_attempt_at: sql<Date>`now() - interval '1 minute'` }).execute();
    const delivered: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((r) => (unblock = r));
    let first = true;
    // Instancia A: SMTP lentísimo en el primer envío.
    const slow: Mailer = {
      send: async (m) => {
        if (first) {
          first = false;
          await gate;
        }
        delivered.push(m.to);
      },
    };
    const fast: Mailer = { send: async (m) => void delivered.push(m.to) };
    const a = processOutbox(db, slow, { limit: 20 });
    await sleep(200);
    // Mientras A sigue atascada, vence la reserva de cualquier otra fila que A hubiera reclamado
    // en lote (simula que pasan los 120 s del arrendamiento) y la instancia B procesa la bandeja.
    const stuck = await db.selectFrom('email_outbox').select('id').where('status', '=', 'pending').where('attempts', '>', 0).execute();
    expect(stuck).toHaveLength(1);
    await db
      .updateTable('email_outbox')
      .set({ next_attempt_at: sql<Date>`now() - interval '1 second'` })
      .where('id', '!=', stuck[0]!.id)
      .execute();
    const rb = await processOutbox(db, fast, { limit: 20 });
    expect(rb.sent).toBe(2);
    unblock();
    await a;
    expect(delivered.sort()).toEqual(['d0@example.com', 'd1@example.com', 'd2@example.com']);
  });
});

describe('B-6 restaurar a la vez que la purga', () => {
  it('si la purga borra el local mientras se restaura, 404 (nunca 500)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    const conn = await ctx.deps.pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('DELETE FROM organizations WHERE id = $1', [org.id]);
      const restore = client.post(`${base}/restore`);
      await sleep(300);
      await conn.query('COMMIT');
      const res = await restore;
      expect(res.statusCode).toBe(404);
    } finally {
      conn.release();
    }
  });
});

describe('I-1 cumplimiento mejorado por correcciones tardías', () => {
  async function scenario() {
    const { client, base, org } = await setupOwner(ctx);
    const db = ctx.deps.db;
    await db.updateTable('equipment').set({ active: false }).where('organization_id', '=', org.id).execute();
    await db.updateTable('cleaning_plans').set({ active: false }).where('organization_id', '=', org.id).execute();
    const itemId = crypto.randomUUID();
    // Plan semanal de los martes (FIXED_TODAY es martes 10/11/2026).
    const plan = await db
      .insertInto('cleaning_plans')
      .values({ organization_id: org.id, name: 'Semanal', frequency: 'weekly', weekday: 2, items: toJson([{ id: itemId, area: 'Cámara', product: null, method: null }]) })
      .returningAll()
      .executeTakeFirstOrThrow();
    await backdateConfig(ctx, org.id);
    const st = await createStaff(ctx, org.id, 'S');
    const at = (d: string, h: string) => sql<Date>`((${d}::date + ${h}::time) AT TIME ZONE ${TZ})`;
    const d = addDays(FIXED_TODAY, -7); // martes anterior
    // Limpieza parcial el martes anterior, corregida a completa dos días después.
    const orig = await db
      .insertInto('records')
      .values({ organization_id: org.id, type: 'limpieza', cleaning_plan_id: plan.id, data: toJson({ completed: false, items: [{ itemId, done: false }] }), staff_id: st.id, staff_name: 'S', created_at: at(d, '10:00') })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('records')
      .values({
        organization_id: org.id,
        type: 'limpieza',
        cleaning_plan_id: plan.id,
        data: toJson({ completed: true, items: [{ itemId, done: true }] }),
        staff_id: st.id,
        staff_name: 'S',
        amends_record_id: orig.id,
        amendment_reason: 'Se olvidó marcar',
        created_at: at(addDays(d, 2), '09:00'),
      })
      .execute();
    // Hoy: parcial el lunes, corregida hoy martes (antes de FIXED_NOW).
    const mon = addDays(FIXED_TODAY, -1);
    const orig2 = await db
      .insertInto('records')
      .values({ organization_id: org.id, type: 'limpieza', cleaning_plan_id: plan.id, data: toJson({ completed: false, items: [{ itemId, done: false }] }), staff_id: st.id, staff_name: 'S', created_at: at(mon, '10:00') })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('records')
      .values({
        organization_id: org.id,
        type: 'limpieza',
        cleaning_plan_id: plan.id,
        data: toJson({ completed: true, items: [{ itemId, done: true }] }),
        staff_id: st.id,
        staff_name: 'S',
        amends_record_id: orig2.id,
        amendment_reason: 'Corrección',
        created_at: at(FIXED_TODAY, '09:00'),
      })
      .execute();
    return { client, base, org, d };
  }

  it('el resumen de cumplimiento y Hoy cuentan las tareas cumplidas con una corrección de un día posterior (sin cambiar el cálculo)', async () => {
    const { client, base, org, d } = await scenario();
    const res = json(await client.get(`${base}/tasks/compliance?from=${d}&to=${FIXED_TODAY}`));
    const byDate = Object.fromEntries(res.days.map((x: { date: string }) => [x.date, x]));
    expect(byDate[d]).toMatchObject({ expected: 1, done: 1, percent: 100, correctedLater: 1 });
    expect(byDate[FIXED_TODAY]).toMatchObject({ expected: 1, done: 1, correctedLater: 1 });
    expect(res.overall).toMatchObject({ expected: 2, done: 2, correctedLater: 2 });
    const today = json(await client.get(`${base}/tasks/today`));
    expect(today.summary).toMatchObject({ total: 1, done: 1, correctedLater: 1 });
    expect(today.cleaning[0]).toMatchObject({ status: 'done', correctedLater: true });
    const fresh = await ctx.deps.db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();
    expect((await computeCompliance(ctx.deps.db, fresh, d, d, FIXED_NOW)).days[0]!.correctedLater).toBe(1);
  });

  it('el PDF incluye una nota por día', async () => {
    const { client, base, d } = await scenario();
    const res = await client.get(`${base}/reports/pdf?from=${d}&to=${FIXED_TODAY}&types=limpieza`);
    expect(res.statusCode).toBe(200);
    let hasPdftotext = true;
    try {
      execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    } catch {
      hasPdftotext = false;
    }
    if (!hasPdftotext) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'enregla-pdf-'));
    try {
      writeFileSync(path.join(dir, 'r.pdf'), res.rawPayload);
      const text = execFileSync('pdftotext', ['-raw', path.join(dir, 'r.pdf'), '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
      expect(text).toContain('Cumplimiento completado con correcciones posteriores');
      expect(text).toContain('3 de noviembre de 2026: 1 tarea(s) cumplida(s) mediante una corrección hecha en un día posterior');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('I-4 X-Robots-Tag por lista blanca', () => {
  it('solo la portada y las páginas legales exactas son indexables', async () => {
    const get = (url: string) => ctx.app.inject({ method: 'GET', url });
    for (const url of ['/Locales/x', '//locales/x', '/locales%2Fx', '/LOCALES/x/hoy', '/app', '/carta/abc', '/api/nada', '/algo-nuevo', '/privacidad/', '/Privacidad']) {
      expect((await get(url)).headers['x-robots-tag'], url).toBe('noindex, nofollow');
    }
    for (const url of ['/', '/?utm_source=x', '/aviso-legal', '/privacidad', '/terminos', '/cookies']) {
      expect((await get(url)).headers['x-robots-tag'], url).toBeUndefined();
    }
  });
});

describe('I-5 contraseñas basadas en datos personales', () => {
  it('rechaza contener la parte local del email o el nombre (≥ 5) o ser casi igual a ellos', () => {
    expect(S.checkPasswordPolicy('juanperez1', { email: 'juanperez@example.com' })).toMatch(/nombre/);
    expect(S.checkPasswordPolicy('Juan.Pérez-2026x', { name: 'Juan Pérez', email: 'jp@example.com' })).toMatch(/nombre/);
    expect(S.checkPasswordPolicy('mi-cocina-marisol-77', { name: 'Marisol', email: 'x@example.com' })).toMatch(/nombre/);
    expect(S.checkPasswordPolicy('ana2026xyz', { email: 'ana@example.com' })).toMatch(/nombre/);
    expect(S.checkPasswordPolicy('Contrasena-Larga-77x', { email: 'juanperez@example.com', name: 'Juan Pérez' })).toBeNull();
    expect(S.checkPasswordPolicy('Contrasena-Larga-77x')).toBeNull();
    expect(S.checkPasswordPolicy('banana-split-2026', { email: 'ana@example.com' })).toBeNull();
  });

  it('el registro lo aplica con un mensaje claro', async () => {
    const c = new Client(ctx.app);
    const bad = await c.post('/api/auth/register', { email: 'juanperez@example.com', password: 'juanperez1', name: 'Juan' });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.message).toMatch(/ni contenerlos/);
    expect((await c.post('/api/auth/register', { email: 'juanperez@example.com', password: 'Contrasena-Larga-77x', name: 'Juan' })).statusCode).toBe(202);
  });
});

describe('I-6 local pendiente cuyo único owner borra su cuenta', () => {
  it('sin ningún miembro: la purga lo elimina en su siguiente pasada', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect((await client.delete('/api/account', { password: PASSWORD })).statusCode).toBe(204);
    const r = await runRetention(ctx.deps, { force: true });
    expect(r.organizations).toBe(1);
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst()).toBeUndefined();
  });

  it('con encargados: se conserva (pueden exportar) hasta su fecha y entonces se purga', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect((await client.delete('/api/account', { password: PASSWORD })).statusCode).toBe(204);
    expect((await runRetention(ctx.deps, { force: true })).organizations).toBe(0);
    expect((await mgr.get(`${base}/records`)).statusCode).toBe(200);
    await ctx.deps.db.updateTable('organizations').set({ deletion_scheduled_at: new Date(Date.now() - 1000) }).where('id', '=', org.id).execute();
    expect((await runRetention(ctx.deps, { force: true })).organizations).toBe(1);
  });
});

describe('I-7 confirmar un cambio de email', () => {
  it('invalida los restablecimientos ya emitidos y cierra las demás sesiones', async () => {
    await createUser(ctx, 'u@example.com');
    const other = await login(ctx, 'u@example.com');
    const me = await login(ctx, 'u@example.com');
    await new Client(ctx.app).post('/api/auth/password-reset/request', { email: 'u@example.com' });
    const resetToken = tokenFromMail(ctx.mailer, 'u@example.com');
    expect((await me.post('/api/account/email', { password: PASSWORD, newEmail: 'nuevo@example.com' })).statusCode).toBe(202);
    const token = tokenFromMail(ctx.mailer, 'nuevo@example.com');
    // Confirma desde su propia sesión: esa se conserva; la otra se cierra.
    expect((await me.post('/api/auth/email-change/confirm', { token })).statusCode).toBe(200);
    expect((await me.get('/api/account')).statusCode).toBe(200);
    expect((await other.get('/api/account')).statusCode).toBe(401);
    const reset = await new Client(ctx.app).post('/api/auth/password-reset/confirm', { token: resetToken, password: 'Otra-Clave-Segura-9' });
    expect(reset.statusCode).toBe(400);
    expect(json(reset).error.code).toBe('INVALID_TOKEN');
  });
});
