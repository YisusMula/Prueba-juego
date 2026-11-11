/**
 * Rutas de la API simulada (las que usa la interfaz), con las mismas formas de respuesta y códigos
 * de error que `docs/API.md`. Las validaciones reutilizan los esquemas zod compartidos.
 */
import * as S from '@shared/schemas';
import { z } from 'zod';
import { CSV_HEADERS, csvLine, csvRow, type ReportRecord } from '../../../../server/src/modules/reports/format';
import type { BusinessType, PublicMenu, RecordType, Role } from '@/api/types';
import type { DemoState, DOrg, DRecord, DUser } from './state';
import { badRequest, conflict, DemoError, forbidden, idParam, invalidToken, notFound, parse, readOnly, unauthenticated, validationError } from './errors';
import { newDeviceToken, newSlug, uuid } from './ids';
import { createOrganization } from './orgs';
import { createRecord } from './records';
import { computeCompliance, computeToday } from './tasks';
import { dayStart, diffDays, iso, addDays } from './time';
import { cleaningPlanView, deviceView, dishView, equipmentView, isWritable, orgView, recordView, staffView, subscriptionView, supplierView } from './views';

export type DemoRequest = { method: string; path: string; query: URLSearchParams; body: unknown; headers: Headers; params: Record<string, string> };
export type DemoResponse = { status: number; json?: unknown; text?: string; contentType?: string; headers?: Record<string, string> };
type Handler = (db: DemoState, req: DemoRequest) => DemoResponse;

const ok = (json: unknown, status = 200): DemoResponse => ({ status, json });
const noContent = (): DemoResponse => ({ status: 204 });

/** Texto de los avisos de la demo en las respuestas que normalmente enviarían un email. */
export const NO_EMAIL_MESSAGE = 'En la demo no se envían correos.';
const SAMPLE_IP = '192.0.2.24';
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;
const PIN_DEVICE_WINDOW_MS = 15 * 60_000;
const PIN_DEVICE_MAX_FAILS = 20;

// ---------------------------------------------------------------------------
// Contexto: sesión, local, permisos
// ---------------------------------------------------------------------------
function sessionUser(db: DemoState): DUser {
  const u = db.users.find((x) => x.id === db.sessionUserId);
  if (!u) throw unauthenticated();
  return u;
}

type OrgCtx = { org: DOrg; role: Role; user: DUser };
function orgCtx(db: DemoState, req: DemoRequest): OrgCtx {
  const user = sessionUser(db);
  const id = idParam(req.params.orgId, 'Local');
  const m = db.memberships.find((x) => x.orgId === id && x.userId === user.id);
  const org = db.orgs.find((o) => o.id === id);
  if (!m || !org) throw notFound('Local');
  return { org, role: m.role, user };
}
const requireWritable = (c: OrgCtx) => {
  if (!isWritable(c.org)) throw readOnly();
  return c;
};
const requireOwner = (c: OrgCtx) => {
  if (c.role !== 'owner') throw forbidden();
  return c;
};

function audit(db: DemoState, orgId: string, event: string, userId: string | null, metadata: Record<string, unknown> = {}) {
  db.auditSeq += 1;
  db.audit.push({ id: db.auditSeq, orgId, event, userId, ip: userId ? SAMPLE_IP : null, metadata, createdAt: Date.now() });
}

function reauth(user: DUser, body: unknown) {
  const b = parse(S.passwordConfirmBody, body);
  if (b.password !== user.password) throw new DemoError(401, 'INVALID_CREDENTIALS', 'La contraseña no es correcta');
}

// ---------------------------------------------------------------------------
// Paginación (keyset por id del último elemento, como el servidor)
// ---------------------------------------------------------------------------
function paginate<T extends { id: string }, R>(rows: T[], query: URLSearchParams, map: (r: T) => R, extra: z.ZodRawShape = {}) {
  const q = parse(S.pagination.extend(extra), Object.fromEntries(query)) as { limit: number; cursor?: string };
  let start = 0;
  if (q.cursor) {
    const i = rows.findIndex((r) => r.id === q.cursor);
    start = i < 0 ? rows.length : i + 1;
  }
  const slice = rows.slice(start, start + q.limit);
  const hasMore = start + q.limit < rows.length;
  return { items: slice.map(map), nextCursor: hasMore && slice.length ? slice[slice.length - 1]!.id : null };
}
const byCreated = <T extends { createdAt: number; id: string }>(a: T, b: T) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

// ---------------------------------------------------------------------------
// Idempotencia (API §1.7)
// ---------------------------------------------------------------------------
function withIdempotency(db: DemoState, req: DemoRequest, orgId: string, scope: string, payload: unknown, create: () => DRecord): DemoResponse {
  const key = req.headers.get('Idempotency-Key');
  if (key == null) return ok({ record: recordView(db, create()) }, 201);
  if (!S.uuid.safeParse(key).success) throw validationError('Idempotency-Key', 'La clave de idempotencia debe ser un UUID');
  const k = `${orgId}|${scope}|${key}`;
  const body = JSON.stringify(payload);
  const prev = db.idempotency[k];
  if (prev) {
    if (prev.payload !== body) throw conflict('Esta clave de idempotencia ya se usó con otros datos');
    const rec = db.records.find((r) => r.id === prev.recordId);
    if (rec) return { status: 200, json: { record: recordView(db, rec) }, headers: { 'Idempotent-Replayed': 'true' } };
  }
  const rec = create();
  db.idempotency[k] = { payload: body, recordId: rec.id };
  return ok({ record: recordView(db, rec) }, 201);
}

// ---------------------------------------------------------------------------
// Informes
// ---------------------------------------------------------------------------
function reportFilename(org: DOrg, from: string, to: string, ext: string): string {
  const slug = org.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return `registros-${slug || 'local'}-${from}-a-${to}.${ext}`;
}

function parseReportQuery(query: URLSearchParams) {
  const q = parse(S.reportQuery, Object.fromEntries(query));
  if (diffDays(q.from, q.to) + 1 > 366) throw badRequest('El periodo máximo de un informe es de 1 año');
  return q;
}

