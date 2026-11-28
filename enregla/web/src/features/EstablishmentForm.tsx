import { useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  ESTABLISHMENT_LABELS,
  ESTABLISHMENT_LIMITS,
  REFERENCE_BOUNDS,
  REFERENCE_DEFAULTS,
  REFERENCE_SOURCES,
  SANITARY_REGISTRY_HINT,
  establishmentFields,
  sanitaryRegistryLooksValid,
  type ReferenceValues,
} from '@shared/schemas';
import { api, errorMessage, isApiError } from '@/api/client';
import { keys } from '@/api/queries';
import type { Organization } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Input, detailsToFieldErrors, zodToFieldErrors } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Overlay';
import { formatDecimal, parseDecimal } from '@/lib/format';

const establishmentSchema = z.object(establishmentFields);
type Est = { legalName: string; taxId: string; address: string; postalCode: string; city: string; province: string; sanitaryRegistry: string };
const FIELDS: (keyof Est)[] = ['legalName', 'taxId', 'address', 'postalCode', 'city', 'province', 'sanitaryRegistry'];

/**
 * Datos del establecimiento para la portada del PDF de inspección: razón social, NIF/CIF, dirección y
 * nº de Registro Sanitario (RGSEAA) o autorización. Todos opcionales; el NIF/CIF se comprueba con su
 * carácter de control y el Registro Sanitario solo avisa si no sigue el formato habitual.
 */
