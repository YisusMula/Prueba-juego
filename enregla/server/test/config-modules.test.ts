import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_NO, addMember, closeTestApp, createTestApp, json, resetDb, setupOwner, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

describe('personal', () => {
  it('alta, edición, PIN hasheado y nunca expuesto', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/staff`, { name: 'Lucía', pin: '1234' });
    expect(res.statusCode).toBe(201);
    const st = json(res).staff;
    expect(st).toMatchObject({ name: 'Lucía', hasPin: true, active: true, lockedUntil: null });
    expect(res.body).not.toContain('1234');
    const row = await ctx.deps.db.selectFrom('staff').selectAll().where('id', '=', st.id).executeTakeFirstOrThrow();
    expect(row.pin_hash!.startsWith('$argon2id$')).toBe(true);

    const upd = await client.patch(`${base}/staff/${st.id}`, { pin: null, active: false, name: 'Lucía G.' });
    expect(json(upd).staff).toMatchObject({ name: 'Lucía G.', hasPin: false, active: false });
    expect(json(await client.get(`${base}/staff?active=true`)).items).toHaveLength(0);
    expect(json(await client.get(`${base}/staff?active=false`)).items).toHaveLength(1);
    expect((await client.post(`${base}/staff/${st.id}/unlock`)).statusCode).toBe(200);
  });

  it('valida el PIN (4–6 dígitos)', async () => {
    const { client, base } = await setupOwner(ctx);
    for (const pin of ['123', '1234567', 'abcd', '12 34']) {
      expect((await client.post(`${base}/staff`, { name: 'X', pin })).statusCode).toBe(400);
    }
    expect((await client.post(`${base}/staff`, { name: 'X', pin: '123456' })).statusCode).toBe(201);
    expect((await client.post(`${base}/staff`, { name: 'Sin PIN' })).statusCode).toBe(201);
  });

  it('paginación por cursor', async () => {
    const { client, base } = await setupOwner(ctx);
    for (let i = 0; i < 5; i++) await client.post(`${base}/staff`, { name: `P${i}` });
    const p1 = json(await client.get(`${base}/staff?limit=2`));
    expect(p1.items.map((s: { name: string }) => s.name)).toEqual(['P0', 'P1']);
    const p2 = json(await client.get(`${base}/staff?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.items.map((s: { name: string }) => s.name)).toEqual(['P2', 'P3']);
    const p3 = json(await client.get(`${base}/staff?limit=2&cursor=${p2.nextCursor}`));
    expect(p3.items.map((s: { name: string }) => s.name)).toEqual(['P4']);
    expect(p3.nextCursor).toBeNull();
    expect((await client.get(`${base}/staff?limit=500`)).statusCode).toBe(400);
    expect((await client.get(`${base}/staff?limit=0`)).statusCode).toBe(400);
    expect((await client.get(`${base}/staff?cursor=no-uuid`)).statusCode).toBe(400);
  });

  it('un 404 para ids inexistentes o malformados', async () => {
    const { client, base } = await setupOwner(ctx);
    expect((await client.patch(`${base}/staff/00000000-0000-4000-8000-000000000000`, { name: 'X' })).statusCode).toBe(404);
    expect((await client.patch(`${base}/staff/abc`, { name: 'X' })).statusCode).toBe(404);
  });
});

describe('equipos', () => {
  it('CRUD con límites solo máximo, solo mínimo o ambos', async () => {
    const { client, base } = await setupOwner(ctx);
    const a = await client.post(`${base}/equipment`, { name: 'Cámara 2', type: 'camara', maxTemp: 4, checksPerDay: 2 });
    expect(a.statusCode).toBe(201);
    expect(json(a).equipment).toMatchObject({ minTemp: null, maxTemp: 4, checksPerDay: 2, active: true });
    const b = await client.post(`${base}/equipment`, { name: 'Baño maría', type: 'mesa_caliente', minTemp: 63 });
    expect(json(b).equipment).toMatchObject({ minTemp: 63, maxTemp: null, checksPerDay: 1 });
    const c = await client.post(`${base}/equipment`, { name: 'Vitrina', type: 'vitrina', minTemp: 0, maxTemp: 8 });
    expect(c.statusCode).toBe(201);
    expect((await client.post(`${base}/equipment`, { name: 'Mal', type: 'camara', minTemp: 8, maxTemp: 2 })).statusCode).toBe(400);
    expect((await client.post(`${base}/equipment`, { name: 'Mal', type: 'nevera' })).statusCode).toBe(400);
    const id = json(a).equipment.id;
    expect((await client.patch(`${base}/equipment/${id}`, { minTemp: 10 })).statusCode).toBe(400);
    const upd = await client.patch(`${base}/equipment/${id}`, { maxTemp: 5, active: false });
    expect(json(upd).equipment).toMatchObject({ maxTemp: 5, active: false });
    expect(json(await client.get(`${base}/equipment/${id}`)).equipment.name).toBe('Cámara 2');
    expect(json(await client.get(`${base}/equipment?type=mesa_caliente`)).items.length).toBeGreaterThanOrEqual(2);
  });

  it('el manager también gestiona la configuración operativa', async () => {
    const { org, base } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.post(`${base}/equipment`, { name: 'Congelador 2', type: 'congelador', maxTemp: -18 })).statusCode).toBe(201);
  });
});

