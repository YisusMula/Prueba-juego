import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PublicLayout } from '@/layouts/PublicLayout';
import { LEGAL, type LegalKey } from '@/config/legal';
import { APP_NAME, PRICING } from '@/config/brand';
import { useCanonical, useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLocation } from 'react-router';

/** Dato del titular: si no se ha configurado, se resalta como marcador pendiente. */
function L({ k }: { k: LegalKey }) {
  const { value, placeholder } = LEGAL[k];
  if (value) return <>{value}</>;
  return (
    <mark className="placeholder-mark" data-testid="legal-placeholder">
      [{placeholder}]
    </mark>
  );
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title);
  useCanonical(useLocation().pathname);
  return (
    <PublicLayout>
      <article className="prose-legal mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-4xl font-extrabold">{title}</h1>
        <p className="mt-2 text-ink-muted">
          Última actualización: <L k="lastUpdated" />
        </p>
        <div className="mt-6">{children}</div>
      </article>
    </PublicLayout>
  );
}

const jurisdiction = () => (LEGAL.jurisdiction.value ? <>los juzgados y tribunales de {LEGAL.jurisdiction.value}</> : <>los juzgados y tribunales que correspondan conforme a la ley</>);

export function LegalNoticePage() {
  return (
    <LegalShell title="Aviso legal">
      <h2>1. Datos identificativos</h2>
      <p>
        En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), se informa de que
        el sitio web y la aplicación {APP_NAME} son titularidad de <L k="ownerName" />, con NIF <L k="taxId" /> y domicilio en <L k="address" />.
        Correo electrónico de contacto: <L k="contactEmail" />.{LEGAL.registryData.value ? ` ${LEGAL.registryData.value}.` : null}
      </p>
      <h2>2. Objeto</h2>
      <p>
        {APP_NAME} es una herramienta en línea para ayudar a establecimientos de hostelería y alimentación a llevar sus registros de autocontrol
        de higiene alimentaria en formato digital. La herramienta no presta asesoramiento técnico, sanitario ni jurídico, y no sustituye al
        plan de autocontrol de cada establecimiento.
      </p>
      <h2>3. Condiciones de uso</h2>
      <p>
        El acceso al sitio implica la aceptación de este aviso legal. La contratación y el uso de la aplicación se rigen además por los{' '}
        <Link to="/terminos" className="underline">términos del servicio</Link>.
      </p>
      <h2>4. Propiedad intelectual</h2>
      <p>
        Los contenidos, el diseño, el código y los elementos gráficos de {APP_NAME} pertenecen a su titular o se usan con licencia. No se permite
        su reproducción sin autorización, salvo para el uso normal del servicio.
      </p>
      <h2>5. Responsabilidad</h2>
      <p>
        Las plantillas, rangos de temperatura y textos de ejemplo que ofrece la aplicación son orientativos. Cada usuario es responsable de
        revisarlos, adaptarlos a su plan de autocontrol y de la veracidad de los datos que registra. El titular no garantiza el resultado de
        inspecciones ni auditorías.
      </p>
      <h2>6. Legislación y jurisdicción</h2>
      <p>
        Este aviso se rige por la legislación española. Para cualquier controversia, y salvo que la normativa de consumidores disponga otra cosa,
        las partes se someten a {jurisdiction()}.
      </p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Política de privacidad">
      <h2>1. Responsable del tratamiento</h2>
      <p>
        <L k="ownerName" /> (NIF <L k="taxId" />), <L k="address" />. Contacto para privacidad: <L k="contactEmail" />.
      </p>
      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li>Cuenta: nombre, email y contraseña. La contraseña se guarda protegida mediante un hash irreversible: nadie, tampoco nosotros, puede leerla.</li>
        <li>Datos de los locales y de su actividad: equipos, planes de limpieza, proveedores, platos, y los registros que se anotan.</li>
        <li>Personal de cocina: nombre y, si se configura, un PIN (también protegido mediante un hash irreversible: no podemos leerlo).</li>
        <li>Facturación: los datos de pago los gestiona directamente el proveedor de pagos; nosotros no vemos ni guardamos la tarjeta.</li>
        <li>Datos técnicos y de seguridad: dirección IP, fecha y hora de accesos y acciones relevantes (registro de auditoría).</li>
      </ul>
      <h2>3. Para qué y con qué base legal</h2>
      <ul>
        <li>Prestar el servicio contratado y gestionar tu cuenta (ejecución del contrato).</li>
        <li>Enviarte emails necesarios: confirmación, recuperación de contraseña, invitaciones y recordatorios que puedes desactivar (ejecución del contrato e interés legítimo).</li>
        <li>Seguridad, prevención de abusos y auditoría (interés legítimo).</li>
        <li>Facturación y obligaciones contables y fiscales (obligación legal).</li>
      </ul>
      <h2>4. Cuánto tiempo los conservamos</h2>
      <p>
        Mientras mantengas la cuenta o el local. Al eliminar un local, queda 30 días pendiente de eliminación (se puede restaurar y sus
        datos se pueden seguir consultando y exportando) y después se borra con todos sus registros; también puedes pedir que se borre de
        inmediato. Al eliminar tu cuenta se borran sus datos, salvo los que debamos conservar por obligación legal durante los plazos
        establecidos.
      </p>
      <h2>5. Con quién los compartimos</h2>
      <p>
        Con proveedores que nos ayudan a prestar el servicio, como encargados del tratamiento: alojamiento (<L k="hostingProvider" />
        {LEGAL.hostingLocation.value ? `, servidores en ${LEGAL.hostingLocation.value}` : ''}), envío de email
        {LEGAL.emailProvider.value ? ` (${LEGAL.emailProvider.value})` : ''} y pagos (Stripe). No vendemos datos ni los usamos para publicidad.
      </p>
      <h2>6. Tus derechos</h2>
      <p>
        Puedes acceder, rectificar, suprimir, oponerte, limitar el tratamiento y pedir la portabilidad de tus datos escribiendo a{' '}
        <L k="contactEmail" />. Desde la aplicación puedes exportar todos los datos de tu local y eliminar tu cuenta. Si no estás conforme, puedes
        reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).
      </p>
      <h2>7. Datos que introduces de otras personas</h2>
      <p>
        Si das de alta a personal de cocina o invitas a encargados, eres responsable de informarles de que sus datos se tratan en {APP_NAME} para
        llevar los registros del local.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Términos del servicio">
      <h2>1. El servicio</h2>
      <p>
        {APP_NAME} es una aplicación web para llevar en digital los registros de autocontrol de higiene alimentaria: temperaturas, limpieza,
        recepción de mercancía, aceite de fritura, control de plagas, formación, incidencias y carta de alérgenos, con informes descargables.
      </p>
      <h2>2. Lo que {APP_NAME} es y lo que no</h2>
      <p>
        Es una ayuda para tener los registros al día y ordenados. No es un plan APPCC, no sustituye el asesoramiento de un técnico ni la
        responsabilidad del operador alimentario, y no garantiza el cumplimiento de la normativa ni la validez de los registros ante una
        inspección. Las plantillas y rangos que incluye son orientativos y cada local debe adaptarlos a su plan de autocontrol.
      </p>
      <h2>3. Prueba gratuita, precio y pago</h2>
      <p>
        Cada cuenta tiene una prueba gratuita de {PRICING.trialDays} días, sin necesidad de tarjeta, que empieza al dar de alta su primer local
        (los locales que se añadan después comparten esa misma prueba). Después, la suscripción cuesta{' '}
        {PRICING.monthly} € al mes o {PRICING.annual} € al año por local, impuestos no incluidos, con pago por adelantado a través de Stripe. La
        suscripción se renueva automáticamente hasta que la canceles.
      </p>
      <h2>4. Cancelación y solo lectura</h2>
      <p>
        Puedes cancelar en cualquier momento desde Facturación; seguirás teniendo acceso hasta el final del periodo pagado. Si la prueba termina sin
        suscripción, o hay un impago, el local pasa a modo solo lectura: podrás consultar, descargar informes y exportar tus datos, pero no añadir
        registros.
      </p>
      <h2>5. Tus datos</h2>
      <p>
        Los datos que introduces son tuyos. Puedes exportarlos y eliminar el local cuando quieras: queda 30 días pendiente de eliminación,
        por si cambias de opinión, y después se borra definitivamente (o al momento, si lo pides). Ver la{' '}
        <Link to="/privacidad" className="underline">política de privacidad</Link>.
      </p>
      <h2>6. Uso correcto</h2>
      <p>
        Te comprometes a registrar datos veraces, a custodiar tus credenciales y los dispositivos de cocina vinculados, y a no usar el servicio para
        fines ilícitos. Podemos suspender cuentas que hagan un uso abusivo.
      </p>
      <h2>7. Disponibilidad y responsabilidad</h2>
      <p>
        Trabajamos para que el servicio esté disponible y los datos seguros, pero no podemos garantizar una disponibilidad ininterrumpida. En la
        medida permitida por la ley, la responsabilidad del titular se limita al importe pagado en los últimos 12 meses.
      </p>
      <h2>8. Cambios y contacto</h2>
      <p>
        Avisaremos con antelación de cambios relevantes en estos términos. Contacto: <L k="contactEmail" />. Titular: <L k="ownerName" />, NIF{' '}
        <L k="taxId" />.
      </p>
    </LegalShell>
  );
}