export function EstablishmentForm({
  org,
  submitLabel = 'Guardar datos del establecimiento',
  onSaved,
  extraActions,
  intro = true,
}: {
  org: Organization;
  submitLabel?: string;
  onSaved?: () => void;
  extraActions?: ReactNode;
  /** Texto de introducción (el alta guiada ya lo explica). */
  intro?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const e = org.establishment;
  const [v, setV] = useState<Est>({
    legalName: e?.legalName ?? '',
    taxId: e?.taxId ?? '',
    address: e?.address ?? '',
    postalCode: e?.postalCode ?? '',
    city: e?.city ?? '',
    province: e?.province ?? '',
    sanitaryRegistry: e?.sanitaryRegistry ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Est) => (ev: { target: { value: string } }) => setV((x) => ({ ...x, [k]: ev.target.value }));
  const registryWarn = v.sanitaryRegistry.trim() && !sanitaryRegistryLooksValid(v.sanitaryRegistry);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setGeneral(null);
    const body = Object.fromEntries(FIELDS.map((k) => [k, v[k].trim() || null]));
    const r = establishmentSchema.safeParse(body);
    if (!r.success) {
      setErrors(zodToFieldErrors(r.error.issues));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await api.patch<{ organization: Organization }>(`/api/orgs/${org.id}`, body);
      qc.setQueryData(keys.org(org.id), res.organization);
      toast.show('Datos del establecimiento guardados');
      if (res.organization.establishment?.taxId) setV((x) => ({ ...x, taxId: res.organization.establishment!.taxId! }));
      onSaved?.();
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details));
      setGeneral(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(ev) => void save(ev)} noValidate className="space-y-4" data-testid="establishment-form">
      {intro ? <p className="text-ink-muted">Salen en la portada del informe PDF. Todos son opcionales: lo que no rellenes aparecerá como «No indicado».</p> : null}
      <Field label={ESTABLISHMENT_LABELS.legalName} optional error={errors.legalName} hint="El nombre de la empresa o del autónomo titular.">
        <Input value={v.legalName} onChange={set('legalName')} maxLength={ESTABLISHMENT_LIMITS.legalName} autoComplete="organization" />
      </Field>
      <Field label={ESTABLISHMENT_LABELS.taxId} optional error={errors.taxId} hint="NIF, NIE o CIF, con su letra o carácter de control.">
        <Input value={v.taxId} onChange={set('taxId')} maxLength={ESTABLISHMENT_LIMITS.taxId} autoCapitalize="characters" className="max-w-60" />
      </Field>
      <Field label={ESTABLISHMENT_LABELS.address} optional error={errors.address} hint="Calle y número.">
        <Input value={v.address} onChange={set('address')} maxLength={ESTABLISHMENT_LIMITS.address} autoComplete="street-address" />
      </Field>
      <Field label={ESTABLISHMENT_LABELS.postalCode} optional error={errors.postalCode}>
        <Input value={v.postalCode} onChange={set('postalCode')} maxLength={5} inputMode="numeric" autoComplete="postal-code" className="max-w-40" />
      </Field>
      <div className="grid gap-4">
        <Field label={ESTABLISHMENT_LABELS.city} optional error={errors.city}>
          <Input value={v.city} onChange={set('city')} maxLength={ESTABLISHMENT_LIMITS.city} autoComplete="address-level2" />
        </Field>
        <Field label={ESTABLISHMENT_LABELS.province} optional error={errors.province}>
          <Input value={v.province} onChange={set('province')} maxLength={ESTABLISHMENT_LIMITS.province} autoComplete="address-level1" />
        </Field>
      </div>
      <Field label={ESTABLISHMENT_LABELS.sanitaryRegistry} optional error={errors.sanitaryRegistry} hint="Formato habitual: NN.NNNNN/XX (por ejemplo, 26.012345/M).">
        <Input value={v.sanitaryRegistry} onChange={set('sanitaryRegistry')} maxLength={ESTABLISHMENT_LIMITS.sanitaryRegistry} className="max-w-96" />
      </Field>
      {registryWarn ? (
        <Callout tone="warn" title="No parece un número de RGSEAA" live="polite">
          {SANITARY_REGISTRY_HINT}
        </Callout>
      ) : null}
      {general ? (
        <Callout tone="bad" live="assertive">
          {general}
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  );
}

/**
 * Valores de referencia del local (cocinado, regeneración y enfriamiento). Orientativos, con su
 * fuente; el local puede ajustarlos a su plan de autocontrol. Vacío = el valor de referencia.
 */
export function ReferenceValuesForm({ org }: { org: Organization }) {
  const qc = useQueryClient();
  const toast = useToast();
  const custom = org.referenceValuesCustom ?? {};
  const keysOf = Object.keys(REFERENCE_DEFAULTS) as (keyof ReferenceValues)[];
  const [v, setV] = useState<Record<keyof ReferenceValues, string>>(
    () => Object.fromEntries(keysOf.map((k) => [k, custom[k] != null ? formatDecimal(custom[k]) : ''])) as Record<keyof ReferenceValues, string>,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const body: Record<string, number | null> = {};
    const errs: Record<string, string> = {};
    for (const k of keysOf) {
      const t = v[k].trim();
      if (!t) {
        body[k] = null;
        continue;
      }
      const n = parseDecimal(t);
      const b = REFERENCE_BOUNDS[k];
      if (n == null || n < b.min || n > b.max || (k === 'coolingMaxMinutes' && !Number.isInteger(n))) errs[k] = `Entre ${b.min} y ${b.max} ${b.unit}${k === 'coolingMaxMinutes' ? ', sin decimales' : ''}`;
      else body[k] = n;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await api.patch<{ organization: Organization }>(`/api/orgs/${org.id}`, { referenceValues: body });
      qc.setQueryData(keys.org(org.id), res.organization);
      toast.show('Valores de referencia guardados');
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details, 'referenceValues.'));
      toast.show(errorMessage(err), 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(ev) => void save(ev)} noValidate className="space-y-4" data-testid="reference-form">
      <p className="text-ink-muted">
        Se usan para avisar en los registros de cocinado, regeneración y enfriamiento rápido. Son <strong>orientativos</strong>: déjalos vacíos para usar el valor de referencia o
        ajústalos a tu plan de autocontrol. Los registros ya hechos conservan el valor que se aplicó.
      </p>
      {keysOf.map((k) => (
        <Field key={k} label={`${REFERENCE_BOUNDS[k].label} (${REFERENCE_BOUNDS[k].unit})`} optional error={errors[k]} hint={`Por defecto ${formatDecimal(REFERENCE_DEFAULTS[k])} ${REFERENCE_BOUNDS[k].unit}. ${REFERENCE_SOURCES[k]}`}>
          <Input value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value.replace('.', ',') }))} inputMode="decimal" maxLength={6} placeholder={formatDecimal(REFERENCE_DEFAULTS[k])} className="max-w-40" />
        </Field>
      ))}
      <Button type="submit" loading={saving}>
        Guardar valores de referencia
      </Button>
    </form>
  );
}
