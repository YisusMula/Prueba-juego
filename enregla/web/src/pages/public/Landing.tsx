import { useState } from 'react';
import { Navigate } from 'react-router';
import { PublicLayout } from '@/layouts/PublicLayout';
import { LinkButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/icons/Icon';
import { AllergenIcon } from '@/components/icons/AllergenIcon';
import { TilePattern } from '@/layouts/AuthLayout';
import { APP_NAME, PRICING } from '@/config/brand';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';

export function LandingPage() {
  useDocumentTitle();
  // El enlace del recordatorio diario apunta a "/": con sesión, se va directo al panel.
  if (storage.hasSessionHint()) return <Navigate to="/app" replace />;
  return (
    <PublicLayout landing>
      <Hero />
      <Steps />
      <Features />
      <KitchenBand />
      <AllergenSection />
      <Pricing />
      <Faq />
      <FinalCta />
    </PublicLayout>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-20 lg:pb-24">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft px-3 py-1 text-sm font-bold text-brand-strong dark:text-brand">
            <Icon name="leaf" size={16} /> Para bares, restaurantes y obradores
          </p>
          <h1 className="text-[2.4rem] leading-[1.05] font-extrabold sm:text-6xl">
            Los registros de higiene de tu cocina, <span className="text-brand">al día y sin papeles</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-muted sm:text-xl">
            Temperaturas, limpieza, recepción de mercancía, aceite, plagas y alérgenos. Tu equipo los apunta en la tablet de cocina en
            segundos y, cuando llega la inspección, descargas el informe en PDF.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LinkButton to="/registro" size="lg" iconRight="arrowRight">
              Pruébalo {PRICING.trialDays} días gratis
            </LinkButton>
            <a
              href="#como-funciona"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-6 text-lg font-semibold hover:bg-surface-2"
            >
              Ver cómo funciona
            </a>
          </div>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><Icon name="check" size={18} className="text-ok" /> Sin tarjeta</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="check" size={18} className="text-ok" /> Listo en 5 minutos</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="check" size={18} className="text-ok" /> Cancela cuando quieras</span>
          </p>
        </div>
        <HeroMock />
      </div>
    </section>
  );
}

/** Maqueta ilustrativa del panel "Hoy" (no es una captura de datos reales). */
function HeroMock() {
  const rows: { icon: IconName; name: string; value: string; state: 'ok' | 'bad' | 'pending' }[] = [
    { icon: 'thermometer', name: 'Cámara de carnes', value: '2,8 °C', state: 'ok' },
    { icon: 'thermometer', name: 'Congelador', value: '−19 °C', state: 'ok' },
    { icon: 'thermometer', name: 'Vitrina de postres', value: '7,1 °C', state: 'bad' },
    { icon: 'sparkles', name: 'Limpieza diaria', value: 'Pendiente', state: 'pending' },
  ];
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-soft via-transparent to-[color-mix(in_oklab,var(--mint)_40%,transparent)]" />
      <div className="rotate-[-1.5deg] rounded-[2rem] border border-line bg-surface p-5 shadow-pop sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold tracking-wide text-brand uppercase">Hoy · martes</p>
            <p className="font-display text-2xl font-extrabold">Bar La Esquina</p>
          </div>
          <div className="relative grid size-20 place-items-center">
            <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
              <circle cx="40" cy="40" r="33" fill="none" stroke="var(--surface-3)" strokeWidth="9" />
              <circle cx="40" cy="40" r="33" fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinecap="round" strokeDasharray="207" strokeDashoffset="62" />
            </svg>
            <span className="font-display text-lg font-bold">70%</span>
          </div>
        </div>
        <ul className="mt-5 space-y-2.5">
          {rows.map((r) => (
            <li
              key={r.name}
              className={cn(
                'flex items-center gap-3 rounded-2xl border px-3.5 py-3',
                r.state === 'bad' ? 'border-bad/40 bg-bad-soft' : 'border-line bg-paper',
              )}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-surface text-brand shadow-card">
                <Icon name={r.icon} size={22} />
              </span>
              <span className="flex-1 font-semibold">{r.name}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold',
                  r.state === 'ok' && 'bg-ok-soft text-ok',
                  r.state === 'bad' && 'bg-bad-solid text-white',
                  r.state === 'pending' && 'bg-warn-soft text-warn',
                )}
              >
                <Icon name={r.state === 'ok' ? 'check' : r.state === 'bad' ? 'alert' : 'clock'} size={14} strokeWidth={2.5} />
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="absolute -bottom-6 -left-2 w-56 rotate-[3deg] rounded-2xl border border-line bg-surface p-4 shadow-pop sm:-left-8">
        <p className="text-sm font-bold text-bad">Fuera de rango</p>
        <p className="mt-1 text-sm">¿Qué has hecho?</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-paper">Regulado el termostato</span>
          <span className="rounded-full border border-line-strong px-2.5 py-1 text-xs font-semibold">Producto trasladado</span>
        </div>
      </div>
    </div>
  );
}

function Steps() {
  const steps = [
    { n: 1, title: 'Da de alta tu local', text: 'Elige si eres bar, restaurante, cafetería u obrador y cargamos una plantilla de equipos y limpieza que puedes ajustar.' },
    { n: 2, title: 'La cocina apunta en la tablet', text: 'Modo cocina con botones grandes: elige la cámara, teclea la temperatura y listo. Si algo está fuera de rango, pide qué se ha hecho.' },
    { n: 3, title: 'Tú lo ves todo y sacas el PDF', text: 'Desde el móvil ves qué falta hoy y las alertas. Cuando llega la inspección, descargas el informe del periodo en un toque.' },
  ];
  return (
    <section id="como-funciona" className="scroll-mt-20 border-y border-line bg-surface py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold sm:text-4xl">Cómo funciona, en tres pasos</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="relative rounded-3xl border border-line bg-paper p-6">
              <span className="font-display text-6xl leading-none font-extrabold text-brand/25" aria-hidden="true">
                {s.n}
              </span>
              <h3 className="mt-3 text-xl font-bold">
                <span className="sr-only">Paso {s.n}: </span>
                {s.title}
              </h3>
              <p className="mt-2 text-ink-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  const items: { icon: IconName; title: string; text: string }[] = [
    { icon: 'thermometer', title: 'Temperaturas', text: 'Cámaras, congeladores, vitrinas y mantenimiento en caliente, con límites por equipo y aviso si algo se sale.' },
    { icon: 'sparkles', title: 'Limpieza', text: 'Planes diarios, semanales y mensuales con sus zonas. Se marcan en un momento.' },
    { icon: 'truck', title: 'Recepción de mercancía', text: 'Proveedor, producto, lote, temperatura y caducidad. Y el motivo si rechazas algo.' },
    { icon: 'droplet', title: 'Aceite de fritura', text: 'Revisiones y cambios, con compuestos polares si usas medidor.' },
    { icon: 'bug', title: 'Control de plagas', text: 'Revisiones con o sin indicios y la acción tomada.' },
    { icon: 'alert', title: 'Incidencias', text: 'Qué ha pasado, qué se ha hecho y cuándo se cerró.' },
    { icon: 'graduation', title: 'Formación', text: 'Cursos de manipulación y alérgenos de cada persona del equipo.' },
    { icon: 'report', title: 'Informe PDF y CSV', text: 'Por fechas y tipos, con las correcciones señaladas. También en hoja de cálculo.' },
  ];
  return (
    <section id="funciones" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold sm:text-4xl">Todo lo que hoy apuntas en papel, en un solo sitio</h2>
        <p className="mt-3 max-w-2xl text-lg text-ink-muted">
          Los registros no se pueden borrar ni modificar a escondidas: cada corrección queda guardada con su motivo, quién la hizo y cuándo.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((f) => (
            <li key={f.title} className="rounded-3xl border border-line bg-surface p-5 shadow-card">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-strong dark:text-brand">
                <Icon name={f.icon} size={26} />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-1 text-ink-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function KitchenBand() {
  return (
    <section className="relative overflow-hidden bg-brand-strong py-16 text-white sm:py-20 dark:bg-[#0a2f33]">
      <TilePattern />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="font-bold tracking-wide text-[var(--mint)] uppercase">Modo cocina</p>
          <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">Pensado para manos con prisa (y con guantes)</h2>
          <ul className="mt-6 space-y-3 text-lg text-white/90">
            {[
              'Una tablet compartida, sin usuarios ni contraseñas: cada persona elige su nombre y, si quieres, un PIN.',
              'Botones enormes y teclado numérico propio, con signo negativo y coma.',
              'Verde si está bien; rojo si no, con acciones correctoras a un toque.',
              'Si un día se pierde la tablet, la desvinculas desde tu móvil.',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Icon name="check" size={24} className="mt-0.5 shrink-0 text-[var(--mint)]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-3" aria-hidden="true">
          <div className="col-span-3 mb-1 rounded-2xl bg-white/10 px-5 py-4 text-right font-display text-5xl font-extrabold">−18,5 °C</div>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '±', '0', ','].map((k) => (
            <span key={k} className="grid h-16 place-items-center rounded-2xl bg-white/12 font-display text-3xl font-bold">
              {k}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function AllergenSection() {
  const sample = ['gluten', 'crustaceans', 'eggs', 'fish', 'milk', 'nuts', 'celery', 'mustard'] as const;
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div className="order-2 grid grid-cols-4 gap-3 lg:order-1">
          {sample.map((a) => (
            <div key={a} className="grid aspect-square place-items-center rounded-3xl border border-line bg-surface shadow-card">
              <AllergenIcon id={a} size={56} />
            </div>
          ))}
        </div>
        <div className="order-1 lg:order-2">
          <p className="font-bold tracking-wide text-brand uppercase">Carta de alérgenos</p>
          <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">Tu carta de alérgenos, con código QR para la mesa</h2>
          <p className="mt-4 text-lg text-ink-muted">
            Marca para cada plato los 14 alérgenos de declaración obligatoria: contiene, puede contener trazas o no contiene. Imprime la tabla o
            comparte una carta pública que el cliente filtra por sus alergias desde su móvil.
          </p>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const price = annual ? PRICING.annual : PRICING.monthly;
  const saving = PRICING.monthly * 12 - PRICING.annual;
  return (
    <section id="precios" className="scroll-mt-20 border-y border-line bg-surface py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold sm:text-4xl">Un precio sencillo, por local</h2>
          <p className="mt-3 text-lg text-ink-muted">Todas las funciones incluidas. Sin permanencia.</p>
          <div role="radiogroup" aria-label="Periodo de facturación" className="mt-7 inline-flex rounded-2xl border border-line bg-paper p-1">
            {[
              { v: false, label: 'Mensual' },
              { v: true, label: 'Anual' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={annual === o.v}
                onClick={() => setAnnual(o.v)}
                className={cn('min-h-12 rounded-xl px-6 font-bold transition-colors', annual === o.v ? 'bg-brand text-on-brand shadow-card' : 'text-ink-muted hover:text-ink')}
              >
                {o.label}
                {o.v ? <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-xs text-ink">2 meses gratis</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-lg rounded-[2rem] border-2 border-brand bg-paper p-7 shadow-pop sm:p-9">
          <p className="font-bold text-brand">{APP_NAME} completo</p>
          <p className="mt-2 flex items-end gap-2" aria-live="polite">
            <span className="font-display text-6xl font-extrabold tabular">{price} €</span>
            <span className="pb-2 text-lg text-ink-muted">/ {annual ? 'año' : 'mes'} por local</span>
          </p>
          <p className="text-ink-muted">
            IVA no incluido.{' '}
            {annual ? `Equivale a ${(PRICING.annual / 12).toFixed(0)} € al mes: ahorras ${saving} € al año.` : `O ${PRICING.annual} € al año pagando de una vez.`}
          </p>
          <ul className="mt-6 space-y-2.5">
            {[
              'Registros ilimitados de los 7 tipos',
              'Tablets de cocina y personal ilimitados',
              'Carta de alérgenos con QR',
              'Informes PDF y CSV',
              'Varios encargados por local',
              'Exporta tus datos cuando quieras',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Icon name="check" size={22} className="mt-0.5 shrink-0 text-ok" />
                {t}
              </li>
            ))}
          </ul>
          <LinkButton to="/registro" size="lg" block className="mt-8" iconRight="arrowRight">
            Pruébalo {PRICING.trialDays} días gratis, sin tarjeta
          </LinkButton>
          <p className="mt-3 text-center text-sm text-ink-muted">Al terminar la prueba eliges plan. Si no, el local pasa a solo lectura y puedes seguir descargando tus informes.</p>
        </div>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: '¿Necesito tarjeta para probarlo?',
    a: `No. Tienes ${PRICING.trialDays} días con todas las funciones sin dar ningún dato de pago. Si te convence, eliges plan mensual o anual.`,
  },
  {
    q: `¿${APP_NAME} sustituye a mi plan APPCC?`,
    a: `No. ${APP_NAME} te ayuda a llevar al día los registros que tu plan de autocontrol te pide. Las plantillas de equipos, rangos y limpieza son orientativas: revísalas con tu plan o con tu asesor y adáptalas a tu local. No garantizamos el resultado de ninguna inspección.`,
  },
  {
    q: '¿Qué pasa cuando termina la prueba?',
    a: 'Si no eliges plan, el local pasa a modo solo lectura: no se pueden añadir registros, pero puedes consultarlos, descargar informes y exportar tus datos.',
  },
  {
    q: '¿Qué necesito en la cocina?',
    a: 'Cualquier tablet o móvil con navegador e internet. Desde Ajustes generas un código QR, lo escaneas con la tablet y queda vinculada. Se puede instalar como app.',
  },
  {
    q: '¿Y si se cae internet?',
    a: 'La aplicación avisa de que no hay conexión. Los registros necesitan internet para guardarse con la hora del servidor, así que si se corta, anótalo y regístralo en cuanto vuelva.',
  },
  {
    q: '¿Puedo corregir un registro mal apuntado?',
    a: 'Sí, con una corrección: el registro original no se borra, se guarda la versión corregida con el motivo, quién la hizo y cuándo. Así se ve en el informe.',
  },
  {
    q: '¿Puedo tener varios locales o varios encargados?',
    a: 'Sí. Cada local tiene su propia suscripción y puedes invitar a encargados por email para que gestionen el día a día.',
  },
  {
    q: '¿Cómo cancelo?',
    a: 'Desde Ajustes → Facturación, cuando quieras y sin permanencia. Puedes exportar todos tus datos y eliminar el local en cualquier momento.',
  },
];

function Faq() {
  return (
    <section id="preguntas" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-3xl font-extrabold sm:text-4xl">Preguntas frecuentes</h2>
        <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-surface">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 open:pb-4 sm:px-6">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
                {f.q}
                <Icon name="chevronDown" size={22} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-16 sm:px-6 sm:pb-20">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-brand px-6 py-12 text-center text-on-brand sm:py-16">
        <TilePattern />
        <h2 className="relative text-3xl font-extrabold sm:text-4xl">Deja la carpeta de registros en el cajón</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-lg opacity-90">Configura tu local en 5 minutos y empieza hoy mismo.</p>
        <LinkButton to="/registro" size="lg" variant="secondary" className="relative mt-7" iconRight="arrowRight">
          Pruébalo {PRICING.trialDays} días gratis, sin tarjeta
        </LinkButton>
      </div>
    </section>
  );
}