describe('planes de limpieza', () => {
  it('crea planes diarios, semanales y mensuales con ítems', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/cleaning-plans`, {
      name: 'Semanal cámaras',
      frequency: 'weekly',
      weekday: 3,
      items: [{ area: 'Cámara 1', product: 'Lejía alimentaria', method: 'Frotar' }, { area: 'Cámara 2' }],
    });
    expect(res.statusCode).toBe(201);
    const plan = json(res).cleaningPlan;
    expect(plan).toMatchObject({ frequency: 'weekly', weekday: 3, monthDay: null });
    expect(plan.items).toHaveLength(2);
    expect(plan.items[1]).toMatchObject({ area: 'Cámara 2', product: null, method: null });
    expect((await client.post(`${base}/cleaning-plans`, { name: 'X', frequency: 'weekly', items: [{ area: 'a' }] })).statusCode).toBe(400);
    expect((await client.post(`${base}/cleaning-plans`, { name: 'X', frequency: 'monthly', items: [{ area: 'a' }] })).statusCode).toBe(400);
    expect((await client.post(`${base}/cleaning-plans`, { name: 'X', frequency: 'daily', items: [] })).statusCode).toBe(400);
    expect((await client.post(`${base}/cleaning-plans`, { name: 'X', frequency: 'monthly', monthDay: 31, items: [{ area: 'a' }] })).statusCode).toBe(400);

    // Edición: conserva ids existentes y crea ids nuevos
    const keep = plan.items[0].id;
    const upd = await client.patch(`${base}/cleaning-plans/${plan.id}`, { items: [{ id: keep, area: 'Cámara 1 (renombrada)' }, { area: 'Nueva zona' }] });
    expect(upd.statusCode).toBe(200);
    const items = json(upd).cleaningPlan.items;
    expect(items[0].id).toBe(keep);
    expect(items[1].id).not.toBe(plan.items[1].id);
    const toMonthly = await client.patch(`${base}/cleaning-plans/${plan.id}`, { frequency: 'monthly', monthDay: 15 });
    expect(json(toMonthly).cleaningPlan).toMatchObject({ frequency: 'monthly', monthDay: 15, weekday: null });
    expect((await client.patch(`${base}/cleaning-plans/${plan.id}`, { frequency: 'weekly' })).statusCode).toBe(400);
    expect(json(await client.get(`${base}/cleaning-plans/${plan.id}`)).cleaningPlan.name).toBe('Semanal cámaras');
  });
});

describe('proveedores', () => {
  it('CRUD y búsqueda', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/suppliers`, { name: 'Frutas García', contactName: 'Pepe', phone: '600000000', email: 'pedidos@garcia.es', products: ['Tomate', 'Lechuga'] });
    expect(res.statusCode).toBe(201);
    const s = json(res).supplier;
    expect(s).toMatchObject({ name: 'Frutas García', products: ['Tomate', 'Lechuga'], notes: null });
    await client.post(`${base}/suppliers`, { name: 'Carnes López' });
    expect(json(await client.get(`${base}/suppliers?q=garc`)).items).toHaveLength(1);
    expect(json(await client.get(`${base}/suppliers?q=%25`)).items).toHaveLength(0);
    expect((await client.post(`${base}/suppliers`, { name: 'X', email: 'no-email' })).statusCode).toBe(400);
    const upd = await client.patch(`${base}/suppliers/${s.id}`, { notes: 'Reparte martes', email: '' });
    expect(json(upd).supplier).toMatchObject({ notes: 'Reparte martes', email: null });
    expect((await client.delete(`${base}/suppliers/${s.id}`)).statusCode).toBe(204);
    expect((await client.get(`${base}/suppliers/${s.id}`)).statusCode).toBe(404);
  });
});

