import type { MailMessage } from './mailer.js';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const ZWSP = '\u200B';
export const USER_TEXT_MAX = 60;

/**
 * Texto libre de un usuario (nombre del local, de quien invita…) dentro de un email:
 * sin caracteres de control ni saltos de línea, acotado en longitud, entre comillas «»
 * y con un espacio de anchura cero tras `.`, `:`, `/` y `@` para que los clientes de
 * correo no lo conviertan en un enlace. El escape HTML lo hace `layout`.
 * Nunca debe usarse en el asunto (el asunto solo lleva APP_NAME y texto fijo).
 */
export function userText(value: string, max = USER_TEXT_MAX): string {
  let v = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- se eliminan caracteres de control a propósito
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if ([...v].length > max) v = `${[...v].slice(0, max - 1).join('').trimEnd()}…`;
  return `«${v.replace(/([.:/@])/g, `$1${ZWSP}`)}»`;
}

/** n***@dominio para avisos al email antiguo. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export interface Ctx {
  appName: string;
  appOrigin: string;
  /** Email de soporte (opcional): si está configurado, cada email lo indica al final. */
  supportEmail?: string | null;
}

/** Contexto de los emails a partir de la configuración del servidor. */
export const mailCtxFrom = (config: { appName: string; appOrigin: string; supportEmail: string | null }): Ctx => ({
  appName: config.appName,
  appOrigin: config.appOrigin,
  supportEmail: config.supportEmail,
});

