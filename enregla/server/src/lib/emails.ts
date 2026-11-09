import type { MailMessage } from './mailer.js';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface Ctx {
  appName: string;
  appOrigin: string;
}

function layout(ctx: Ctx, to: string, subject: string, paragraphs: string[], link?: { url: string; label: string }): MailMessage {
  const text = [
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
    '',
    `— ${ctx.appName}`,
    'Si no esperabas este mensaje, puedes ignorarlo.',
  ].join('\n\n');
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#1f2933;max-width:560px;margin:auto;padding:16px">
<h2 style="color:#0f766e">${escapeHtml(ctx.appName)}</h2>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${link ? `<p><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p><p style="font-size:12px;color:#52606d">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(link.url)}</p>` : ''}
<p style="font-size:12px;color:#52606d">Si no esperabas este mensaje, puedes ignorarlo.</p>
</body></html>`;
  return { to, subject: `${subject} · ${ctx.appName}`, text, html };
}

// Los tokens se envían en el fragmento (#) de la URL: no llegan a los logs del servidor ni a cabeceras Referer.
const linkWithToken = (ctx: Ctx, path: string, token: string) => `${ctx.appOrigin}${path}#token=${token}`;

export const emails = {
  verifyEmail: (ctx: Ctx, to: string, name: string, token: string) =>
    layout(ctx, to, 'Confirma tu email', [`Hola ${name}:`, `Confirma tu dirección de email para activar tu cuenta en ${ctx.appName}. El enlace caduca en 24 horas.`], {
      url: linkWithToken(ctx, '/verificar-email', token),
      label: 'Confirmar email',
    }),
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
      'La contraseña de tu cuenta se ha cambiado y se han cerrado las demás sesiones.',
      'Si no has sido tú, restablece tu contraseña inmediatamente y contacta con soporte.',
    ]),
  emailChange: (ctx: Ctx, to: string, token: string) =>
    layout(ctx, to, 'Confirma tu nuevo email', ['Confirma este email como nueva dirección de tu cuenta. El enlace caduca en 24 horas.'], {
      url: linkWithToken(ctx, '/confirmar-email', token),
      label: 'Confirmar nuevo email',
    }),
  emailChangedNotice: (ctx: Ctx, to: string, newEmail: string) =>
    layout(ctx, to, 'Tu email ha cambiado', [
      `El email de tu cuenta se ha cambiado a ${newEmail}.`,
      'Si no has sido tú, contacta con soporte inmediatamente.',
    ]),
  invitation: (ctx: Ctx, to: string, orgName: string, inviterName: string, role: string, token: string) =>
    layout(ctx, to, `Invitación a ${orgName}`, [
      `${inviterName} te ha invitado a colaborar en «${orgName}» en ${ctx.appName} con el rol de ${role === 'owner' ? 'propietario' : 'encargado'}.`,
      'La invitación caduca en 7 días. Si no tienes cuenta, podrás crearla con este mismo email.',
    ], { url: linkWithToken(ctx, '/invitacion', token), label: 'Aceptar invitación' }),
  dailyReminder: (ctx: Ctx, to: string, orgName: string, pending: string[]) =>
    layout(ctx, to, `Registros pendientes hoy en ${orgName}`, [
      `Quedan registros pendientes hoy en «${orgName}»:`,
      ...pending.slice(0, 20).map((p) => `• ${p}`),
      ...(pending.length > 20 ? [`… y ${pending.length - 20} más.`] : []),
      'Puedes desactivar este recordatorio en los ajustes del local.',
    ], { url: `${ctx.appOrigin}/`, label: 'Abrir tareas de hoy' }),
  accountDeleted: (ctx: Ctx, to: string) =>
    layout(ctx, to, 'Cuenta eliminada', [`Tu cuenta de ${ctx.appName} se ha eliminado.`]),
};