/** Registros del periodo y tipos, por fecha del hecho (cada enmienda junto a su original). */
export function reportRecords(db: DemoState, org: DOrg, from: string, to: string, types: RecordType[]): ReportRecord[] {
  const tz = org.timezone;
  const a = dayStart(from, tz);
  const b = dayStart(addDays(to, 1), tz);
  return db.records
    .filter((r) => r.orgId === org.id && types.includes(r.type) && r.effectiveAt >= a && r.effectiveAt < b)
    .sort((x, y) => x.effectiveAt - y.effectiveAt || x.id.localeCompare(y.id))
    .map((r) => {
      const amendment = db.records.find((x) => x.amendsRecordId === r.id);
      return {
        id: r.id,
        organization_id: r.orgId,
        type: r.type,
        data: r.data,
        staff_id: r.staffId,
        staff_name: r.staffName,
        user_id: r.userId,
        user_name: r.userName,
        device_id: r.deviceId,
        equipment_id: r.equipmentId,
        cleaning_plan_id: r.cleaningPlanId,
        amends_record_id: r.amendsRecordId,
        amendment_reason: r.amendmentReason,
        alert: r.alert,
        created_at: new Date(r.createdAt),
        effective_at: new Date(r.effectiveAt),
        amended_by: amendment?.id ?? null,
        amended_at: amendment ? new Date(amendment.createdAt) : null,
        amended_by_name: amendment ? (amendment.staffName ?? amendment.userName) : null,
      };
    });
}

export function buildCsv(db: DemoState, org: DOrg, from: string, to: string, types: RecordType[]): { filename: string; text: string } {
  let text = '\uFEFF' + csvLine(CSV_HEADERS);
  for (const r of reportRecords(db, org, from, to, types)) text += csvLine(csvRow(r, org.timezone));
  return { filename: reportFilename(org, from, to, 'csv'), text };
}

// ---------------------------------------------------------------------------
// Modo cocina (dispositivo por token)
// ---------------------------------------------------------------------------
function deviceCtx(db: DemoState, req: DemoRequest) {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const device = db.devices.find((d) => d.token === token && d.revokedAt == null);
  const org = device ? db.orgs.find((o) => o.id === device.orgId) : undefined;
  if (!device || !org) throw new DemoError(401, 'UNAUTHENTICATED', 'Dispositivo de cocina no autorizado o revocado');
  if (!device.lastUsedAt || Date.now() - device.lastUsedAt > 60_000) device.lastUsedAt = Date.now();
  return { device, org };
}

const pinLocked = (retrySeconds: number) =>
  new DemoError(429, 'PIN_LOCKED', 'PIN bloqueado temporalmente por demasiados intentos fallidos. Pide a un encargado que lo desbloquee o espera unos minutos.', undefined, {
    'Retry-After': String(Math.max(1, Math.ceil(retrySeconds))),
  });

/** Comprobación del PIN con bloqueo a los 5 fallos seguidos (15 min) y límite por dispositivo. */
function verifyPin(db: DemoState, ctx: { device: { id: string }; org: DOrg }, staffId: string, pin: string) {
  const st = db.staff.find((s) => s.id === staffId)!;
  const now = Date.now();
  const fails = (db.pinFailsByDevice[ctx.device.id] ?? []).filter((t) => now - t < PIN_DEVICE_WINDOW_MS);
  db.pinFailsByDevice[ctx.device.id] = fails;
  if (fails.length >= PIN_DEVICE_MAX_FAILS) {
    const retry = (fails[0]! + PIN_DEVICE_WINDOW_MS - now) / 1000;
    throw new DemoError(429, 'RATE_LIMITED', 'Demasiados PIN incorrectos en este dispositivo. Espera unos minutos.', undefined, { 'Retry-After': String(Math.ceil(retry)) });
  }
  if (st.lockedUntil && st.lockedUntil > now) throw pinLocked((st.lockedUntil - now) / 1000);
  if (st.lockedUntil && st.lockedUntil <= now) {
    st.lockedUntil = null;
    st.failed = 0;
  }
  if (/^\d{4,6}$/.test(pin) && pin === st.pin) {
    st.failed = 0;
    return;
  }
  st.failed += 1;
  fails.push(now);
  audit(db, ctx.org.id, 'staff.pin_failed', null, { staffId, deviceId: ctx.device.id });
  if (st.failed >= PIN_MAX_FAILURES) {
    st.lockedUntil = now + PIN_LOCK_MS;
    audit(db, ctx.org.id, 'staff.pin_locked', null, { staffId, deviceId: ctx.device.id });
    throw pinLocked(PIN_LOCK_MS / 1000);
  }
  throw new DemoError(401, 'INVALID_PIN', 'PIN incorrecto');
}

function kioskStaff(db: DemoState, org: DOrg, staffId: string) {
  const staff = db.staff.find((s) => s.id === staffId && s.orgId === org.id);
  if (!staff) throw notFound('Miembro del personal');
  if (!staff.active) throw validationError('staffId', 'Ese miembro del personal está desactivado');
  return staff;
}

// ---------------------------------------------------------------------------
// Exportación RGPD (los datos de la demo, con el mismo esquema que el servidor)
// ---------------------------------------------------------------------------
function exportJson(db: DemoState, org: DOrg): string {
  const snake = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), typeof v === 'number' && /At$|^createdAt$/.test(k) ? iso(v) : v]));
  const mine = <T extends { orgId: string }>(list: T[]) => list.filter((x) => x.orgId === org.id);
  const out = {
    exportedAt: new Date().toISOString(),
    organization: {
      id: org.id,
      name: org.name,
      businessType: org.businessType,
      timezone: org.timezone,
      reminderEnabled: org.reminderEnabled,
      reminderHour: org.reminderHour,
      publicMenuEnabled: org.publicMenuEnabled,
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt: iso(org.trialEndsAt),
      plan: null,
      createdAt: iso(org.createdAt),
    },
    members: db.memberships
      .filter((m) => m.orgId === org.id)
      .map((m) => {
        const u = db.users.find((x) => x.id === m.userId)!;
        return { id: u.id, name: u.name, email: u.email, role: m.role, created_at: iso(m.createdAt) };
      }),
    staff: mine(db.staff).map((s) => ({ id: s.id, name: s.name, active: s.active, created_at: iso(s.createdAt) })),
    devices: mine(db.devices).map((d) => ({
      id: d.id,
      name: d.name,
      created_at: iso(d.createdAt),
      last_used_at: d.lastUsedAt ? iso(d.lastUsedAt) : null,
      revoked_at: d.revokedAt ? iso(d.revokedAt) : null,
    })),
    equipment: mine(db.equipment).map(({ history: _h, ...e }) => snake(e)),
    cleaningPlans: mine(db.plans).map(({ history: _h, ...p }) => snake(p)),
    suppliers: mine(db.suppliers).map((s) => snake(s)),
    dishes: mine(db.dishes).map((d) => snake(d)),
    records: mine(db.records)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => recordView(db, r)),
    auditEvents: mine(db.audit).map((a) => ({ id: String(a.id), event: a.event, user_id: a.userId, ip: a.ip, metadata: a.metadata, created_at: iso(a.createdAt) })),
  };
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Tabla de rutas
// ---------------------------------------------------------------------------
const ORG = '/api/orgs/:orgId';
const table: [string, string, Handler][] = [];
const route = (method: string, path: string, h: Handler) => table.push([method, path, h]);

