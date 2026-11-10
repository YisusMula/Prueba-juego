import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDeps } from '../src/deps.js';
import type { AppDeps } from '../src/http/context.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { hashSecret } from '../src/lib/password.js';
import type { BillingProvider } from '../src/modules/billing/provider.js';
import { createOrganization } from '../src/modules/orgs/routes.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Cocina-Segura-2026';

export interface TestCtx {
  app: FastifyInstance;
  deps: AppDeps;
  mailer: MemoryMailer;
  config: Config;
}

export function testConfig(overrides: Partial<Config> = {}, env: Record<string, string> = {}): Config {
  return loadConfig(
    {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      APP_URL: ORIGIN,
      APP_NAME: 'EnRegla',
      COOKIE_SECURE: 'true',
      DATABASE_POOL_MAX: '5',
      ...env,
    },
    overrides,
  );
}

export async function createTestApp(opts: { config?: Partial<Config>; billing?: BillingProvider | null; env?: Record<string, string> } = {}): Promise<TestCtx> {
  const config = testConfig(opts.config, opts.env);
  const mailer = new MemoryMailer();
  const deps = createDeps(config, { mailer, ...(opts.billing !== undefined ? { billing: opts.billing } : {}) });
  const app = await buildApp(deps, { logger: false });
  await app.ready();
  return { app, deps, mailer, config };
}

export async function closeTestApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  await ctx.deps.db.destroy();
}

const TABLES = [
  'job_runs',
  'records',
  'audit_events',
  'rate_limits',
  'stripe_events',
  'dishes',
  'suppliers',
  'cleaning_plans',
  'equipment',
  'devices',
  'staff',
  'invitations',
  'memberships',
  'organizations',
  'email_tokens',
  'sessions',
  'users',
];

export async function resetDb(ctx: TestCtx): Promise<void> {
  await sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`).execute(ctx.deps.db);
  ctx.mailer.clear();
}

let cachedHash: Promise<string> | null = null;
export async function createUser(ctx: TestCtx, email: string, opts: { name?: string; verified?: boolean; password?: string } = {}) {
  const hash = opts.password ? await hashSecret(opts.password) : await (cachedHash ??= hashSecret(PASSWORD));
  return ctx.deps.db
    .insertInto('users')
    .values({
      email: email.toLowerCase(),
      name: opts.name ?? email.split('@')[0]!,
      password_hash: hash,
      email_verified_at: opts.verified === false ? null : new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Cliente HTTP de pruebas con tarro de cookies y cabeceras CSRF de la SPA. */
export class Client {
  cookies = new Map<string, string>();
  constructor(
    private readonly app: FastifyInstance,
    public extraHeaders: Record<string, string> = {},
    public csrf = true,
  ) {}

  async req(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { ...this.extraHeaders };
    if (this.csrf) {
      h.origin = ORIGIN;
      h['x-requested-with'] = 'XMLHttpRequest';
    }
    if (this.cookies.size > 0) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    Object.assign(h, headers);
    const res = await this.app.inject({
      method,
      url,
      headers: h,
      ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
    });
    // Los emails/tokens de registro y recuperación se generan tras responder (H10): se espera
    // a esos trabajos para que los tests sigan siendo deterministas.
    await this.app.drainBackground();
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }
  get = (url: string, headers?: Record<string, string>) => this.req('GET', url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req('POST', url, body, headers);
  patch = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req('PATCH', url, body, headers);
  delete = (url: string, body?: unknown, headers?: Record<string, string>) => this.req('DELETE', url, body, headers);
}

export async function login(ctx: TestCtx, email: string, password = PASSWORD): Promise<Client> {
  const c = new Client(ctx.app);
  const res = await c.post('/api/auth/login', { email, password });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  return c;
}

export async function setupOwner(ctx: TestCtx, email = 'owner@example.com', businessType: 'bar' | 'restaurante' | 'cafeteria' | 'obrador' | 'catering' | 'tienda' = 'restaurante') {
  const user = await createUser(ctx, email);
  const org = await createOrganization(ctx.deps.db, { name: `Local de ${email}`, businessType, timezone: 'Europe/Madrid', ownerId: user.id, trialDays: 14 });
  const client = await login(ctx, email);
  return { user, org, client, base: `/api/orgs/${org.id}` };
}

export async function addMember(ctx: TestCtx, orgId: string, email: string, role: 'owner' | 'manager') {
  const user = await createUser(ctx, email);
  await ctx.deps.db.insertInto('memberships').values({ organization_id: orgId, user_id: user.id, role }).execute();
  const client = await login(ctx, email);
  return { user, client };
}

export function tokenFromMail(mailer: MemoryMailer, to?: string): string {
  const msgs = to ? mailer.outbox.filter((m) => m.to === to) : mailer.outbox;
  const last = msgs[msgs.length - 1];
  if (!last) throw new Error('No hay emails');
  const m = /#token=([A-Za-z0-9_-]+)/.exec(last.text);
  if (!m) throw new Error(`El email no contiene token: ${last.subject}`);
  return m[1]!;
}

export const json = <T = any>(res: LightMyRequestResponse): T => res.json() as T; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function firstEquipment(ctx: TestCtx, orgId: string, type?: string) {
  let q = ctx.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', orgId);
  if (type) q = q.where('type', '=', type);
  return q.orderBy('created_at').executeTakeFirstOrThrow();
}

export async function createStaff(ctx: TestCtx, orgId: string, name: string, pin?: string) {
  return ctx.deps.db
    .insertInto('staff')
    .values({ organization_id: orgId, name, pin_hash: pin ? await hashSecret(pin) : null })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export const ALL_NO = Object.fromEntries(
  ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'].map((a) => [a, 'no']),
) as Record<string, 'no' | 'contains' | 'traces'>;
