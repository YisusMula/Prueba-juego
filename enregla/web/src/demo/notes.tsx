/** Avisos de la demo en los puntos donde la app real enviaría correos, cobraría o imprimiría. */
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import type { PlatformNoteId } from '@/lib/platform';
import type { ReactNode } from 'react';
import { pairDemoKiosk } from './actions';
import { DEMO_EMAIL, DEMO_PASSWORD } from './server/seed';

function PairKioskNote() {
  const navigate = useNavigate();
  return (
    <Callout
      tone="info"
      title="Demo: tablet de ejemplo"
      action={
        <Button
          variant="secondary"
          icon="tablet"
          onClick={() => {
            if (pairDemoKiosk()) navigate('/cocina', { state: { kioskStart: 'who' } });
          }}
        >
          Usar la tablet de ejemplo
        </Button>
      }
    >
      En la demo no hace falta escanear nada: vincula esta pantalla con la tablet de cocina de ejemplo.
    </Callout>
  );
}

export const DEMO_NOTES: Partial<Record<PlatformNoteId, ReactNode>> = {
  login: (
    <Callout tone="info" title="Demo: cuenta de ejemplo">
      Ya están rellenados el email <strong className="break-all">{DEMO_EMAIL}</strong> y la contraseña <strong>{DEMO_PASSWORD}</strong>. Pulsa «Entrar».
    </Callout>
  ),
  register: (
    <Callout tone="info" title="En la demo no se envían correos">
      Puedes rellenar el formulario para ver cómo se valida, pero no se crea ninguna cuenta ni llega ningún email. Para entrar, usa la cuenta de ejemplo desde «Entrar».
    </Callout>
  ),
  'password-reset': (
    <Callout tone="info" title="En la demo no se envían correos">
      La contraseña de la cuenta de ejemplo es <strong>{DEMO_PASSWORD}</strong>.
    </Callout>
  ),
  billing: (
    <Callout tone="info" icon="card" title="Pagos no disponibles en la demo">
      En la app real aquí se elige el plan (12 € al mes o 120 € al año por local, IVA no incluido) y se paga con tarjeta a través de Stripe. En la demo no se puede
      contratar ni se cobra nada: el local de ejemplo tiene la suscripción activa.
    </Callout>
  ),
  invitations: (
    <Callout tone="info" title="En la demo no se envían correos">
      Puedes invitar a un encargado: la invitación queda pendiente en la lista, pero nadie la recibe.
    </Callout>
  ),
  export: (
    <Callout tone="info" title="Demo">
      La exportación contiene los datos de ejemplo de esta demo, incluidos los cambios que hayas hecho.
    </Callout>
  ),
  audit: (
    <Callout tone="info" title="Demo">
      Actividad de ejemplo de los últimos días, más lo que hagas en esta sesión. Las IP son de ejemplo.
    </Callout>
  ),
  'account-email': (
    <Callout tone="info" title="En la demo no se envían correos">
      El cambio de email se confirma con un enlace que llega al nuevo correo, así que en la demo no se completa.
    </Callout>
  ),
  print: (
    <Callout tone="info" title="En la demo no se puede imprimir">
      Esta es la tabla tal y como saldría en papel. En la app real, el botón «Imprimir» abre el diálogo de impresión.
    </Callout>
  ),
  'public-menu-link': (
    <Callout tone="info" title="Demo">
      El QR y el enlace son de ejemplo. Pulsa «Abrir la carta» para verla como la vería un comensal.
    </Callout>
  ),
  'kiosk-pair': <PairKioskNote />,
  'device-token': (
    <Callout tone="info" title="Demo">
      No hay otra tablet que escanee el código: pulsa «Usar este dispositivo» para abrir el modo cocina con este dispositivo nuevo.
    </Callout>
  ),
};
