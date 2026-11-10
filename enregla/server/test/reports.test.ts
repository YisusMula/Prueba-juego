import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { addMember, closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, type TestCtx, FIXED_NOW, FIXED_TODAY, backdateConfig } from './helpers.js';
import { csvCell } from '../src/modules/reports/format.js';
import { pdfText } from '../src/modules/reports/pdf.js';
import { runReminderTick } from '../src/modules/reminders/scheduler.js';
import { json as toJson } from '../src/db/index.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

// Reloj fijo: los tests no dependen de la hora real (ni fallan al cruzar la medianoche).
const today = () => FIXED_TODAY;

describe('informe PDF', () => {
  it('genera un PDF válido con varias páginas y queda auditado', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const st = await createStaff(ctx, org.id, 'Ana');
    // 300 registros insertados directamente (rápido)
    await sql`
      INSERT INTO records (organization_id, type, data, staff_id, staff_name, equipment_id, alert, created_at)
      SELECT ${org.id}, 'temperatura',
        jsonb_build_object('equipmentId', ${fridge.id}::text, 'equipmentName', 'Cámara', 'value', (g % 9)::float, 'minTemp', null, 'maxTemp', 4, 'outOfRange', g % 9 > 4, 'correctiveAction', CASE WHEN g % 9 > 4 THEN 'Revisado ≤ 4 °C' END),
        ${st.id}, 'Ana', ${fridge.id}, g % 9 > 4, ${FIXED_NOW.toISOString()}::timestamptz - (g || ' minutes')::interval
      FROM generate_series(1, 300) g`.execute(ctx.deps.db);
    const r = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Rotura 😀 de cámara\u0007', closed: false } })).record;
    await client.post(`${base}/records/${r.id}/amendments`, { reason: 'Cerrada', data: { description: 'Rotura de cámara', closed: true } });

    const res = await client.get(`${base}/reports/pdf?from=${today()}&to=${today()}&types=temperatura,incidencia`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="registros-.*\.pdf"/);
    const buf = res.rawPayload;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.subarray(-6).toString()).toContain('%%EOF');
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(3);
    const audit = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'report.generated').execute();
    expect(audit[0]!.metadata).toMatchObject({ format: 'pdf' });
  });

  it('valida rango (máx. 1 año) y tipos', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.get(`${base}/reports/pdf?from=2025-01-01&to=2026-01-02`)).statusCode).toBe(400);
    expect((await client.get(`${base}/reports/pdf?from=2025-01-01&to=2025-12-31`)).statusCode).toBe(200);
    expect((await client.get(`${base}/reports/pdf?from=2025-02-01&to=2025-01-01`)).statusCode).toBe(400);
    expect((await client.get(`${base}/reports/pdf?from=2025-01-01&to=2025-01-31&types=temperatura,nada`)).statusCode).toBe(400);
    expect((await client.get(`${base}/reports/pdf`)).statusCode).toBe(400);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.get(`${base}/reports/pdf?from=2025-01-01&to=2025-01-31`)).statusCode).toBe(200);
  });

  it('saneado de texto para PDF: Unicode completo, sin recortes, marcador para glifos sin soporte', () => {
    expect(pdfText('Temperatura ≤ 4 °C — ok')).toBe('Temperatura ≤ 4 °C — ok');
    expect(pdfText('a\u0000b\nc')).toBe('a b\nc');
    expect(pdfText('emoji 🥑👍🏽 fin 中文')).toBe('emoji □ fin □');
    expect(pdfText('x'.repeat(1000)).length).toBe(1000);
    expect(pdfText('Ñandú € Ștefan Łódź Kőszeg Борщ')).toBe('Ñandú € Ștefan Łódź Kőszeg Борщ');
  });
});

