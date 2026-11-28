import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

async function setupKiosk() {
  const owner = await setupOwner(ctx);
  const res = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet cocina' }));
  const headers = { authorization: `Bearer ${res.token}` };
  const k = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { ...owner, token: res.token as string, deviceId: res.device.id as string, k };
}

describe('modo cocina (kiosko)', () => {
  it('lee el contexto mínimo necesario', async () => {
    const { k, org } = await setupKiosk();
    await createStaff(ctx, org.id, 'Ana', '1234');
    await createStaff(ctx, org.id, 'Inactivo').then((s) => ctx.deps.db.updateTable('staff').set({ active: false }).where('id', '=', s.id).execute());
    const res = await k('GET', '/api/kiosk/context');
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.organization).toMatchObject({ id: org.id, name: org.name, timezone: 'Europe/Madrid', readOnly: false });
    expect(body.staff).toEqual([{ id: expect.any(String), name: 'Ana', hasPin: true }]);
    expect(body.equipment.length).toBeGreaterThan(0);
    expect(body.cleaningPlans.length).toBeGreaterThan(0);
    expect(res.body).not.toContain('pin_hash');
    expect(res.body).not.toContain('$argon2');
    expect(res.body).not.toContain('subscription');
    expect(res.body).not.toContain('stripe');
  });

  it('lee las tareas de hoy', async () => {
    const { k } = await setupKiosk();
    const res = await k('GET', '/api/kiosk/tasks/today');
    expect(res.statusCode).toBe(200);
    expect(json(res).temperatures.length).toBeGreaterThan(0);
  });

  it('crea registros identificando al personal (sin PIN y con PIN)', async () => {
    const { k, org, deviceId } = await setupKiosk();
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const noPin = await createStaff(ctx, org.id, 'Pedro');
    const withPin = await createStaff(ctx, org.id, 'Ana', '4321');
    const r1 = await k('POST', '/api/kiosk/records', { staffId: noPin.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    expect(r1.statusCode).toBe(201);
    expect(json(r1).record).toMatchObject({ staff: { id: noPin.id, name: 'Pedro' }, user: null, deviceId });
    const r2 = await k('POST', '/api/kiosk/records', { staffId: withPin.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    expect(r2.statusCode).toBe(401);
    expect(json(r2).error.code).toBe('PIN_REQUIRED');
    const r3 = await k('POST', '/api/kiosk/records', { staffId: withPin.id, pin: '4321', type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    expect(r3.statusCode).toBe(201);
    const r4 = await k('POST', '/api/kiosk/records', { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    expect(r4.statusCode).toBe(400);
    const r5 = await k('POST', '/api/kiosk/records', { staffId: noPin.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 12 } });
    expect(r5.statusCode).toBe(400);
  });

  it('bloquea el PIN tras 5 intentos fallidos', async () => {
    const { k, org, client, base } = await setupKiosk();
    const st = await createStaff(ctx, org.id, 'Ana', '4321');
    const payload = (pin: string) => ({ staffId: st.id, pin, type: 'plagas', data: { result: 'sin_indicios' } });
    for (let i = 0; i < 4; i++) {
      const r = await k('POST', '/api/kiosk/records', payload('0000'));
      expect(r.statusCode).toBe(401);
      expect(json(r).error.code).toBe('INVALID_PIN');
    }
    const fifth = await k('POST', '/api/kiosk/records', payload('0000'));
    expect(fifth.statusCode).toBe(429);
    expect(json(fifth).error.code).toBe('PIN_LOCKED');
    // Ni siquiera el PIN correcto funciona durante el bloqueo
    const locked = await k('POST', '/api/kiosk/records', payload('4321'));
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    const listed = json(await client.get(`${base}/staff`)).items.find((s: { id: string }) => s.id === st.id);
    expect(listed.lockedUntil).not.toBeNull();
    // Un encargado lo desbloquea
    expect((await client.post(`${base}/staff/${st.id}/unlock`)).statusCode).toBe(200);
    expect((await k('POST', '/api/kiosk/records', payload('4321'))).statusCode).toBe(201);
    const audit = await ctx.deps.db.selectFrom('audit_events').select('event').where('event', 'in', ['staff.pin_failed', 'staff.pin_locked']).execute();
    expect(audit.filter((a) => a.event === 'staff.pin_failed')).toHaveLength(5);
    expect(audit.filter((a) => a.event === 'staff.pin_locked')).toHaveLength(1);
  });

  it('mínimo privilegio: el token no sirve fuera de /api/kiosk ni para borrar', async () => {
    const { k, base, token } = await setupKiosk();
    const auth = { authorization: `Bearer ${token}` };
    for (const url of [base, `${base}/records`, `${base}/staff`, `${base}/billing`, `${base}/members`, `${base}/export`, '/api/account', '/api/orgs']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: auth });
      expect(res.statusCode, url).toBe(401);
    }
    for (const [m, url] of [
      ['DELETE', '/api/kiosk/records'],
      ['PATCH', '/api/kiosk/records'],
      ['GET', '/api/kiosk/records'],
      ['GET', '/api/kiosk/staff'],
      ['GET', '/api/kiosk/settings'],
      ['GET', '/api/kiosk/billing'],
    ] as const) {
      expect((await k(m, url)).statusCode, `${m} ${url}`).toBe(404);
    }
  });

  it('rechaza tokens inválidos o revocados', async () => {
    const { k, client, base, deviceId } = await setupKiosk();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: `Bearer kd_${'a'.repeat(43)}` } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: 'Basic abc' } })).statusCode).toBe(401);
    expect((await k('GET', '/api/kiosk/context')).statusCode).toBe(200);
    await client.delete(`${base}/devices/${deviceId}`);
    expect((await k('GET', '/api/kiosk/context')).statusCode).toBe(401);
  });

  it('una cookie de sesión no autentica el kiosko', async () => {
    const { client } = await setupKiosk();
    expect((await client.get('/api/kiosk/context')).statusCode).toBe(401);
  });

  it('no crea registros si la suscripción no está activa', async () => {
    const { k, org } = await setupKiosk();
    const st = await createStaff(ctx, org.id, 'Ana');
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', org.id).execute();
    const res = await k('POST', '/api/kiosk/records', { staffId: st.id, type: 'plagas', data: { result: 'sin_indicios' } });
    expect(res.statusCode).toBe(402);
    expect(json(res).error.code).toBe('READ_ONLY');
    expect(json(await k('GET', '/api/kiosk/context')).organization.readOnly).toBe(true);
  });
});