function layout(ctx: Ctx, to: string, subject: string, paragraphs: string[], link?: { url: string; label: string }): MailMessage {
  const support = ctx.supportEmail ? `¿Necesitas ayuda? Escríbenos a ${ctx.supportEmail}.` : null;
  const text = [
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
    '',
    `— ${ctx.appName}`,
    'Si no esperabas este mensaje, puedes ignorarlo.',
    ...(support ? [support] : []),
  ].join('\n\n');
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#1f2933;max-width:560px;margin:auto;padding:16px">
<h2 style="color:#0f766e">${escapeHtml(ctx.appName)}</h2>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${link ? `<p><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p><p style="font-size:12px;color:#52606d">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(link.url)}</p>` : ''}
<p style="font-size:12px;color:#52606d">Si no esperabas este mensaje, puedes ignorarlo.</p>
${ctx.supportEmail ? `<p style="font-size:12px;color:#52606d">¿Necesitas ayuda? Escríbenos a <a href="mailto:${escapeHtml(ctx.supportEmail)}">${escapeHtml(ctx.supportEmail)}</a>.</p>` : ''}
</body></html>`;
  return { to, subject: `${subject} · ${ctx.appName}`, text, html };
}

// Los tokens se envían en el fragmento (#) de la URL: no llegan a los logs del servidor ni a cabeceras Referer.
const linkWithToken = (ctx: Ctx, path: string, token: string) => `${ctx.appOrigin}${path}#token=${token}`;

export const emails = {
  // Saludo neutro: el nombre lo escribe quien se registra (podría no ser el dueño del email).
  verifyEmail: (ctx: Ctx, to: string, token: string, opts: { pendingAccount?: boolean } = {}) =>
    layout(
      ctx,
      to,
      'Confirma tu email',
      [
        'Hola:',
        `Confirma tu dirección de email para activar tu cuenta en ${ctx.appName}. El enlace caduca en 24 horas.`,
        ...(opts.pendingAccount
          ? [
              'Ya había un registro pendiente de confirmar con este email; se mantiene la contraseña elegida en ese primer registro.',
              `Si no lo creaste tú o no recuerdas esa contraseña, no lo confirmes: restablece la contraseña en ${ctx.appOrigin}/recuperar-contrasena`,
            ]
          : []),
      ],
      { url: linkWithToken(ctx, '/verificar-email', token), label: 'Confirmar email' },
    ),
  alreadyRegistered: (ctx: Ctx, to: string) =>
    layout(ctx, to, 'Intento de registro', [
      `Alguien (probablemente tú) ha intentado crear una cuenta en ${ctx.appName} con este email, pero ya existe una cuenta.`,
      'Si has olvidado tu contraseña, puedes restablecerla desde la pantalla de inicio de sesión.',
    ], { url: `${ctx.appOrigin}/recuperar-contrasena`, label: 'Recuperar contraseña' }),
  passwordReset: (ctx: Ctx, to: string, token: string) =>
    layout(ctx, to, 'Restablecer contraseña', [
      'Hemos recibido una solicitud para restablecer tu contraseña. El enlace caduca en 1 hora y solo puede usarse una vez.',
    ], { url: linkWithToken(ctx, '/restablecer-contrasena', token), label: 'Elegir nueva contraseña' }),
  passwordChanged: (ctx: Ctx, to: string) =>
    layout(ctx, to, 'Tu contraseña ha cambiado', [
      'La contraseña de tu cuenta se ha cambiado, se han cerrado las demás sesiones y se han anulado los enlaces pendientes (cambio de email, restablecimiento…).',
      `Si no has sido tú, restablece tu contraseña inmediatamente${ctx.supportEmail ? ` y escríbenos a ${ctx.supportEmail}` : ''}.`,
    ]),
  emailChange: (ctx: Ctx, to: string, token: string) =>
    layout(ctx, to, 'Confirma tu nuevo email', ['Confirma este email como nueva dirección de tu cuenta. El enlace caduca en 24 horas.'], {
      url: linkWithToken(ctx, '/confirmar-email', token),
      label: 'Confirmar nuevo email',
    }),
  /** Aviso al email ANTIGUO cuando se solicita el cambio. */
  emailChangeRequested: (ctx: Ctx, to: string, newEmail: string) =>
    layout(ctx, to, 'Solicitud de cambio de email', [
      `Se ha solicitado cambiar el email de tu cuenta a ${userText(maskEmail(newEmail), 254)}. El cambio solo se hará si se confirma desde ese nuevo email.`,
      'Si no has sido tú, cambia la contraseña inmediatamente: al hacerlo se anula la solicitud y se cierran las demás sesiones.',
    ], { url: `${ctx.appOrigin}/recuperar-contrasena`, label: 'Cambiar la contraseña' }),
  /** Aviso al email ANTIGUO cuando el cambio se confirma. */
  emailChangedNotice: (ctx: Ctx, to: string, newEmail: string) =>
    layout(ctx, to, 'Tu email ha cambiado', [
      `El email de tu cuenta se ha cambiado a ${userText(newEmail, 254)}.`,
      ctx.supportEmail ? `Si no has sido tú, escríbenos inmediatamente a ${ctx.supportEmail}.` : 'Si no has sido tú, restablece tu contraseña inmediatamente.',
    ]),
  // Asunto fijo: el nombre del local y el de quien invita son texto libre y solo van, acotados, en el cuerpo.
  invitation: (ctx: Ctx, to: string, orgName: string, inviterName: string, role: string, token: string) =>
    layout(ctx, to, 'Invitación para colaborar en un local', [
      `${userText(inviterName)} te ha invitado a colaborar en el local ${userText(orgName)} en ${ctx.appName} con el rol de ${role === 'owner' ? 'propietario' : 'encargado'}.`,
      'La invitación caduca en 7 días. Si no tienes cuenta, podrás crearla con este mismo email. Si no conoces a quien te invita, ignora este mensaje.',
    ], { url: linkWithToken(ctx, '/invitacion', token), label: 'Ver la invitación' }),
  dailyReminder: (ctx: Ctx, to: string, orgName: string, pending: string[]) =>
    layout(ctx, to, 'Registros pendientes hoy', [
      `Quedan registros pendientes hoy en el local ${userText(orgName)}:`,
      ...pending.slice(0, 20).map((p) => `• ${p}`),
      ...(pending.length > 20 ? [`… y ${pending.length - 20} más.`] : []),
      'Puedes desactivar este recordatorio en los ajustes del local.',
    ], { url: `${ctx.appOrigin}/`, label: 'Abrir tareas de hoy' }),
  /** Aviso de fin de prueba (3 días antes). Sin presión: informa y enlaza a facturación. */
  trialEndingSoon: (ctx: Ctx, to: string, orgName: string, orgId: string, endsOn: string, daysLeft: number) =>
    layout(ctx, to, 'Tu prueba gratuita termina pronto', [
      `La prueba gratuita del local ${userText(orgName)} termina el ${endsOn} (${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`}).`,
      'Si quieres seguir registrando después de esa fecha, puedes elegir un plan (mensual o anual) en la sección de facturación del local. Si no haces nada, no se te cobrará: el local pasará a solo lectura y podrás seguir consultando y descargando tus registros e informes.',
    ], { url: `${ctx.appOrigin}/locales/${orgId}/facturacion`, label: 'Ver facturación' }),
  /** Aviso el día en que caduca la prueba. */
  trialEndsToday: (ctx: Ctx, to: string, orgName: string, orgId: string, ended: boolean) =>
    layout(ctx, to, ended ? 'Tu prueba gratuita ha terminado' : 'Tu prueba gratuita termina hoy', [
      ended
        ? `La prueba gratuita del local ${userText(orgName)} ha terminado hoy. El local está en solo lectura: tus registros, informes y la exportación siguen disponibles.`
        : `La prueba gratuita del local ${userText(orgName)} termina hoy. A partir de entonces el local quedará en solo lectura: tus registros, informes y la exportación seguirán disponibles.`,
      'Para seguir registrando, elige un plan en la sección de facturación del local cuando te venga bien. No se te cobra nada sin que lo contrates.',
    ], { url: `${ctx.appOrigin}/locales/${orgId}/facturacion`, label: 'Ver facturación' }),
  /** Confirmación de eliminación programada de un local. */
  orgDeletionScheduled: (ctx: Ctx, to: string, orgName: string, orgId: string, deleteOn: string) =>
    layout(ctx, to, 'Local programado para eliminación', [
      `Se ha solicitado eliminar el local ${userText(orgName)}. Quedará eliminado definitivamente, con todos sus registros, el ${deleteOn}.`,
      'Hasta entonces el local está en solo lectura: puedes consultar y exportar sus datos e informes, y un propietario puede restaurarlo desde los ajustes del local. Si no lo pediste tú, restáuralo y revisa quién tiene acceso.',
    ], { url: `${ctx.appOrigin}/locales/${orgId}/ajustes/datos`, label: 'Ver el local' }),
  accountDeleted: (ctx: Ctx, to: string) =>
    layout(ctx, to, 'Cuenta eliminada', [`Tu cuenta de ${ctx.appName} se ha eliminado.`]),
};