// --- Autenticación ----------------------------------------------------------
route('POST', '/api/auth/login', (db, req) => {
  const b = parse(S.loginBody, req.body);
  const user = db.users.find((u) => u.email === b.email);
  if (!user || user.password !== b.password) throw new DemoError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
  db.sessionUserId = user.id;
  return ok({ user: { id: user.id, email: user.email, name: user.name, emailVerified: true, createdAt: iso(user.createdAt) } });
});
route('POST', '/api/auth/logout', (db) => {
  db.sessionUserId = null;
  return noContent();
});
route('POST', '/api/auth/logout-all', (db) => {
  sessionUser(db);
  db.sessionUserId = null;
  return noContent();
});
route('POST', '/api/auth/register', (_db, req) => {
  parse(S.registerBody, req.body);
  const b = req.body as { password: string; email: string; name: string };
  const problem = S.checkPasswordPolicy(b.password, { email: b.email, name: b.name });
  if (problem) throw validationError('password', problem);
  return ok({ message: `Si los datos son correctos, recibirás un email en unos minutos. ${NO_EMAIL_MESSAGE}` }, 202);
});
route('POST', '/api/auth/resend-verification', (_db, req) => {
  parse(S.emailBody, req.body);
  return ok({ message: `Si hay una cuenta pendiente de confirmar, te hemos reenviado el enlace. ${NO_EMAIL_MESSAGE}` }, 202);
});
route('POST', '/api/auth/password-reset/request', (_db, req) => {
  parse(S.emailBody, req.body);
  return ok({ message: `Si el email corresponde a una cuenta, recibirás un enlace para restablecer la contraseña. ${NO_EMAIL_MESSAGE}` }, 202);
});
for (const p of ['/api/auth/verify-email', '/api/auth/password-reset/confirm', '/api/auth/email-change/confirm', '/api/invitations/preview', '/api/invitations/accept']) {
  route('POST', p, () => {
    throw invalidToken();
  });
}

// --- Cuenta -------------------------------------------------------------------
const userView = (u: DUser) => ({ id: u.id, email: u.email, name: u.name, emailVerified: true, createdAt: iso(u.createdAt) });
route('GET', '/api/account', (db) => {
  const user = sessionUser(db);
  const organizations = db.memberships
    .filter((m) => m.userId === user.id)
    .map((m) => ({ m, o: db.orgs.find((o) => o.id === m.orgId)! }))
    .filter((x) => x.o)
    .sort((a, b) => a.o.createdAt - b.o.createdAt)
    .map(({ m, o }) => ({ id: o.id, name: o.name, businessType: o.businessType, role: m.role, subscription: subscriptionView(o), deletionScheduledAt: o.deletionScheduledAt ? iso(o.deletionScheduledAt) : null }));
  return ok({ user: userView(user), organizations });
});
route('PATCH', '/api/account', (db, req) => {
  const user = sessionUser(db);
  user.name = parse(S.updateAccountBody, req.body).name;
  return ok({ user: userView(user) });
});
route('POST', '/api/account/password', (db, req) => {
  const user = sessionUser(db);
  const b = parse(S.changePasswordBody, req.body);
  if (b.currentPassword !== user.password) throw new DemoError(401, 'INVALID_CREDENTIALS', 'La contraseña actual no es correcta');
  const problem = S.checkPasswordPolicy(b.newPassword, { email: user.email, name: user.name });
  if (problem) throw validationError('newPassword', problem);
  user.password = b.newPassword;
  return noContent();
});
route('POST', '/api/account/email', (db, req) => {
  const user = sessionUser(db);
  const b = parse(S.changeEmailBody, req.body);
  if (b.password !== user.password) throw new DemoError(401, 'INVALID_CREDENTIALS', 'La contraseña no es correcta');
  if (b.newEmail === user.email) throw badRequest('Ese ya es tu email');
  return ok({ message: `En la app real te enviaríamos un enlace de confirmación al nuevo email; ${NO_EMAIL_MESSAGE.toLowerCase()} Tu email sigue siendo ${user.email}.` }, 202);
});
route('DELETE', '/api/account', (db, req) => {
  const user = sessionUser(db);
  reauth(user, req.body);
  const soleOwner = db.memberships.some(
    (m) => m.userId === user.id && m.role === 'owner' && !db.orgs.find((o) => o.id === m.orgId)?.deletionScheduledAt && !db.memberships.some((x) => x.orgId === m.orgId && x.userId !== user.id && x.role === 'owner'),
  );
  if (soleOwner) throw conflict('Eres el único propietario de algún local. Nombra otro propietario o elimina el local antes de borrar tu cuenta.');
  throw conflict('En la demo no se puede eliminar la cuenta de ejemplo.');
});

