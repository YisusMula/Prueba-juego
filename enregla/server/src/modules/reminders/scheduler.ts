import { sql } from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '../../http/context.js';
import { emails, mailCtxFrom } from '../../lib/emails.js';
import { diffDays, formatDateEs, localDate } from '../../lib/dates.js';
import { enqueueEmail, processOutbox, purgeOutbox } from '../../lib/outbox.js';
import { audit } from '../../lib/audit.js';
import { IDEMPOTENCY_RETENTION_DAYS } from '../records/idempotency.js';
import { isWritable } from '../billing/status.js';
import { stopOrgBilling } from '../billing/teardown.js';
import { computeToday, pendingLabels } from '../tasks/service.js';

const REMINDER_LOCK_KEY = 72_017_002;
const TRIAL_NOTICE_LOCK_KEY = 72_017_004;

export interface TickResult {
  ran: boolean;
  organizationsChecked: number;
  /** Emails encolados en la bandeja de salida. */
  emailsQueued: number;
  /** De ellos, enviados en el primer intento (el resto se reintenta). */
  emailsSent: number;
}

const mailCtx = (deps: AppDeps) => mailCtxFrom(deps.config);

/** Primer intento de envío, fuera de cualquier transacción. Nunca lanza por fallos de SMTP. */
async function deliverQueued(deps: AppDeps, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await processOutbox(deps.db, deps.mailer, { ids, limit: ids.length });
  return r.sent;
}

/**
 * Una pasada del recordatorio diario. Segura con varias instancias: solo la que obtiene
 * el advisory lock (de transacción) trabaja; `last_reminder_on` evita envíos duplicados.
 * Se envía una vez al día, en cuanto la hora local alcanza `reminder_hour`.
 * Los emails se ENCOLAN en la misma transacción que marca `last_reminder_on` (o se marcan
 * ambas cosas o ninguna) y se envían después, sin SMTP dentro de la transacción del lock;
 * si el SMTP falla, la bandeja de salida los reintenta.
 */