describe('alérgenos y carta pública', () => {
  it('platos con los 14 alérgenos obligatorios', async () => {
    const { client, base } = await setupOwner(ctx);
    const partial = await client.post(`${base}/dishes`, { name: 'Croquetas', allergens: { gluten: 'contains' } });
    expect(partial.statusCode).toBe(400);
    const extra = await client.post(`${base}/dishes`, { name: 'Croquetas', allergens: { ...ALL_NO, chocolate: 'no' } });
    expect(extra.statusCode).toBe(400);
    const res = await client.post(`${base}/dishes`, {
      name: 'Croquetas de jamón',
      category: 'Entrantes',
      allergens: { ...ALL_NO, gluten: 'contains', milk: 'contains', eggs: 'traces' },
    });
    expect(res.statusCode).toBe(201);
    const dish = json(res).dish;
    expect(dish.allergens.gluten).toBe('contains');
    expect(Object.keys(dish.allergens)).toHaveLength(14);
    const upd = await client.patch(`${base}/dishes/${dish.id}`, { visible: false });
    expect(json(upd).dish.visible).toBe(false);
    expect(json(await client.get(`${base}/dishes?category=Entrantes`)).items).toHaveLength(1);
    expect((await client.delete(`${base}/dishes/${dish.id}`)).statusCode).toBe(204);
  });

  it('carta pública: activable, sin datos internos, slug regenerable', async () => {
    const { client, base } = await setupOwner(ctx);
    await client.post(`${base}/dishes`, { name: 'Ensalada', category: 'Entrantes', allergens: { ...ALL_NO, mustard: 'contains' }, allergensReviewed: true });
    await client.post(`${base}/dishes`, { name: 'Oculto', allergens: ALL_NO, visible: false });
    const settings = json(await client.get(`${base}/public-menu`)).publicMenu;
    expect(settings.enabled).toBe(false);
    const url = `/api/public/menu/${settings.slug}`;
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);

    expect(json(await client.patch(`${base}/public-menu`, { enabled: true })).publicMenu.enabled).toBe(true);
    const pub = await ctx.app.inject({ method: 'GET', url });
    expect(pub.statusCode).toBe(200);
    const body = json(pub);
    expect(body.organization).toEqual({ name: 'Local de owner@example.com' });
    expect(body.dishes).toHaveLength(1);
    expect(body.dishes[0]).toEqual({ name: 'Ensalada', category: 'Entrantes', description: null, allergens: expect.objectContaining({ mustard: 'contains' }) });
    expect(body.allergens).toHaveLength(14);
    expect(body.allergens[0]).toEqual({ id: 'gluten', label: 'Cereales que contienen gluten', name: 'Gluten' });
    expect(body.allergens.map((a: { id: string }) => a.id)).toEqual([
      'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
    ]);
    expect(pub.body).not.toMatch(/"id"\s*:\s*"[0-9a-f-]{36}"/);
    expect(pub.headers['x-robots-tag']).toContain('noindex');

    const regen = json(await client.post(`${base}/public-menu/regenerate`)).publicMenu;
    expect(regen.slug).not.toBe(settings.slug);
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/public/menu/${regen.slug}` })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/public/menu/../../api/account' })).statusCode).toBe(404);
  });
});

describe('dispositivos de cocina (gestión)', () => {
  it('el token se muestra una vez y solo se guarda su hash', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/devices`, { name: 'Tablet cocina' });
    expect(res.statusCode).toBe(201);
    const { device, token } = json(res);
    expect(token).toMatch(/^kd_[A-Za-z0-9_-]{43}$/);
    const list = await client.get(`${base}/devices`);
    expect(list.body).not.toContain(token);
    expect(json(list).items[0]).toMatchObject({ id: device.id, name: 'Tablet cocina', active: true, revokedAt: null });
    const row = await ctx.deps.db.selectFrom('devices').selectAll().executeTakeFirstOrThrow();
    expect(row.token_hash).not.toContain(token);
    expect((await client.delete(`${base}/devices/${device.id}`)).statusCode).toBe(204);
    expect(json(await client.get(`${base}/devices`)).items[0].active).toBe(false);
    const audit = await ctx.deps.db.selectFrom('audit_events').select('event').where('event', 'in', ['device.created', 'device.revoked']).execute();
    expect(audit).toHaveLength(2);
  });
});