// --- Locales ------------------------------------------------------------------
route('GET', '/api/orgs', (db) => {
  const user = sessionUser(db);
  const items = db.memberships
    .filter((m) => m.userId === user.id)
    .map((m) => ({ m, o: db.orgs.find((o) => o.id === m.orgId) }))
    .filter((x): x is { m: (typeof x)['m']; o: DOrg } => !!x.o)
    .sort((a, b) => a.o.createdAt - b.o.createdAt)
    .map(({ m, o }) => orgView(o, m.role));
  return ok({ items });
});
route('POST', '/api/orgs', (db, req) => {
  const user = sessionUser(db);
  const b = parse(S.createOrgBody, req.body);
  if (db.memberships.filter((m) => m.userId === user.id).length >= 50) throw conflict('Has alcanzado el número máximo de locales por cuenta');
  const org = createOrganization(db, { name: b.name, businessType: b.businessType as BusinessType, timezone: b.timezone, ownerId: user.id, now: Date.now() });
  audit(db, org.id, 'org.created', user.id, { businessType: b.businessType });
  return ok({ organization: orgView(org, 'owner') }, 201);
});
route('GET', ORG, (db, req) => {
  const c = orgCtx(db, req);
  return ok({ organization: orgView(c.org, c.role) });
});
route('PATCH', ORG, (db, req) => {
  const c = requireWritable(requireOwner(orgCtx(db, req)));
  const b = parse(S.updateOrgBody, req.body);
  if (b.name !== undefined) c.org.name = b.name;
  if (b.timezone !== undefined) c.org.timezone = b.timezone;
  if (b.reminderEnabled !== undefined) c.org.reminderEnabled = b.reminderEnabled;
  if (b.reminderHour !== undefined) c.org.reminderHour = b.reminderHour;
  audit(db, c.org.id, 'org.updated', c.user.id, { fields: Object.keys(b) });
  return ok({ organization: orgView(c.org, c.role) });
});
route('DELETE', ORG, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  reauth(c.user, req.body);
  if (c.org.deletionScheduledAt) throw conflict('Este local ya está pendiente de eliminación.');
  const now = Date.now();
  c.org.deletionScheduledAt = now + 30 * 86_400_000;
  let devicesRevoked = 0;
  for (const d of db.devices) {
    if (d.orgId === c.org.id && d.revokedAt == null) {
      d.revokedAt = now;
      devicesRevoked += 1;
    }
  }
  const before = db.invitations.length;
  db.invitations = db.invitations.filter((i) => i.orgId !== c.org.id);
  audit(db, c.org.id, 'org.deletion_scheduled', c.user.id, { scheduledFor: iso(c.org.deletionScheduledAt), devicesRevoked, invitationsRevoked: before - db.invitations.length });
  return noContent();
});
route('POST', `${ORG}/restore`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  if (!c.org.deletionScheduledAt) throw conflict('Este local no está pendiente de eliminación.');
  c.org.deletionScheduledAt = null;
  audit(db, c.org.id, 'org.restored', c.user.id);
  return ok({ organization: orgView(c.org, c.role) });
});
route('DELETE', `${ORG}/permanent`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  reauth(c.user, req.body);
  if (!c.org.deletionScheduledAt) throw conflict('Primero solicita la eliminación del local; la eliminación inmediata solo está disponible para locales pendientes de eliminación.');
  const id = c.org.id;
  const keep = <T extends { orgId: string }>(list: T[]) => list.filter((x) => x.orgId !== id);
  db.orgs = db.orgs.filter((o) => o.id !== id);
  db.memberships = keep(db.memberships);
  db.staff = keep(db.staff);
  db.devices = keep(db.devices);
  db.equipment = keep(db.equipment);
  db.plans = keep(db.plans);
  db.suppliers = keep(db.suppliers);
  db.dishes = keep(db.dishes);
  db.records = keep(db.records);
  db.invitations = keep(db.invitations);
  db.audit = keep(db.audit);
  return noContent();
});
route('GET', `${ORG}/membership`, (db, req) => {
  const c = orgCtx(db, req);
  const m = db.memberships.find((x) => x.orgId === c.org.id && x.userId === c.user.id)!;
  return ok({ role: m.role, dailyReminder: m.dailyReminder });
});
route('PATCH', `${ORG}/membership`, (db, req) => {
  const c = orgCtx(db, req);
  const b = parse(S.membershipPrefsBody, req.body);
  db.memberships.find((x) => x.orgId === c.org.id && x.userId === c.user.id)!.dailyReminder = b.dailyReminder;
  return ok({ dailyReminder: b.dailyReminder });
});
route('GET', `${ORG}/export`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  audit(db, c.org.id, 'org.exported', c.user.id);
  const date = new Date().toISOString().slice(0, 10);
  return { status: 200, text: exportJson(db, c.org), contentType: 'application/json; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="exportacion-${date}.json"` } };
});
route('GET', `${ORG}/audit`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().regex(/^\d+$/).optional() }), Object.fromEntries(req.query));
  const list = db.audit.filter((a) => a.orgId === c.org.id && !a.event.startsWith('auth.')).sort((a, b) => b.id - a.id);
  const rows = q.cursor ? list.filter((a) => a.id < Number(q.cursor)) : list;
  const slice = rows.slice(0, q.limit);
  return ok({
    items: slice.map((a) => {
      const u = a.userId ? db.users.find((x) => x.id === a.userId) : null;
      return { id: String(a.id), event: a.event, user: a.userId ? { id: a.userId, name: u?.name ?? null } : null, ip: a.ip, metadata: a.metadata, createdAt: iso(a.createdAt) };
    }),
    nextCursor: rows.length > q.limit && slice.length ? String(slice[slice.length - 1]!.id) : null,
  });
});

// --- Miembros e invitaciones -------------------------------------------------
route('GET', `${ORG}/members`, (db, req) => {
  const c = orgCtx(db, req);
  const items = db.memberships
    .filter((m) => m.orgId === c.org.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => {
      const u = db.users.find((x) => x.id === m.userId)!;
      return { userId: u.id, name: u.name, email: u.email, role: m.role, joinedAt: iso(m.createdAt) };
    });
  return ok({ items, nextCursor: null });
});
route('PATCH', `${ORG}/members/:userId`, (db, req) => {
  const c = requireWritable(requireOwner(orgCtx(db, req)));
  const userId = idParam(req.params.userId, 'Miembro');
  const b = parse(S.updateMemberBody, req.body);
  const m = db.memberships.find((x) => x.orgId === c.org.id && x.userId === userId);
  if (!m) throw notFound('Miembro');
  const owners = db.memberships.filter((x) => x.orgId === c.org.id && x.role === 'owner' && x.userId !== userId);
  if (m.role === 'owner' && b.role !== 'owner' && owners.length === 0) throw conflict('El local debe tener al menos un propietario');
  audit(db, c.org.id, 'member.role_changed', c.user.id, { target: userId, from: m.role, to: b.role });
  m.role = b.role;
  return ok({ userId, role: b.role });
});
route('DELETE', `${ORG}/members/:userId`, (db, req) => {
  const c = orgCtx(db, req);
  const userId = idParam(req.params.userId, 'Miembro');
  if (userId !== c.user.id && c.role !== 'owner') throw forbidden('Solo el propietario puede quitar a otros miembros');
  const m = db.memberships.find((x) => x.orgId === c.org.id && x.userId === userId);
  if (!m) throw notFound('Miembro');
  const owners = db.memberships.filter((x) => x.orgId === c.org.id && x.role === 'owner' && x.userId !== userId);
  if (m.role === 'owner' && owners.length === 0) throw conflict('El local debe tener al menos un propietario. Nombra otro propietario o elimina el local.');
  db.memberships = db.memberships.filter((x) => x !== m);
  audit(db, c.org.id, 'member.removed', c.user.id, { target: userId });
  return noContent();
});
route('GET', `${ORG}/invitations`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  const now = Date.now();
  const items = db.invitations
    .filter((i) => i.orgId === c.org.id && i.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: iso(i.expiresAt), createdAt: iso(i.createdAt) }));
  return ok({ items, nextCursor: null });
});
route('POST', `${ORG}/invitations`, (db, req) => {
  const c = requireWritable(requireOwner(orgCtx(db, req)));
  const b = parse(S.inviteBody, req.body);
  const already = db.memberships.some((m) => m.orgId === c.org.id && db.users.find((u) => u.id === m.userId)?.email === b.email);
  if (already) throw conflict('Esa persona ya es miembro del local');
  db.invitations = db.invitations.filter((i) => !(i.orgId === c.org.id && i.email === b.email));
  const now = Date.now();
  const inv = { id: uuid(), orgId: c.org.id, email: b.email, role: b.role, invitedBy: c.user.id, expiresAt: now + 7 * 86_400_000, createdAt: now };
  db.invitations.push(inv);
  audit(db, c.org.id, 'member.invited', c.user.id, { email: b.email, role: b.role });
  return ok({ invitation: { id: inv.id, email: inv.email, role: inv.role, expiresAt: iso(inv.expiresAt), createdAt: iso(inv.createdAt) } }, 201);
});
route('DELETE', `${ORG}/invitations/:invitationId`, (db, req) => {
  const c = requireOwner(orgCtx(db, req));
  const id = idParam(req.params.invitationId, 'Invitación');
  const inv = db.invitations.find((i) => i.id === id && i.orgId === c.org.id);
  if (!inv) throw notFound('Invitación');
  db.invitations = db.invitations.filter((i) => i !== inv);
  audit(db, c.org.id, 'member.invitation_revoked', c.user.id, { email: inv.email });
  return noContent();
});