export async function runReminderTick(deps: AppDeps, now = deps.now()): Promise<TickResult> {
  const queued: string[] = [];
  const res = await deps.db.transaction().execute(async (trx) => {
    const lock = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${REMINDER_LOCK_KEY}) AS ok`.execute(trx);
    if (!lock.rows[0]?.ok) return { ran: false, organizationsChecked: 0 };

    const nowTs = now.toISOString();
    const orgs = await trx
      .selectFrom('organizations')
      .selectAll()
      .where('reminder_enabled', '=', true)
      .where('deletion_scheduled_at', 'is', null)
      .where(sql<boolean>`extract(hour from (${nowTs}::timestamptz AT TIME ZONE timezone)) >= reminder_hour`)
      .where(sql<boolean>`(last_reminder_on IS NULL OR last_reminder_on < (${nowTs}::timestamptz AT TIME ZONE timezone)::date)`)
      .limit(500)
      .execute();

    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      await trx.updateTable('organizations').set({ last_reminder_on: today }).where('id', '=', org.id).execute();
      if (!isWritable(org, now)) continue;
      const tasks = await computeToday(trx, org, now);
      const pending = pendingLabels(tasks);
      if (pending.length === 0) continue;
      const recipients = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.email'])
        .where('m.organization_id', '=', org.id)
        .where('m.daily_reminder', '=', true)
        .where('u.email_verified_at', 'is not', null)
        .execute();
      for (const r of recipients) queued.push(await enqueueEmail(trx, emails.dailyReminder(mailCtx(deps), r.email, org.name, pending)));
    }
    return { ran: true, organizationsChecked: orgs.length };
  });
  const sent = await deliverQueued(deps, queued);
  return { ...res, emailsQueued: queued.length, emailsSent: sent };
}

export interface TrialNoticeResult {
  ran: boolean;
  soon: number;
  ended: number;
  emailsQueued: number;
}

/**
 * Avisos de fin de prueba a los propietarios: 3 días antes y el día que caduca, una sola vez cada
 * uno por local (marcas en organizations). Solo locales en prueba local (sin suscripción de
 * Stripe), no pendientes de eliminación, y a partir de las 9:00 hora local.
 */
export async function runTrialNotices(deps: AppDeps, now = deps.now()): Promise<TrialNoticeResult> {
  const queued: string[] = [];
  const res = await deps.db.transaction().execute(async (trx) => {
    const lock = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${TRIAL_NOTICE_LOCK_KEY}) AS ok`.execute(trx);
    if (!lock.rows[0]?.ok) return { ran: false, soon: 0, ended: 0 };
    const nowTs = now.toISOString();
    const localToday = sql`(${nowTs}::timestamptz AT TIME ZONE timezone)::date`;
    const localEnd = sql`(trial_ends_at AT TIME ZONE timezone)::date`;
    const orgs = await trx
      .selectFrom('organizations')
      .selectAll()
      .where('subscription_status', '=', 'trialing')
      .where('stripe_subscription_id', 'is', null)
      .where('deletion_scheduled_at', 'is', null)
      .where(sql<boolean>`extract(hour from (${nowTs}::timestamptz AT TIME ZONE timezone)) >= 9`)
      .where(
        sql<boolean>`(
          (trial_notice_soon_sent_at IS NULL AND trial_ends_at > ${nowTs}::timestamptz
            AND trial_ends_at <= ${nowTs}::timestamptz + interval '3 days' AND ${localToday} < ${localEnd})
          OR (trial_notice_end_sent_at IS NULL AND ${localToday} >= ${localEnd}
            AND trial_ends_at > ${nowTs}::timestamptz - interval '2 days')
        )`,
      )
      .limit(500)
      .forUpdate()
      .skipLocked()
      .execute();
    let soon = 0;
    let ended = 0;
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      const endDay = localDate(org.trial_ends_at, org.timezone);
      const isEndDay = today >= endDay;
      const owners = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.email'])
        .where('m.organization_id', '=', org.id)
        .where('m.role', '=', 'owner')
        .where('u.email_verified_at', 'is not', null)
        .execute();
      for (const o of owners) {
        const msg = isEndDay
          ? emails.trialEndsToday(mailCtx(deps), o.email, org.name, org.id, org.trial_ends_at.getTime() <= now.getTime())
          : emails.trialEndingSoon(mailCtx(deps), o.email, org.name, org.id, formatDateEs(endDay), Math.max(1, diffDays(today, endDay)));
        queued.push(await enqueueEmail(trx, msg));
      }
      await trx
        .updateTable('organizations')
        .set(isEndDay ? { trial_notice_end_sent_at: now, trial_notice_soon_sent_at: org.trial_notice_soon_sent_at ?? now } : { trial_notice_soon_sent_at: now })
        .where('id', '=', org.id)
        .execute();
      if (isEndDay) ended += 1;
      else soon += 1;
    }
    return { ran: true, soon, ended };
  });
  await deliverQueued(deps, queued);
  return { ...res, emailsQueued: queued.length };
}

/** Limpieza periódica de datos caducados. */
export async function runCleanup(deps: AppDeps): Promise<void> {
  await deps.rateLimiter.cleanup();
  await sql`DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(secs => ${Math.floor(deps.config.sessionIdleMs / 1000)})`.execute(deps.db);
  await sql`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`.execute(deps.db);
  await purgeOutbox(deps.db);
}

const RETENTION_LOCK_KEY = 72_017_003;
const RETENTION_JOB = 'retention';

export interface RetentionResult {
  ran: boolean;
  auditEvents: number;
  unverifiedUsers: number;
  sessions: number;
  emailTokens: number;
  invitations: number;
  rateLimits: number;
  /** Locales pendientes de eliminación cuyo plazo ha vencido (purgados definitivamente). */
  organizations: number;
  /** Locales vencidos que NO se han purgado porque no se pudo cancelar su facturación en Stripe (se reintenta al día siguiente). */
  organizationsDeferred: number;
  idempotencyKeys: number;
  emailOutbox: number;
}

