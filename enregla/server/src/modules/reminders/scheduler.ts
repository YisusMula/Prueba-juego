import { sql } from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '../../http/context.js';
import { emails } from '../../lib/emails.js';
import { localDate } from '../../lib/dates.js';
import { isWritable } from '../billing/status.js';
import { computeToday, pendingLabels } from '../tasks/service.js';

const REMINDER_LOCK_KEY = 72_017_002;

export interface TickResult {
  ran: boolean;
  organizationsChecked: number;
  emailsSent: number;
}

/**
 * Una pasada del recordatorio diario. Segura con varias instancias: solo la que obtiene
 * el advisory lock (de transacción) trabaja; `last_reminder_on` evita envíos duplicados.
 * Se envía una vez al día, en cuanto la hora local alcanza `reminder_hour`.
 */
export async function runReminderTick(deps: AppDeps, now = new Date()): Promise<TickResult> {
  return deps.db.transaction().execute(async (trx) => {
    const lock = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${REMINDER_LOCK_KEY}) AS ok`.execute(trx);
    if (!lock.rows[0]?.ok) return { ran: false, organizationsChecked: 0, emailsSent: 0 };

    const nowTs = now.toISOString();
    const orgs = await trx
      .selectFrom('organizations')
      .selectAll()
      .where('reminder_enabled', '=', true)
      .where(sql<boolean>`extract(hour from (${nowTs}::timestamptz AT TIME ZONE timezone)) >= reminder_hour`)
      .where(sql<boolean>`(last_reminder_on IS NULL OR last_reminder_on < (${nowTs}::timestamptz AT TIME ZONE timezone)::date)`)
      .limit(500)
      .execute();

    let sent = 0;
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
      for (const r of recipients) {
        try {
          await deps.mailer.send(emails.dailyReminder({ appName: deps.config.appName, appOrigin: deps.config.appOrigin }, r.email, org.name, pending));
          sent += 1;
        } catch {
          // Un fallo de envío no debe impedir el resto; se registra en el log del llamador.
        }
      }
    }
    return { ran: true, organizationsChecked: orgs.length, emailsSent: sent };
  });
}

/** Limpieza periódica de datos caducados. */
export async function runCleanup(deps: AppDeps): Promise<void> {
  await deps.rateLimiter.cleanup();
  await sql`DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(secs => ${Math.floor(deps.config.sessionIdleMs / 1000)})`.execute(deps.db);
  await sql`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`.execute(deps.db);
}

export function startScheduler(deps: AppDeps, log: FastifyBaseLogger): () => void {
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runReminderTick(deps);
      if (r.emailsSent > 0) log.info({ emailsSent: r.emailsSent }, 'Recordatorios diarios enviados');
      if (ticks++ % 60 === 0) await runCleanup(deps);
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
