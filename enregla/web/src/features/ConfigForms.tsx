import { useState, type FormEvent } from 'react';
import {
  EQUIPMENT_TYPES,
  EQUIPMENT_TYPE_LABELS,
  createCleaningPlanBody,
  createEquipmentBody,
  createStaffBody,
  supplierBody,
  LIMITS,
  TEMP_MAX,
  TEMP_MIN,
  TEMP_RANGE_MESSAGE,
} from '@shared/schemas';
import { api, isApiError, errorMessage } from '@/api/client';
import type { CleaningPlan, Equipment, EquipmentType, Frequency, Staff, Supplier } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Overlay';
import { Field, Input, PinInput, Select, Switch, Textarea, detailsToFieldErrors, zodToFieldErrors } from '@/components/ui/Form';
import { Icon } from '@/components/icons/Icon';
import { WEEKDAYS, numberFieldError, parseDecimal } from '@/lib/format';

type DialogFormProps<T> = { orgId: string; open: boolean; onClose: () => void; initial?: T | null; onSaved: (item: T) => void };

function useSave() {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const run = async <R,>(fn: () => Promise<R>): Promise<R | null> => {
    setLoading(true);
    setGeneral(null);
    try {
      return await fn();
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details));
      else setGeneral(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  };
  return { loading, errors, setErrors, general, run };
}

const numText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ',').replace('-', '−'));

