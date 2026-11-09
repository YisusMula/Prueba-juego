import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, PASSWORD, addMember, closeTestApp, createTestApp, createUser, json, login, resetDb, setupOwner, tokenFromMail, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

describe('alta de organización con plantilla', () => {
  it('crea el local con prueba de 14 días, rol owner y plantilla precargada', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const res = await c.post('/api/orgs', { name: 'Bar Pepe', businessType: 'restaurante' });
    expect(res.statusCode).toBe(201);
    const org = json(res).organization;
    expect(org).toMatchObject({ name: 'Bar Pepe', businessType: 'restaurante', timezone: 'Europe/Madrid', role: 'owner' });
    expect(org.subscription.status).toBe('trialing');
    expect(org.subscription.readOnly).toBe(false);
    const days = (new Date(org.subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(org.publicMenu.enabled).toBe(false);
    expect(org.publicMenu.slug).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const eq = json(await c.get(`/api/orgs/${org.id}/equipment`)).items;
    const hot = eq.find((e: { type: string }) => e.type === 'mesa_caliente');
    const freezer = eq.find((e: { type: string }) => e.type === 'congelador');
    const fridge = eq.find((e: { type: string }) => e.type === 'camara');
    expect(hot).toMatchObject({ minTemp: 63, maxTemp: null });
    expect(freezer).toMatchObject({ minTemp: null, maxTemp: -18 });
    expect(fridge).toMatchObject({ minTemp: null, maxTemp: 4 });
    const plans = json(await c.get(`/api/orgs/${org.id}/cleaning-plans`)).items;
    expect(plans.length).toBeGreaterThanOrEqual(3);
    expect(plans.map((p: { frequency: string }) => p.frequency)).toEqual(expect.arrayContaining(['daily', 'weekly', 'monthly']));
    expect(plans[0].items[0].id).toBeTypeOf('string');
  });

  it.each(['bar', 'restaurante', 'cafeteria', 'obrador', 'catering', 'tienda'])('plantilla de %s', async (businessType) => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const res = await c.post('/api/orgs', { name: 'L', businessType });
    expect(res.statusCode).toBe(201);
    const id = json(res).organization.id;
    expect(json(await c.get(`/api/orgs/${id}/equipment`)).items.length).toBeGreaterThan(0);
  });

  it('valida tipo de negocio y zona horaria', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    expect((await c.post('/api/orgs', { name: 'L', businessType: 'discoteca' })).statusCode).toBe(400);
    expect((await c.post('/api/orgs', { name: 'L', businessType: 'bar', timezone: 'Marte/Olympus' })).statusCode).toBe(400);
    expect((await c.post('/api/orgs', { name: 'L', businessType: 'bar', timezone: 'Atlantic/Canary' })).statusCode).toBe(201);
  });

  it('lista mis organizaciones y aparece en /api/account', async () => {
    const { client, org } = await setupOwner(ctx);
    const list = json(await client.get('/api/orgs')).items;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(org.id);
    const me = json(await client.get('/api/account'));
    expect(me.organizations[0]).toMatchObject({ id: org.id, role: 'owner' });
  });
});

describe('ajustes del local y roles', () => {
  it('el owner edita; el manager no', async () => {
    const { client, org, base } = await setupOwner(ctx);
    const res = await client.patch(base, { name: 'Nuevo nombre', reminderHour: 20, reminderEnabled: false, timezone: 'Atlantic/Canary' });
    expect(res.statusCode).toBe(200);
    expect(json(res).organization).toMatchObject({ name: 'Nuevo nombre', reminderHour: 20, reminderEnabled: false, timezone: 'Atlantic/Canary' });
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.get(base)).statusCode).toBe(200);
    expect((await mgr.patch(base, { name: 'X' })).statusCode).toBe(403);
    expect((await client.patch(base, {})).statusCode).toBe(400);
    expect((await client.patch(base, { reminderHour: 24 })).statusCode).toBe(400);
  });

  it('preferencia de recordatorio por miembro', async () => {
    const { org, base } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect(json(await mgr.get(`${base}/membership`))).toEqual({ role: 'manager', dailyReminder: true });
    expect(json(await mgr.patch(`${base}/membership`, { dailyReminder: false }))).toEqual({ dailyReminder: false });
    expect(json(await mgr.get(`${base}/membership`)).dailyReminder).toBe(false);
  });
});