// --- Personal -------------------------------------------------------------------
route('GET', `${ORG}/staff`, (db, req) => {
  const c = orgCtx(db, req);
  const active = req.query.get('active');
  const list = db.staff.filter((s) => s.orgId === c.org.id && (active == null || String(s.active) === active)).sort(byCreated);
  return ok(paginate(list, req.query, staffView, { active: S.booleanString.optional() }));
});
route('POST', `${ORG}/staff`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.createStaffBody, req.body);
  const s = { id: uuid(), orgId: c.org.id, name: b.name, pin: b.pin ?? null, active: true, failed: 0, lockedUntil: null, createdAt: Date.now() };
  db.staff.push(s);
  return ok({ staff: staffView(s) }, 201);
});
route('PATCH', `${ORG}/staff/:staffId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.staffId, 'Miembro del personal');
  const b = parse(S.updateStaffBody, req.body);
  const s = db.staff.find((x) => x.id === id && x.orgId === c.org.id);
  if (!s) throw notFound('Miembro del personal');
  if (b.name !== undefined) s.name = b.name;
  if (b.active !== undefined) s.active = b.active;
  if (b.pin !== undefined) {
    s.pin = b.pin;
    s.failed = 0;
    s.lockedUntil = null;
    audit(db, c.org.id, 'staff.pin_changed', c.user.id, { staffId: id, removed: b.pin === null });
  }
  return ok({ staff: staffView(s) });
});
route('POST', `${ORG}/staff/:staffId/unlock`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.staffId, 'Miembro del personal');
  const s = db.staff.find((x) => x.id === id && x.orgId === c.org.id);
  if (!s) throw notFound('Miembro del personal');
  s.failed = 0;
  s.lockedUntil = null;
  return ok({ staff: staffView(s) });
});

// --- Dispositivos de cocina ---------------------------------------------------------
route('GET', `${ORG}/devices`, (db, req) => {
  const c = orgCtx(db, req);
  return ok(paginate(db.devices.filter((d) => d.orgId === c.org.id).sort(byCreated), req.query, (d) => deviceView(db, d)));
});
route('POST', `${ORG}/devices`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.createDeviceBody, req.body);
  if (db.devices.filter((d) => d.orgId === c.org.id && d.revokedAt == null).length >= 20) throw conflict('Has alcanzado el máximo de 20 dispositivos de cocina activos');
  const d = { id: uuid(), orgId: c.org.id, name: b.name, token: newDeviceToken(), createdBy: c.user.id, createdAt: Date.now(), lastUsedAt: null, revokedAt: null };
  db.devices.push(d);
  audit(db, c.org.id, 'device.created', c.user.id, { deviceId: d.id, name: d.name });
  return ok({ device: deviceView(db, d), token: d.token }, 201);
});
route('DELETE', `${ORG}/devices/:deviceId`, (db, req) => {
  const c = orgCtx(db, req);
  const id = idParam(req.params.deviceId, 'Dispositivo');
  const d = db.devices.find((x) => x.id === id && x.orgId === c.org.id);
  if (!d) throw notFound('Dispositivo');
  d.revokedAt ??= Date.now();
  audit(db, c.org.id, 'device.revoked', c.user.id, { deviceId: id });
  return noContent();
});

// --- Equipos ------------------------------------------------------------------------
route('GET', `${ORG}/equipment`, (db, req) => {
  const c = orgCtx(db, req);
  const active = req.query.get('active');
  const type = req.query.get('type');
  const list = db.equipment.filter((e) => e.orgId === c.org.id && (active == null || String(e.active) === active) && (!type || e.type === type)).sort(byCreated);
  return ok(paginate(list, req.query, equipmentView, { active: S.booleanString.optional(), type: S.equipmentType.optional() }));
});
route('GET', `${ORG}/equipment/:equipmentId`, (db, req) => {
  const c = orgCtx(db, req);
  const e = db.equipment.find((x) => x.id === idParam(req.params.equipmentId, 'Equipo') && x.orgId === c.org.id);
  if (!e) throw notFound('Equipo');
  return ok({ equipment: equipmentView(e) });
});
route('POST', `${ORG}/equipment`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.createEquipmentBody, req.body);
  const now = Date.now();
  const e = { id: uuid(), orgId: c.org.id, name: b.name, type: b.type, minTemp: b.minTemp, maxTemp: b.maxTemp, checksPerDay: b.checksPerDay, active: b.active, createdAt: now, history: [{ validFrom: now, checksPerDay: b.checksPerDay, active: b.active }] };
  db.equipment.push(e);
  return ok({ equipment: equipmentView(e) }, 201);
});
route('PATCH', `${ORG}/equipment/:equipmentId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.equipmentId, 'Equipo');
  const b = parse(S.updateEquipmentBody, req.body);
  const e = db.equipment.find((x) => x.id === id && x.orgId === c.org.id);
  if (!e) throw notFound('Equipo');
  const min = b.minTemp !== undefined ? b.minTemp : e.minTemp;
  const max = b.maxTemp !== undefined ? b.maxTemp : e.maxTemp;
  if (min != null && max != null && min > max) throw validationError('minTemp', 'La temperatura mínima no puede ser mayor que la máxima');
  if (b.name !== undefined) e.name = b.name;
  if (b.type !== undefined) e.type = b.type;
  e.minTemp = min;
  e.maxTemp = max;
  const before = `${e.checksPerDay}|${e.active}`;
  if (b.checksPerDay !== undefined) e.checksPerDay = b.checksPerDay;
  if (b.active !== undefined) e.active = b.active;
  if (`${e.checksPerDay}|${e.active}` !== before) e.history.push({ validFrom: Date.now(), checksPerDay: e.checksPerDay, active: e.active });
  return ok({ equipment: equipmentView(e) });
});

