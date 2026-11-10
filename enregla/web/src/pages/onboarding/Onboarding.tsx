import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, createOrgBody } from '@shared/schemas';
import { api, errorMessage } from '@/api/client';
import { keys, useAccount } from '@/api/queries';
import type { BusinessType, Organization } from '@/api/types';
import { Button, LinkButton } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Input, zodToFieldErrors } from '@/components/ui/Form';
import { Logo } from '@/components/ui/Logo';
import { Icon, type IconName } from '@/components/icons/Icon';
import { CleaningManager, EquipmentManager, StaffManager } from '@/features/ConfigLists';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/cn';

const STEPS = ['Tu local', 'Equipos', 'Limpieza', 'Personal', 'Listo'] as const;

const BUSINESS_ICONS: Record<BusinessType, IconName> = {
  bar: 'utensils',
  restaurante: 'utensils',
  cafeteria: 'droplet',
  obrador: 'chef',
  catering: 'truck',
  tienda: 'store',
};

const TIMEZONES = [
  { value: 'Europe/Madrid', label: 'Península y Baleares' },
  { value: 'Atlantic/Canary', label: 'Canarias' },
];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2" aria-label="Pasos del alta">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1.5" aria-current={i === step ? 'step' : undefined}>
          <span className={cn('h-1.5 rounded-full transition-colors', i <= step ? 'bg-brand' : 'bg-surface-3')} />
          <span className={cn('hidden text-xs font-semibold sm:block', i === step ? 'text-ink' : 'text-ink-muted')}>
            {i + 1}. {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OnboardingPage() {
  useDocumentTitle('Alta del local');
  const [params, setParams] = useSearchParams();
  const orgId = params.get('local');
  const step = Math.min(Math.max(Number(params.get('paso') ?? 0) || 0, 0), STEPS.length - 1);
  const go = (n: number, id = orgId) => setParams(id ? { local: id, paso: String(n) } : {}, { replace: false });
  const account = useAccount();
  const hasOrgs = (account.data?.organizations.length ?? 0) > 0;
  const effectiveStep = orgId ? Math.max(step, 1) : 0;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Logo size={32} />
          {hasOrgs || orgId ? (
            <Link to={orgId ? `/locales/${orgId}/hoy` : '/app'} className="inline-flex min-h-12 items-center rounded-xl px-3 font-semibold text-ink-muted hover:bg-surface-2">
              Salir del asistente
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pt-6 pb-16 outline-none">
        <Stepper step={effectiveStep} />
        <div className="mt-8">
          {effectiveStep === 0 ? (
            <StepOrg onCreated={(org) => go(1, org.id)} />
          ) : !orgId ? null : effectiveStep === 1 ? (
            <StepShell
              title="Revisa tus equipos"
              intro="Hemos cargado una plantilla orientativa según tu tipo de negocio. Cambia nombres y límites para que coincidan con tu cocina y tu plan de autocontrol."
              onBack={() => go(0)}
              onNext={() => go(2)}
            >
              <EquipmentManager orgId={orgId} readOnly={false} />
            </StepShell>
          ) : effectiveStep === 2 ? (
            <StepShell title="Revisa la limpieza" intro="Planes diarios, semanales y mensuales con sus zonas. Ajústalos a lo que de verdad hacéis." onBack={() => go(1)} onNext={() => go(3)}>
              <CleaningManager orgId={orgId} readOnly={false} />
            </StepShell>
          ) : effectiveStep === 3 ? (
            <StepShell
              title="Añade a tu equipo de cocina"
              intro="Quienes firmarán los registros en la tablet. No necesitan email ni cuenta; el PIN es opcional."
              onBack={() => go(2)}
              onNext={() => go(4)}
              nextLabel="Terminar"
            >
              <StaffManager orgId={orgId} readOnly={false} />
            </StepShell>
          ) : (
            <StepDone orgId={orgId} />
          )}
        </div>
      </main>
    </div>
  );
}

function StepShell({ title, intro, children, onBack, onNext, nextLabel = 'Siguiente' }: { title: string; intro: string; children: React.ReactNode; onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <section aria-labelledby="step-title">
      <h1 id="step-title" className="text-3xl font-extrabold">
        {title}
      </h1>
      <p className="mt-2 mb-6 text-lg text-ink-muted">{intro}</p>
      {children}
      <div className="sticky bottom-0 -mx-4 mt-8 flex gap-3 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur">
        <Button variant="secondary" size="lg" icon="arrowLeft" onClick={onBack}>
          Atrás
        </Button>
        <Button size="lg" className="flex-1" iconRight="arrowRight" onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </section>
  );
}

function StepOrg({ onCreated }: { onCreated: (org: Organization) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType | null>(null);
  const [timezone, setTimezone] = useState('Europe/Madrid');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createOrgBody.safeParse({ name, businessType: type ?? undefined, timezone });
    if (!parsed.success) {
      const errs = zodToFieldErrors(parsed.error.issues);
      if (errs.businessType) errs.businessType = 'Elige el tipo de negocio';
      return setErrors(errs);
    }
    setErrors({});
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ organization: Organization }>('/api/orgs', parsed.data);
      await qc.invalidateQueries({ queryKey: keys.account });
      onCreated(r.organization);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Vamos a dar de alta tu local</h1>
        <p className="mt-2 text-lg text-ink-muted">Son 4 pasos y se tarda menos de 5 minutos. Todo se puede cambiar después.</p>
      </div>
      <Field label="Nombre del local" error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej.: Bar La Esquina" autoComplete="organization" />
      </Field>
      <fieldset>
        <legend className="mb-2 font-semibold">Tipo de negocio</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {BUSINESS_TYPES.map((b) => (
            <label
              key={b}
              className={cn(
                'flex min-h-24 cursor-pointer flex-col items-start justify-between gap-2 rounded-2xl border-2 p-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus',
                type === b ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <input type="radio" name="businessType" value={b} checked={type === b} onChange={() => setType(b)} className="sr-only" />
              <Icon name={BUSINESS_ICONS[b]} size={26} className="text-brand" />
              <span className="font-bold">{BUSINESS_TYPE_LABELS[b]}</span>
            </label>
          ))}
        </div>
        {errors.businessType ? (
          <p className="mt-1.5 text-sm font-semibold text-bad" role="alert">
            {errors.businessType}
          </p>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">Zona horaria</legend>
        <div className="flex flex-wrap gap-2">
          {TIMEZONES.map((t) => (
            <label key={t.value} className={cn('inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-4 font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus', timezone === t.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface')}>
              <input type="radio" name="tz" className="sr-only" checked={timezone === t.value} onChange={() => setTimezone(t.value)} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Callout tone="info">
        Empiezas con <strong>14 días de prueba gratis</strong>, sin tarjeta. Cargaremos una plantilla orientativa de equipos y limpieza para tu tipo de
        negocio que podrás revisar en el siguiente paso.
      </Callout>
      {error ? <Callout tone="bad" live="assertive">{error}</Callout> : null}
      <Button type="submit" size="lg" block loading={loading} iconRight="arrowRight">
        Crear local y continuar
      </Button>
    </form>
  );
}

function StepDone({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  return (
    <section className="text-center">
      <span className="mx-auto grid size-20 animate-pop place-items-center rounded-3xl bg-ok-solid text-white shadow-pop">
        <Icon name="check" size={44} strokeWidth={3} />
      </span>
      <h1 className="mt-6 text-3xl font-extrabold">¡Tu local está listo!</h1>
      <p className="mx-auto mt-2 max-w-lg text-lg text-ink-muted">
        Ya puedes registrar desde aquí. Para la cocina, vincula una tablet o móvil y tu equipo apuntará las temperaturas en segundos.
      </p>
      <div className="mx-auto mt-8 grid max-w-md gap-3">
        <Button size="lg" icon="today" onClick={() => navigate(`/locales/${orgId}/hoy`)}>
          Ir al panel de hoy
        </Button>
        <LinkButton to={`/locales/${orgId}/ajustes/cocina`} variant="secondary" size="lg" icon="tablet">
          Vincular la tablet de cocina
        </LinkButton>
      </div>
    </section>
  );
}