// ---------------------------------------------------------------------------
// Equipos
// ---------------------------------------------------------------------------
export function EquipmentDialog({ orgId, open, onClose, initial, onSaved }: DialogFormProps<Equipment>) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<EquipmentType>(initial?.type ?? 'camara');
  const [minTemp, setMin] = useState(numText(initial?.minTemp));
  const [maxTemp, setMax] = useState(numText(initial?.maxTemp ?? (initial ? null : 4)));
  const [checks, setChecks] = useState(String(initial?.checksPerDay ?? 1));
  const [active, setActive] = useState(initial?.active ?? true);
  const s = useSave();
  const tempOpts = { notNumber: 'Escribe la temperatura con números (por ejemplo 4 o −18)', min: TEMP_MIN, max: TEMP_MAX, outOfRange: TEMP_RANGE_MESSAGE };
  const minError = numberFieldError(minTemp, tempOpts);
  const maxError = numberFieldError(maxTemp, tempOpts);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (minError || maxError) return;
    const extra: Record<string, string> = {};
    const min = minTemp.trim() ? parseDecimal(minTemp) : null;
    const max = maxTemp.trim() ? parseDecimal(maxTemp) : null;
    const body = { name: name.trim(), type, minTemp: min, maxTemp: max, checksPerDay: Number(checks), active };
    const parsed = createEquipmentBody.safeParse(body);
    const errs = { ...(parsed.success ? {} : zodToFieldErrors(parsed.error.issues)), ...extra };
    s.setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await s.run(() =>
      initial
        ? api.patch<{ equipment: Equipment }>(`/api/orgs/${orgId}/equipment/${initial.id}`, body)
        : api.post<{ equipment: Equipment }>(`/api/orgs/${orgId}/equipment`, body),
    );
    if (r) onSaved(r.equipment);
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? 'Editar equipo' : 'Nuevo equipo'}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Nombre" error={s.errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.equipmentName} placeholder="Ej.: Cámara de carnes" />
        </Field>
        <Field label="Tipo" error={s.errors.type}>
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as EquipmentType;
              setType(t);
              if (t === 'freidora') {
                setChecks('0');
                setMin('');
                setMax('');
              }
            }}
          >
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EQUIPMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset>
          <legend className="font-semibold">Límites de temperatura (°C)</legend>
          <p className="mb-2 text-sm text-ink-muted">Opcionales, entre −60 y 300 °C. Valores orientativos: frío máx. 4 °C, congelación máx. −18 °C, caliente mín. 63 °C. Ajústalos a tu plan.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mínima" optional live={!!minError} error={minError || s.errors.minTemp}>
              <Input inputMode="decimal" value={minTemp} onChange={(e) => setMin(e.target.value.replace('.', ',').replace('-', '−'))} placeholder="—" maxLength={7} />
            </Field>
            <Field label="Máxima" optional live={!!maxError} error={maxError || s.errors.maxTemp}>
              <Input inputMode="decimal" value={maxTemp} onChange={(e) => setMax(e.target.value.replace('.', ',').replace('-', '−'))} placeholder="—" maxLength={7} />
            </Field>
          </div>
        </fieldset>
        <Field label="Controles al día" hint="0 si no se le toma la temperatura (p. ej. freidoras)." error={s.errors.checksPerDay}>
          <Select value={checks} onChange={(e) => setChecks(e.target.value)}>
            {Array.from({ length: 13 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </Field>
        <Switch checked={active} onChange={setActive} label="Activo" description="Los equipos desactivados no generan tareas." />
        {s.general ? <Callout tone="bad" live="assertive">{s.general}</Callout> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={s.loading} disabled={!!(minError || maxError)}>
            Guardar equipo
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------
export function StaffDialog({ orgId, open, onClose, initial, onSaved }: DialogFormProps<Staff>) {
  const [name, setName] = useState(initial?.name ?? '');
  const [pinMode, setPinMode] = useState<'keep' | 'set' | 'remove'>(initial ? 'keep' : 'set');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(initial?.active ?? true);
  const s = useSave();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const pinValue = pinMode === 'set' ? (pin.trim() ? pin.trim() : null) : pinMode === 'remove' ? null : undefined;
    const body: Record<string, unknown> = { name: name.trim() };
    if (pinValue !== undefined && !(initial == null && pinValue === null)) body.pin = pinValue;
    if (initial) body.active = active;
    const parsed = createStaffBody.safeParse({ name: body.name, pin: pinValue ?? null });
    if (!parsed.success) return s.setErrors(zodToFieldErrors(parsed.error.issues));
    s.setErrors({});
    const r = await s.run(() =>
      initial ? api.patch<{ staff: Staff }>(`/api/orgs/${orgId}/staff/${initial.id}`, body) : api.post<{ staff: Staff }>(`/api/orgs/${orgId}/staff`, body),
    );
    if (r) onSaved(r.staff);
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? 'Editar persona' : 'Añadir persona'} description="El personal firma los registros en la tablet de cocina. No necesita cuenta ni email.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Nombre" error={s.errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.staffName} placeholder="Ej.: Ana Martín" />
        </Field>
        {initial ? (
          <Field label="PIN">
            <Select value={pinMode} onChange={(e) => setPinMode(e.target.value as typeof pinMode)}>
              <option value="keep">{initial.hasPin ? 'Mantener el PIN actual' : 'Sin PIN'}</option>
              <option value="set">{initial.hasPin ? 'Cambiar el PIN' : 'Poner un PIN'}</option>
              {initial.hasPin ? <option value="remove">Quitar el PIN</option> : null}
            </Select>
          </Field>
        ) : null}
        {pinMode === 'set' ? (
          <Field label={initial ? 'Nuevo PIN' : 'PIN'} optional={!initial} hint="De 4 a 6 cifras. Evita que alguien firme en nombre de otra persona." error={s.errors.pin}>
            <PinInput value={pin} onChange={setPin} />
          </Field>
        ) : null}
        {initial ? <Switch checked={active} onChange={setActive} label="Activo" description="Las personas desactivadas ya no aparecen en la tablet. Sus registros se conservan." /> : null}
        {s.general ? <Callout tone="bad" live="assertive">{s.general}</Callout> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={s.loading}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Planes de limpieza
// ---------------------------------------------------------------------------
type ItemDraft = { key: string; id?: string; area: string; product: string; method: string };
let draftKey = 0;
const newDraft = (): ItemDraft => ({ key: `n${++draftKey}`, area: '', product: '', method: '' });

export function CleaningPlanDialog({ orgId, open, onClose, initial, onSaved }: DialogFormProps<CleaningPlan>) {
  const [name, setName] = useState(initial?.name ?? '');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'daily');
  const [weekday, setWeekday] = useState(String(initial?.weekday ?? 1));
  const [monthDay, setMonthDay] = useState(String(initial?.monthDay ?? 1));
  const [active, setActive] = useState(initial?.active ?? true);
  const [items, setItems] = useState<ItemDraft[]>(
    initial?.items.map((i) => ({ key: i.id, id: i.id, area: i.area, product: i.product ?? '', method: i.method ?? '' })) ?? [newDraft()],
  );
  const s = useSave();

  // El aviso «Añade al menos una zona» desaparece en cuanto se escribe o añade una zona.
  const clearItemsError = () => {
    if (s.errors.items) {
      const { items: _items, ...rest } = s.errors;
      s.setErrors(rest);
    }
  };
  const update = (key: string, patch: Partial<ItemDraft>) => {
    clearItemsError();
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: name.trim(),
      frequency,
      weekday: frequency === 'weekly' ? Number(weekday) : null,
      monthDay: frequency === 'monthly' ? Number(monthDay) : null,
      active,
      items: items
        .filter((i) => i.area.trim())
        .map((i) => ({ ...(i.id ? { id: i.id } : {}), area: i.area.trim(), product: i.product.trim() || null, method: i.method.trim() || null })),
    };
    const parsed = createCleaningPlanBody.safeParse(body);
    if (!parsed.success) {
      const errs = zodToFieldErrors(parsed.error.issues);
      if (errs.items) errs.items = 'Añade al menos una zona';
      return s.setErrors(errs);
    }
    s.setErrors({});
    const r = await s.run(() =>
      initial
        ? api.patch<{ cleaningPlan: CleaningPlan }>(`/api/orgs/${orgId}/cleaning-plans/${initial.id}`, body)
        : api.post<{ cleaningPlan: CleaningPlan }>(`/api/orgs/${orgId}/cleaning-plans`, body),
    );
    if (r) onSaved(r.cleaningPlan);
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? 'Editar plan de limpieza' : 'Nuevo plan de limpieza'} size="lg">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Nombre del plan" error={s.errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.planName} placeholder="Ej.: Limpieza diaria de cocina" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Frecuencia">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="daily">Cada día</option>
              <option value="weekly">Una vez por semana</option>
              <option value="monthly">Una vez al mes</option>
            </Select>
          </Field>
          {frequency === 'weekly' ? (
            <Field label="Día de la semana" error={s.errors.weekday}>
              <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : frequency === 'monthly' ? (
            <Field label="Día del mes" hint="Del 1 al 28" error={s.errors.monthDay}>
              <Select value={monthDay} onChange={(e) => setMonthDay(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        <fieldset>
          <legend className="font-semibold">Zonas y elementos</legend>
          {s.errors.items ? (
            <p className="text-sm font-semibold text-bad" role="alert">
              {s.errors.items}
            </p>
          ) : null}
          <ol className="mt-2 space-y-3">
            {items.map((it, idx) => (
              <li key={it.key} className="rounded-2xl border border-line bg-paper p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-3 w-6 shrink-0 text-center font-bold text-ink-muted">{idx + 1}</span>
                  <div className="grid flex-1 gap-2 sm:grid-cols-3">
                    <Input aria-label={`Zona ${idx + 1}`} value={it.area} onChange={(e) => update(it.key, { area: e.target.value })} placeholder="Zona (p. ej. Encimeras)" maxLength={150} />
                    <Input aria-label={`Producto de la zona ${idx + 1}`} value={it.product} onChange={(e) => update(it.key, { product: e.target.value })} placeholder="Producto (opcional)" maxLength={150} />
                    <Input aria-label={`Método de la zona ${idx + 1}`} value={it.method} onChange={(e) => update(it.key, { method: e.target.value })} placeholder="Método (opcional)" maxLength={300} />
                  </div>
                  <button
                    type="button"
                    aria-label={`Quitar zona ${idx + 1}`}
                    onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}
                    disabled={items.length === 1}
                    className="grid size-12 shrink-0 place-items-center rounded-xl text-ink-muted hover:bg-surface-2 hover:text-bad disabled:opacity-40"
                  >
                    <Icon name="trash" size={20} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Button variant="quiet" icon="plus" className="mt-3" onClick={() => {
              clearItemsError();
              setItems((l) => [...l, newDraft()]);
            }} disabled={items.length >= 100}>
            Añadir zona
          </Button>
        </fieldset>
        <Switch checked={active} onChange={setActive} label="Activo" />
        {s.general ? <Callout tone="bad" live="assertive">{s.general}</Callout> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={s.loading}>
            Guardar plan
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
export function SupplierDialog({ orgId, open, onClose, initial, onSaved }: DialogFormProps<Supplier>) {
  const [name, setName] = useState(initial?.name ?? '');
  const [contactName, setContact] = useState(initial?.contactName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [products, setProducts] = useState(initial?.products.join(', ') ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const s = useSave();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: name.trim(),
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim(),
      products: products
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
      notes: notes.trim() || null,
    };
    const parsed = supplierBody.safeParse(body);
    if (!parsed.success) return s.setErrors(zodToFieldErrors(parsed.error.issues));
    s.setErrors({});
    const r = await s.run(() =>
      initial
        ? api.patch<{ supplier: Supplier }>(`/api/orgs/${orgId}/suppliers/${initial.id}`, body)
        : api.post<{ supplier: Supplier }>(`/api/orgs/${orgId}/suppliers`, body),
    );
    if (r) onSaved(r.supplier);
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? 'Editar proveedor' : 'Nuevo proveedor'}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Nombre" error={s.errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.supplierName} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Persona de contacto" optional error={s.errors.contactName}>
            <Input value={contactName} onChange={(e) => setContact(e.target.value)} maxLength={150} />
          </Field>
          <Field label="Teléfono" optional error={s.errors.phone}>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </Field>
        </div>
        <Field label="Email" optional error={s.errors.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </Field>
        <Field label="Productos habituales" optional hint="Separados por comas. Se sugieren al registrar una recepción." error={s.errors.products}>
          <Input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Pollo, ternera, huevos" />
        </Field>
        <Field label="Notas" optional error={s.errors.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
        </Field>
        {s.general ? <Callout tone="bad" live="assertive">{s.general}</Callout> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={s.loading}>
            Guardar proveedor
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