// --- Planes de limpieza --------------------------------------------------------------
type ItemInput = { id?: string; area: string; product?: string | null; method?: string | null };
function normalizeItems(items: ItemInput[], existing: { id: string }[] = []) {
  const known = new Set(existing.map((i) => i.id));
  const used = new Set<string>();
  return items.map((i) => {
    let id = i.id && known.has(i.id) && !used.has(i.id) ? i.id : uuid();
    if (used.has(id)) id = uuid();
    used.add(id);
    return { id, area: i.area, product: i.product ?? null, method: i.method ?? null };
  });
}
route('GET', `${ORG}/cleaning-plans`, (db, req) => {
  const c = orgCtx(db, req);
  const active = req.query.get('active');
  const list = db.plans.filter((p) => p.orgId === c.org.id && (active == null || String(p.active) === active)).sort(byCreated);
  return ok(paginate(list, req.query, cleaningPlanView, { active: S.booleanString.optional() }));
});
route('GET', `${ORG}/cleaning-plans/:planId`, (db, req) => {
  const c = orgCtx(db, req);
  const p = db.plans.find((x) => x.id === idParam(req.params.planId, 'Plan de limpieza') && x.orgId === c.org.id);
  if (!p) throw notFound('Plan de limpieza');
  return ok({ cleaningPlan: cleaningPlanView(p) });
});
route('POST', `${ORG}/cleaning-plans`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.createCleaningPlanBody, req.body);
  const now = Date.now();
  const weekday = b.frequency === 'weekly' ? b.weekday : null;
  const monthDay = b.frequency === 'monthly' ? b.monthDay : null;
  const p = {
    id: uuid(),
    orgId: c.org.id,
    name: b.name,
    frequency: b.frequency,
    weekday,
    monthDay,
    items: normalizeItems(b.items),
    active: b.active,
    createdAt: now,
    history: [{ validFrom: now, frequency: b.frequency, weekday, monthDay, active: b.active }],
  };
  db.plans.push(p);
  return ok({ cleaningPlan: cleaningPlanView(p) }, 201);
});
route('PATCH', `${ORG}/cleaning-plans/:planId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.planId, 'Plan de limpieza');
  const b = parse(S.updateCleaningPlanBody, req.body);
  const p = db.plans.find((x) => x.id === id && x.orgId === c.org.id);
  if (!p) throw notFound('Plan de limpieza');
  const frequency = b.frequency ?? p.frequency;
  const weekday = b.weekday !== undefined ? b.weekday : p.weekday;
  const monthDay = b.monthDay !== undefined ? b.monthDay : p.monthDay;
  if (frequency === 'weekly' && weekday == null) throw validationError('weekday', 'Indica el día de la semana');
  if (frequency === 'monthly' && monthDay == null) throw validationError('monthDay', 'Indica el día del mes');
  const before = JSON.stringify([p.frequency, p.weekday, p.monthDay, p.active]);
  if (b.name !== undefined) p.name = b.name;
  p.frequency = frequency;
  p.weekday = frequency === 'weekly' ? weekday : null;
  p.monthDay = frequency === 'monthly' ? monthDay : null;
  if (b.items !== undefined) p.items = normalizeItems(b.items, p.items);
  if (b.active !== undefined) p.active = b.active;
  if (JSON.stringify([p.frequency, p.weekday, p.monthDay, p.active]) !== before) {
    p.history.push({ validFrom: Date.now(), frequency: p.frequency, weekday: p.weekday, monthDay: p.monthDay, active: p.active });
  }
  return ok({ cleaningPlan: cleaningPlanView(p) });
});

// --- Proveedores ----------------------------------------------------------------------
route('GET', `${ORG}/suppliers`, (db, req) => {
  const c = orgCtx(db, req);
  const q = (req.query.get('q') ?? '').trim().toLowerCase();
  const list = db.suppliers.filter((s) => s.orgId === c.org.id && (!q || s.name.toLowerCase().includes(q))).sort(byCreated);
  return ok(paginate(list, req.query, supplierView, { q: z.string().trim().max(100).optional() }));
});
route('GET', `${ORG}/suppliers/:supplierId`, (db, req) => {
  const c = orgCtx(db, req);
  const s = db.suppliers.find((x) => x.id === idParam(req.params.supplierId, 'Proveedor') && x.orgId === c.org.id);
  if (!s) throw notFound('Proveedor');
  return ok({ supplier: supplierView(s) });
});
route('POST', `${ORG}/suppliers`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.supplierBody, req.body);
  const s = { id: uuid(), orgId: c.org.id, name: b.name, contactName: b.contactName, phone: b.phone, email: b.email, products: b.products, notes: b.notes, createdAt: Date.now() };
  db.suppliers.push(s);
  return ok({ supplier: supplierView(s) }, 201);
});
route('PATCH', `${ORG}/suppliers/:supplierId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.supplierId, 'Proveedor');
  const b = parse(S.updateSupplierBody, req.body);
  const s = db.suppliers.find((x) => x.id === id && x.orgId === c.org.id);
  if (!s) throw notFound('Proveedor');
  Object.assign(s, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
  return ok({ supplier: supplierView(s) });
});
route('DELETE', `${ORG}/suppliers/:supplierId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.supplierId, 'Proveedor');
  if (!db.suppliers.some((x) => x.id === id && x.orgId === c.org.id)) throw notFound('Proveedor');
  db.suppliers = db.suppliers.filter((x) => x.id !== id);
  return noContent();
});

// --- Registros ------------------------------------------------------------------------
route('GET', `${ORG}/records`, (db, req) => {
  const c = orgCtx(db, req);
  const q = parse(S.listRecordsQuery, Object.fromEntries(req.query));
  const tz = c.org.timezone;
  const from = q.from ? dayStart(q.from, tz) : -Infinity;
  const to = q.to ? dayStart(addDays(q.to, 1), tz) : Infinity;
  const list = db.records
    .filter(
      (r) =>
        r.orgId === c.org.id &&
        (!q.type || r.type === q.type) &&
        (!q.equipmentId || r.equipmentId === q.equipmentId) &&
        (!q.staffId || r.staffId === q.staffId) &&
        (q.alert === undefined || r.alert === q.alert) &&
        r.effectiveAt >= from &&
        r.effectiveAt < to,
    )
    .sort((a, b) => b.effectiveAt - a.effectiveAt || (a.id < b.id ? 1 : -1));
  return ok(paginate(list, req.query, (r) => recordView(db, r), S.listRecordsQuery.shape));
});
route('GET', `${ORG}/records/:recordId`, (db, req) => {
  const c = orgCtx(db, req);
  const id = idParam(req.params.recordId, 'Registro');
  const rec = db.records.find((r) => r.id === id && r.orgId === c.org.id);
  if (!rec) throw notFound('Registro');
  const amends = rec.amendsRecordId ? db.records.find((r) => r.id === rec.amendsRecordId) : undefined;
  const amendedById = db.records.find((r) => r.amendsRecordId === rec.id);
  return ok({ record: recordView(db, rec), amends: amends ? recordView(db, amends) : null, amendedBy: amendedById ? recordView(db, amendedById) : null });
});
route('POST', `${ORG}/records`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.createRecordBody, req.body);
  return withIdempotency(db, req, c.org.id, 'records', b, () =>
    createRecord(db, c.org, { userId: c.user.id, userName: c.user.name, staffId: b.staffId ?? null, deviceId: null }, b.type, b.data),
  );
});
route('POST', `${ORG}/records/:recordId/amendments`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.recordId, 'Registro');
  const b = parse(S.amendmentBody, req.body);
  return withIdempotency(db, req, c.org.id, `amendment:${id}`, b, () =>
    createRecord(db, c.org, { userId: c.user.id, userName: c.user.name, staffId: b.staffId ?? null, deviceId: null }, null, b.data, { originalId: id, reason: b.reason }),
  );
});

// --- Platos y carta pública -----------------------------------------------------------
const menuView = (o: DOrg) => ({ enabled: o.publicMenuEnabled, slug: o.publicMenuSlug, apiPath: `/api/public/menu/${o.publicMenuSlug}` });
route('GET', `${ORG}/dishes`, (db, req) => {
  const c = orgCtx(db, req);
  const category = req.query.get('category');
  const list = db.dishes.filter((d) => d.orgId === c.org.id && (!category || d.category === category)).sort(byCreated);
  return ok(paginate(list, req.query, dishView, { category: z.string().trim().max(100).optional() }));
});
route('GET', `${ORG}/dishes/:dishId`, (db, req) => {
  const c = orgCtx(db, req);
  const d = db.dishes.find((x) => x.id === idParam(req.params.dishId, 'Plato') && x.orgId === c.org.id);
  if (!d) throw notFound('Plato');
  return ok({ dish: dishView(d) });
});
route('POST', `${ORG}/dishes`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const b = parse(S.dishBody, req.body);
  const now = Date.now();
  const d = {
    id: uuid(),
    orgId: c.org.id,
    name: b.name,
    category: b.category,
    description: b.description,
    allergens: b.allergens,
    allergensReviewed: b.allergensReviewed,
    allergensReviewedAt: b.allergensReviewed ? now : null,
    visible: b.visible,
    createdAt: now,
    updatedAt: now,
  };
  db.dishes.push(d);
  return ok({ dish: dishView(d) }, 201);
});
route('PATCH', `${ORG}/dishes/:dishId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.dishId, 'Plato');
  const b = parse(S.updateDishBody, req.body);
  const d = db.dishes.find((x) => x.id === id && x.orgId === c.org.id);
  if (!d) throw notFound('Plato');
  const now = Date.now();
  if (b.name !== undefined) d.name = b.name;
  if (b.category !== undefined) d.category = b.category;
  if (b.description !== undefined) d.description = b.description;
  if (b.allergens !== undefined) d.allergens = b.allergens;
  if (b.visible !== undefined) d.visible = b.visible;
  if (b.allergensReviewed !== undefined) {
    d.allergensReviewed = b.allergensReviewed;
    d.allergensReviewedAt = b.allergensReviewed ? now : null;
  }
  d.updatedAt = now;
  return ok({ dish: dishView(d) });
});
route('DELETE', `${ORG}/dishes/:dishId`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  const id = idParam(req.params.dishId, 'Plato');
  if (!db.dishes.some((x) => x.id === id && x.orgId === c.org.id)) throw notFound('Plato');
  db.dishes = db.dishes.filter((x) => x.id !== id);
  return noContent();
});
route('GET', `${ORG}/public-menu`, (db, req) => ok({ publicMenu: menuView(orgCtx(db, req).org) }));
route('PATCH', `${ORG}/public-menu`, (db, req) => {
  const b = parse(S.publicMenuSettingsBody, req.body);
  const c = b.enabled ? requireWritable(orgCtx(db, req)) : orgCtx(db, req);
  c.org.publicMenuEnabled = b.enabled;
  audit(db, c.org.id, 'public_menu.updated', c.user.id, { enabled: b.enabled });
  return ok({ publicMenu: menuView(c.org) });
});
route('POST', `${ORG}/public-menu/regenerate`, (db, req) => {
  const c = requireWritable(orgCtx(db, req));
  c.org.publicMenuSlug = newSlug();
  audit(db, c.org.id, 'public_menu.updated', c.user.id, { regenerated: true });
  return ok({ publicMenu: menuView(c.org) });
});
const PUBLIC_MENU_NOTICE =
  'Información sobre alérgenos facilitada por el establecimiento. Si tienes alguna alergia o intolerancia, consulta siempre al personal antes de pedir: aunque un plato no declare alérgenos, puede haber trazas por contaminación cruzada en la cocina.';