/**
 * Purga diaria de datos personales y técnicos caducados. Segura con varias instancias:
 * advisory lock de transacción + marca `job_runs` para ejecutarse como mucho una vez cada
 * 24 h entre todas las instancias. Plazos (README): auditoría > AUDIT_RETENTION_MONTHS
 * (12), cuentas sin verificar > UNVERIFIED_ACCOUNT_DAYS (7), sesiones caducadas, tokens
 * de email caducados o usados hace > 7 días, invitaciones caducadas/revocadas hace > 30 días
 * y filas de rate limit vencidas.
 */
export async function runRetention(deps: AppDeps, opts: { force?: boolean; log?: Pick<FastifyBaseLogger, 'warn' | 'error'> } = {}): Promise<RetentionResult> {
  const none: RetentionResult = {
    ran: false,
    auditEvents: 0,
    unverifiedUsers: 0,
    sessions: 0,
    emailTokens: 0,
    invitations: 0,
    rateLimits: 0,
    organizations: 0,
    organizationsDeferred: 0,
    idempotencyKeys: 0,
    emailOutbox: 0,
  };
  const { auditMonths, unverifiedAccountDays } = deps.config.retention;
  return deps.db.transaction().execute(async (trx) => {
    const lock = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) AS ok`.execute(trx);
    if (!lock.rows[0]?.ok) return none;
    const last = await trx.selectFrom('job_runs').select('last_run_at').where('name', '=', RETENTION_JOB).executeTakeFirst();
    if (!opts.force && last && Date.now() - last.last_run_at.getTime() < 24 * 3600 * 1000) return none;

    const n = (r: { numDeletedRows: bigint }[] | { numDeletedRows: bigint }) => Number((Array.isArray(r) ? r[0]! : r).numDeletedRows);
    const auditEvents = n(await trx.deleteFrom('audit_events').where('created_at', '<', sql<Date>`now() - make_interval(months => ${auditMonths})`).execute());
    const unverifiedUsers = n(
      await trx
        .deleteFrom('users')
        .where('email_verified_at', 'is', null)
        .where('created_at', '<', sql<Date>`now() - make_interval(days => ${unverifiedAccountDays})`)
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('memberships as m').select('m.user_id').whereRef('m.user_id', '=', 'users.id'))))
        .execute(),
    );
    const sessions = n(
      await trx
        .deleteFrom('sessions')
        .where((eb) =>
          eb.or([
            eb('expires_at', '<', sql<Date>`now()`),
            eb('last_seen_at', '<', sql<Date>`now() - make_interval(secs => ${Math.floor(deps.config.sessionIdleMs / 1000)})`),
          ]),
        )
        .execute(),
    );
    const emailTokens = n(
      await trx
        .deleteFrom('email_tokens')
        .where((eb) => eb.or([eb('expires_at', '<', sql<Date>`now() - interval '7 days'`), eb('used_at', '<', sql<Date>`now() - interval '7 days'`)]))
        .execute(),
    );
    const invitations = n(
      await trx
        .deleteFrom('invitations')
        .where('accepted_at', 'is', null)
        .where((eb) => eb.or([eb('expires_at', '<', sql<Date>`now() - interval '30 days'`), eb('revoked_at', '<', sql<Date>`now() - interval '30 days'`)]))
        .execute(),
    );
    const rateLimits = n(await trx.deleteFrom('rate_limits').where('reset_at', '<', sql<Date>`now() - interval '1 hour'`).execute());
    // Borrado diferido: los locales cuyo plazo de 30 días ha vencido se eliminan con todos sus datos.
    // I-6: también los pendientes que se han quedado SIN NINGÚN miembro (p. ej. el único owner borró su
    // cuenta y no había más miembros): nadie puede verlos ni restaurarlos, así que no se conservan más.
    // Un pendiente sin owner pero con encargados se conserva hasta su fecha (pueden exportar sus datos).
    // Las filas se bloquean (FOR UPDATE): una restauración simultánea espera y, si llega tarde, recibe 404.
    const due = await trx
      .selectFrom('organizations as o')
      .select(['o.id', 'o.name', 'o.stripe_subscription_id', 'o.subscription_status', 'o.stripe_checkout_session_id'])
      .where('o.deletion_scheduled_at', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('o.deletion_scheduled_at', '<=', sql<Date>`now()`),
          eb.not(eb.exists(eb.selectFrom('memberships as m').select('m.user_id').whereRef('m.organization_id', '=', 'o.id'))),
        ]),
      )
      .orderBy('o.deletion_scheduled_at')
      .limit(200)
      .forUpdate()
      .execute();
    const purged: { id: string; name: string }[] = [];
    let organizationsDeferred = 0;
    for (const o of due) {
      // M-1 (a): antes de borrar, nada en Stripe puede seguir cobrando. Si no se puede asegurar,
      // NO se borra: queda en el log y se reintenta en la purga del día siguiente.
      try {
        const stopped = await stopOrgBilling(deps.billing, o);
        if (stopped.subscriptionCanceled) {
          await audit(trx, { event: 'billing.subscription_canceled', organizationId: o.id, metadata: { reason: 'org_purged', subscriptionId: stopped.subscriptionCanceled } });
        }
      } catch (err) {
        organizationsDeferred += 1;
        opts.log?.error({ err: (err as Error).message, organizationId: o.id }, 'Purga de local aplazada: no se pudo cancelar su facturación en Stripe (se reintentará mañana)');
        continue;
      }
      const del = await trx.deleteFrom('organizations').where('id', '=', o.id).where('deletion_scheduled_at', 'is not', null).executeTakeFirst();
      if (Number(del.numDeletedRows) === 0) continue;
      purged.push(o);
      await audit(trx, { event: 'org.deleted', organizationId: o.id, metadata: { name: o.name, reason: 'scheduled_deletion' } });
    }
    const idempotencyKeys = n(
      await trx.deleteFrom('idempotency_keys').where('created_at', '<', sql<Date>`now() - make_interval(days => ${IDEMPOTENCY_RETENTION_DAYS})`).execute(),
    );
    const emailOutbox = await purgeOutbox(trx);

    await trx
      .insertInto('job_runs')
      .values({ name: RETENTION_JOB, last_run_at: sql<Date>`now()` })
      .onConflict((oc) => oc.column('name').doUpdateSet({ last_run_at: sql<Date>`now()` }))
      .execute();
    return { ran: true, auditEvents, unverifiedUsers, sessions, emailTokens, invitations, rateLimits, organizations: purged.length, organizationsDeferred, idempotencyKeys, emailOutbox };
  });
}

export function startScheduler(deps: AppDeps, log: FastifyBaseLogger): () => void {
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runReminderTick(deps);
      if (r.emailsQueued > 0) log.info({ emailsQueued: r.emailsQueued, emailsSent: r.emailsSent }, 'Recordatorios diarios encolados');
      const t = await runTrialNotices(deps);
      if (t.emailsQueued > 0) log.info(t, 'Avisos de fin de prueba encolados');
      if (ticks++ % 60 === 0) await runCleanup(deps);
      const ret = await runRetention(deps, { log });
      if (ret.ran) log.info(ret, 'Purga diaria de datos caducados');
    } catch (err) {
      log.error({ err }, 'Error en la tarea programada');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), deps.config.scheduler.intervalSeconds * 1000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

/**
 * Worker de la bandeja de salida: reintenta los emails pendientes cuyo próximo intento ha
 * vencido. Seguro con varias instancias (FOR UPDATE SKIP LOCKED + arrendamiento).
 */
export function startEmailWorker(deps: AppDeps, log: FastifyBaseLogger): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 10; i++) {
        const r = await processOutbox(deps.db, deps.mailer, {
          limit: 20,
          onError: (err) => log.warn({ err: (err as Error).message }, 'Fallo enviando email: se reintentará'),
        });
        if (r.failed > 0) log.error({ failed: r.failed }, 'Emails descartados tras agotar los reintentos');
        if (r.sent + r.retried + r.failed < 20) break;
      }
    } catch (err) {
      log.error({ err }, 'Error en el worker de emails');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), deps.config.mail.worker.intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