describe('exportación CSV', () => {
  it('genera CSV con BOM, cabeceras y prevención de inyección de fórmulas', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const freezer = await firstEquipment(ctx, org.id, 'congelador');
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -19.5 } });
    await client.post(`${base}/records`, { type: 'incidencia', data: { description: '=HYPERLINK("http://evil","x")', correctiveAction: '+cmd|calc', closed: false } });
    await client.post(`${base}/records`, { type: 'recepcion', data: { supplierName: '@SUM(A1)', product: '-producto; "raro"', accepted: true } });
    const res = await client.get(`${base}/reports/csv?from=${today()}&to=${today()}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('"tipo";"fecha_hora"');
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(body).toContain(`"'+cmd|calc"`);
    expect(body).toContain(`"'@SUM(A1)"`);
    expect(body).toContain(`"'-producto; ""raro"""`);
    expect(body).toContain('"-19,5"');
    expect(body).not.toMatch(/;"=|;"\+|;"@/);
    const typed = await client.get(`${base}/reports/csv?from=${today()}&to=${today()}&types=temperatura`);
    expect(typed.body.slice(1).trim().split('\r\n')).toHaveLength(2);
  });

  it('csvCell', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('-5')).toBe('"-5"');
    expect(csvCell('-5,5')).toBe('"-5,5"');
    expect(csvCell('\t=x')).toBe(`"'\t=x"`);
    expect(csvCell('a\nb')).toBe('"a b"');
  });
});

describe('recordatorio diario', () => {
  async function prepare() {
    const owner = await setupOwner(ctx);
    const { user: mgr } = await addMember(ctx, owner.org.id, 'm@example.com', 'manager');
    const { user: quiet } = await addMember(ctx, owner.org.id, 'q@example.com', 'manager');
    await ctx.deps.db.updateTable('memberships').set({ daily_reminder: false }).where('user_id', '=', quiet.id).execute();
    await ctx.deps.db.updateTable('organizations').set({ reminder_hour: 0 }).where('id', '=', owner.org.id).execute();
    // El día de alta de un equipo/plan no es exigible: se dan por creados hace días.
    await backdateConfig(ctx, owner.org.id);
    ctx.mailer.clear();
    return { ...owner, mgr };
  }

  it('envía a owners/managers con la preferencia activa, una sola vez al día', async () => {
    const { org } = await prepare();
    const r1 = await runReminderTick(ctx.deps);
    expect(r1).toMatchObject({ ran: true, emailsSent: 2 });
    expect(ctx.mailer.outbox.map((m) => m.to).sort()).toEqual(['m@example.com', 'owner@example.com']);
    expect(ctx.mailer.outbox[0]!.subject).toContain('Registros pendientes');
    expect(ctx.mailer.outbox[0]!.text).toContain('Temperatura de');
    const r2 = await runReminderTick(ctx.deps);
    expect(r2.emailsSent).toBe(0);
    const o = await ctx.deps.db.selectFrom('organizations').select('last_reminder_on').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(o.last_reminder_on).toBe(today());
  });

  it('es segura con varias instancias (advisory lock)', async () => {
    await prepare();
    const results = await Promise.all([runReminderTick(ctx.deps), runReminderTick(ctx.deps), runReminderTick(ctx.deps)]);
    expect(results.reduce((a, r) => a + r.emailsSent, 0)).toBe(2);
    expect(ctx.mailer.outbox).toHaveLength(2);
  });

  it('no envía si está desactivado, si no hay pendientes o antes de la hora', async () => {
    const { org } = await prepare();
    await ctx.deps.db.updateTable('organizations').set({ reminder_enabled: false }).where('id', '=', org.id).execute();
    expect((await runReminderTick(ctx.deps)).emailsSent).toBe(0);

    await ctx.deps.db.updateTable('organizations').set({ reminder_enabled: true, reminder_hour: 23 }).where('id', '=', org.id).execute();
    const morning = new Date(`${today()}T07:00:00Z`);
    expect((await runReminderTick(ctx.deps, morning)).organizationsChecked).toBe(0);

    // Sin tareas pendientes: equipos y planes desactivados
    await ctx.deps.db.updateTable('organizations').set({ reminder_hour: 0 }).where('id', '=', org.id).execute();
    await ctx.deps.db.updateTable('equipment').set({ active: false }).where('organization_id', '=', org.id).execute();
    await ctx.deps.db.updateTable('cleaning_plans').set({ active: false }).where('organization_id', '=', org.id).execute();
    const r = await runReminderTick(ctx.deps);
    expect(r.organizationsChecked).toBe(1);
    expect(r.emailsSent).toBe(0);
  });

  it('no envía a locales en solo lectura', async () => {
    const { org } = await prepare();
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date(FIXED_NOW.getTime() - 1000) }).where('id', '=', org.id).execute();
    expect((await runReminderTick(ctx.deps)).emailsSent).toBe(0);
  });

  it('json helper', () => {
    expect(toJson({ a: 1 })).toBe('{"a":1}');
  });
});