describe('miembros e invitaciones', () => {
  it('invita a un manager por email y este acepta', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const inv = await client.post(`${base}/invitations`, { email: 'Nuevo@Example.com', role: 'manager' });
    expect(inv.statusCode).toBe(201);
    expect(json(inv).invitation).toMatchObject({ email: 'nuevo@example.com', role: 'manager' });
    const token = tokenFromMail(ctx.mailer, 'nuevo@example.com');
    expect(json(await client.get(`${base}/invitations`)).items).toHaveLength(1);

    const anon = new Client(ctx.app);
    const preview = await anon.post('/api/invitations/preview', { token });
    expect(preview.statusCode).toBe(200);
    expect(json(preview).invitation).toMatchObject({ organizationName: org.name, email: 'nuevo@example.com', role: 'manager' });
    expect((await anon.post('/api/invitations/accept', { token })).statusCode).toBe(401);

    await createUser(ctx, 'intruso@example.com');
    const wrong = await login(ctx, 'intruso@example.com');
    expect((await wrong.post('/api/invitations/accept', { token })).statusCode).toBe(403);

    await createUser(ctx, 'nuevo@example.com');
    const invited = await login(ctx, 'nuevo@example.com');
    const acc = await invited.post('/api/invitations/accept', { token });
    expect(acc.statusCode).toBe(200);
    expect(json(acc)).toEqual({ organizationId: org.id, role: 'manager' });
    expect((await invited.post('/api/invitations/accept', { token })).statusCode).toBe(400);
    expect((await invited.get(base)).statusCode).toBe(200);
    const members = json(await client.get(`${base}/members`)).items;
    expect(members).toHaveLength(2);
    expect(json(await client.get(`${base}/invitations`)).items).toHaveLength(0);
  });

  it('solo el owner invita; no se invita a miembros existentes; se puede revocar', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.post(`${base}/invitations`, { email: 'x@example.com' })).statusCode).toBe(403);
    expect((await mgr.get(`${base}/invitations`)).statusCode).toBe(403);
    expect((await client.post(`${base}/invitations`, { email: 'm@example.com' })).statusCode).toBe(409);
    const inv = json(await client.post(`${base}/invitations`, { email: 'x@example.com' })).invitation;
    const token = tokenFromMail(ctx.mailer, 'x@example.com');
    expect((await client.delete(`${base}/invitations/${inv.id}`)).statusCode).toBe(204);
    expect((await client.delete(`${base}/invitations/${inv.id}`)).statusCode).toBe(404);
    expect((await new Client(ctx.app).post('/api/invitations/preview', { token })).statusCode).toBe(400);
  });

  it('cambio de rol y protección del último propietario', async () => {
    const { client, base, org, user } = await setupOwner(ctx);
    const { user: m, client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.patch(`${base}/members/${user.id}`, { role: 'manager' })).statusCode).toBe(403);
    expect((await client.patch(`${base}/members/${user.id}`, { role: 'manager' })).statusCode).toBe(409);
    expect((await client.delete(`${base}/members/${user.id}`)).statusCode).toBe(409);
    expect((await client.patch(`${base}/members/${m.id}`, { role: 'owner' })).statusCode).toBe(200);
    expect((await client.patch(`${base}/members/${user.id}`, { role: 'manager' })).statusCode).toBe(200);
    const roles = json(await mgr.get(`${base}/members`)).items.map((x: { email: string; role: string }) => `${x.email}:${x.role}`);
    expect(roles.sort()).toEqual(['m@example.com:owner', 'owner@example.com:manager']);
    const audit = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'member.role_changed').execute();
    expect(audit).toHaveLength(2);
  });

  it('un manager puede salir del local; no puede expulsar a otros', async () => {
    const { client, base, org, user } = await setupOwner(ctx);
    const { user: m, client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.delete(`${base}/members/${user.id}`)).statusCode).toBe(403);
    expect((await mgr.delete(`${base}/members/${m.id}`)).statusCode).toBe(204);
    expect((await mgr.get(base)).statusCode).toBe(404);
    expect((await client.delete(`${base}/members/${m.id}`)).statusCode).toBe(404);
  });
});

describe('RGPD: exportación y borrado', () => {
  it('exporta todos los datos en JSON (solo owner) sin secretos', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await client.post(`${base}/staff`, { name: 'Luis', pin: '1234' });
    await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Rotura de cadena de frío', closed: false } });
    await client.post(`${base}/devices`, { name: 'Tablet' });
    const res = await client.get(`${base}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = JSON.parse(res.body);
    expect(data.organization.id).toBe(org.id);
    expect(data.members).toHaveLength(1);
    expect(data.staff[0].name).toBe('Luis');
    expect(data.records).toHaveLength(1);
    expect(data.equipment.length).toBeGreaterThan(0);
    expect(data.devices).toHaveLength(1);
    expect(res.body).not.toContain('pin_hash');
    expect(res.body).not.toContain('token_hash');
    expect(res.body).not.toContain('password_hash');
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.get(`${base}/export`)).statusCode).toBe(403);
    const audit = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'org.exported').execute();
    expect(audit).toHaveLength(1);
  });

  it('eliminar organización exige owner y contraseña; borra registros en cascada', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'X', closed: true } });
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.delete(base, { password: PASSWORD })).statusCode).toBe(403);
    expect((await client.delete(base, { password: 'incorrecta-1' })).statusCode).toBe(401);
    expect((await client.delete(base, {})).statusCode).toBe(400);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect(await ctx.deps.db.selectFrom('records').selectAll().execute()).toHaveLength(0);
    expect(await ctx.deps.db.selectFrom('organizations').selectAll().execute()).toHaveLength(0);
    const audit = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'org.deleted').execute();
    expect(audit).toHaveLength(1);
  });
});

describe('auditoría', () => {
  it('el owner consulta los eventos de seguridad paginados', async () => {
    const { client, base, org } = await setupOwner(ctx);
    for (let i = 0; i < 3; i++) await client.post(`${base}/devices`, { name: `T${i}` });
    const p1 = json(await client.get(`${base}/audit?limit=2`));
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0].event).toBe('device.created');
    expect(p1.nextCursor).toBeTypeOf('string');
    const p2 = json(await client.get(`${base}/audit?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.items.length).toBeGreaterThanOrEqual(1);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.get(`${base}/audit`)).statusCode).toBe(403);
  });
});