route('GET', '/api/public/menu/:slug', (db, req) => {
  const slug = req.params.slug ?? '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) throw notFound('Carta');
  const org = db.orgs.find((o) => o.publicMenuSlug === slug && o.publicMenuEnabled);
  if (!org || !isWritable(org)) throw notFound('Carta');
  const dishes = db.dishes
    .filter((d) => d.orgId === org.id && d.visible && d.allergensReviewed)
    .sort((a, b) => S.compareMenuCategories(a.category, b.category) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const updatedAt = dishes.reduce<number | null>((acc, d) => (acc == null || d.updatedAt > acc ? d.updatedAt : acc), null);
  const body: PublicMenu = {
    organization: { name: org.name },
    allergens: S.ALLERGENS.map((id) => ({ id, label: S.ALLERGEN_LABELS[id], name: S.ALLERGEN_NAMES[id] })),
    statuses: S.ALLERGEN_STATUS_LABELS,
    dishes: dishes.map((d) => ({ name: d.name, category: d.category, description: d.description, allergens: d.allergens })),
    updatedAt: updatedAt ? iso(updatedAt) : null,
    notice: PUBLIC_MENU_NOTICE,
  };
  return { status: 200, json: body, headers: { 'X-Robots-Tag': 'noindex, nofollow' } };
});

// --- Tareas e informes --------------------------------------------------------------------
route('GET', `${ORG}/tasks/today`, (db, req) => ok(computeToday(db, orgCtx(db, req).org)));
route('GET', `${ORG}/tasks/compliance`, (db, req) => {
  const c = orgCtx(db, req);
  const q = parse(S.dateRangeQuery, Object.fromEntries(req.query));
  if (diffDays(q.from, q.to) + 1 > 92) throw badRequest('El periodo máximo es de 92 días');
  return ok(computeCompliance(db, c.org, q.from, q.to));
});
route('GET', `${ORG}/reports/csv`, (db, req) => {
  const c = orgCtx(db, req);
  const q = parseReportQuery(req.query);
  audit(db, c.org.id, 'report.generated', c.user.id, { format: 'csv', from: q.from, to: q.to, types: q.types });
  const { filename, text } = buildCsv(db, c.org, q.from, q.to, q.types);
  return { status: 200, text, contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${filename}"` } };
});
route('GET', `${ORG}/reports/pdf`, (db, req) => {
  const c = orgCtx(db, req);
  parseReportQuery(req.query);
  // El PDF real lo maqueta el servidor: la demo entrega un PDF de ejemplo (ver DemoDownload).
  throw new DemoError(503, 'INTERNAL_ERROR', `En la demo, el PDF de ${c.org.name} se sustituye por un PDF de ejemplo con los datos iniciales.`);
});

// --- Facturación (Stripe no existe en la demo) -------------------------------------------
const PRICES = { monthly: { amount: 12, currency: 'EUR', interval: 'month' }, annual: { amount: 120, currency: 'EUR', interval: 'year' } };
route('GET', `${ORG}/billing`, (db, req) => {
  const c = orgCtx(db, req);
  return ok({ billingEnabled: false, prices: PRICES, subscription: subscriptionView(c.org) });
});
for (const kind of ['checkout', 'portal']) {
  route('POST', `${ORG}/billing/${kind}`, (db, req) => {
    requireOwner(orgCtx(db, req));
    throw new DemoError(503, 'BILLING_NOT_CONFIGURED', 'Los pagos no están disponibles en la demo.');
  });
}

// --- Modo cocina ------------------------------------------------------------------------------
route('GET', '/api/kiosk/context', (db, req) => {
  const { device, org } = deviceCtx(db, req);
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'es');
  return ok({
    device: { id: device.id, name: device.name },
    organization: { id: org.id, name: org.name, timezone: org.timezone, readOnly: !isWritable(org) },
    staff: db.staff
      .filter((s) => s.orgId === org.id && s.active)
      .sort(byName)
      .map((s) => ({ id: s.id, name: s.name, hasPin: s.pin != null })),
    equipment: db.equipment
      .filter((e) => e.orgId === org.id && e.active)
      .sort(byCreated)
      .map((e) => ({ id: e.id, name: e.name, type: e.type, minTemp: e.minTemp, maxTemp: e.maxTemp, checksPerDay: e.checksPerDay })),
    cleaningPlans: db.plans
      .filter((p) => p.orgId === org.id && p.active)
      .sort(byCreated)
      .map((p) => ({ id: p.id, name: p.name, frequency: p.frequency, weekday: p.weekday, monthDay: p.monthDay, items: p.items })),
    suppliers: db.suppliers
      .filter((s) => s.orgId === org.id)
      .sort(byName)
      .map((s) => ({ id: s.id, name: s.name, products: s.products })),
  });
});
route('GET', '/api/kiosk/tasks/today', (db, req) => ok(computeToday(db, deviceCtx(db, req).org)));
route('POST', '/api/kiosk/verify-pin', (db, req) => {
  const ctx = deviceCtx(db, req);
  const b = parse(S.kioskVerifyPinBody, req.body);
  const staff = kioskStaff(db, ctx.org, b.staffId);
  if (staff.pin) {
    if (!b.pin) throw new DemoError(401, 'PIN_REQUIRED', 'Introduce tu PIN');
    verifyPin(db, ctx, staff.id, b.pin);
  }
  return ok({ staff: { id: staff.id, name: staff.name, hasPin: staff.pin != null } });
});
route('POST', '/api/kiosk/records', (db, req) => {
  const ctx = deviceCtx(db, req);
  if (!isWritable(ctx.org)) throw readOnly();
  const b = parse(S.kioskRecordBody, req.body);
  const staff = kioskStaff(db, ctx.org, b.staffId);
  if (staff.pin) {
    if (!b.pin) throw new DemoError(401, 'PIN_REQUIRED', 'Introduce tu PIN');
    verifyPin(db, ctx, staff.id, b.pin);
  }
  const { pin: _pin, ...payload } = b;
  return withIdempotency(db, req, ctx.org.id, 'kiosk', payload, () =>
    createRecord(db, ctx.org, { userId: null, userName: null, staffId: staff.id, deviceId: ctx.device.id }, b.type, b.data),
  );
});

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------
const compiled = table.map(([method, path, h]) => {
  const names: string[] = [];
  const re = new RegExp(`^${path.replace(/:[A-Za-z]+/g, (m) => (names.push(m.slice(1)), '([^/]+)'))}$`);
  return { method, re, names, h };
});

export function resolve(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
  let pathMatched = false;
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params: Record<string, string> = {};
    r.names.forEach((n, i) => {
      try {
        params[n] = decodeURIComponent(m[i + 1]!);
      } catch {
        params[n] = '';
      }
    });
    return { handler: r.h, params };
  }
  return pathMatched ? 'method' : null;
}