export function CookiesPage() {
  return (
    <LegalShell title="Política de cookies">
      <h2>Qué usamos</h2>
      <p>
        {APP_NAME} solo usa una cookie técnica imprescindible para mantener tu sesión iniciada. No usamos cookies de análisis, publicidad ni de
        terceros, por eso no mostramos un banner de consentimiento.
      </p>
      <h3>Cookie de sesión</h3>
      <ul>
        <li>Nombre: enregla_session (o __Host-enregla_session en conexiones seguras).</li>
        <li>Finalidad: saber que has iniciado sesión. No es accesible desde JavaScript.</li>
        <li>Duración: hasta 30 días, o 7 días sin actividad. Se borra al cerrar sesión.</li>
      </ul>
      <h3>Almacenamiento local del navegador</h3>
      <p>
        En la tablet de cocina vinculada se guarda el identificador del dispositivo para que funcione sin iniciar sesión; se puede desvincular desde
        Ajustes. En cualquier dispositivo se recuerda también el último local abierto. Nada de esto se usa para seguimiento.
      </p>
      <h2>Cómo borrarlas</h2>
      <p>Puedes borrar las cookies y el almacenamiento desde los ajustes de tu navegador. Si lo haces, tendrás que volver a iniciar sesión.</p>
      <p>
        Contacto: <L k="contactEmail" />.
      </p>
    </LegalShell>
  );
}
