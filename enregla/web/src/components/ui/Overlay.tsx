import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/icons/Icon';
import { Button } from './Button';

/**
 * Diálogo modal basado en <dialog> nativo: atrapa el foco, Esc cierra y devuelve
 * el foco al elemento que lo abrió.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onCloseRef.current();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onCloseRef.current();
      }}
      className={cn(
        'm-auto w-[calc(100%-1.5rem)] rounded-3xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-[rgb(10_20_25/0.55)] backdrop:backdrop-blur-[2px] open:animate-pop',
        size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl',
      )}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
              {description ? <p className="mt-1 text-ink-muted">{description}</p> : null}
            </div>
            {dismissible ? (
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                aria-label="Cerrar"
                className="-mt-1 -mr-1 grid size-12 shrink-0 place-items-center rounded-xl text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" />
              </button>
            ) : null}
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Confirmación simple para acciones destructivas. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Avisos (toasts) con región aria-live
// ---------------------------------------------------------------------------
type ToastTone = 'ok' | 'bad' | 'info';
type ToastItem = { id: number; tone: ToastTone; message: string };
type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, tone: ToastTone = 'ok') => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, tone, message }]);
      window.setTimeout(() => remove(id), tone === 'bad' ? 7000 : 4000);
    },
    [remove],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md animate-fade-up items-center gap-3 rounded-2xl px-4 py-3 font-semibold shadow-pop',
              t.tone === 'ok' && 'bg-ok-solid text-white',
              t.tone === 'bad' && 'bg-bad-solid text-white',
              t.tone === 'info' && 'bg-ink text-paper',
            )}
          >
            <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'bad' ? 'alert' : 'info'} size={22} strokeWidth={2.5} />
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => remove(t.id)} aria-label="Cerrar aviso" className="grid size-9 place-items-center rounded-lg hover:bg-white/15">
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast fuera de ToastProvider');
  return ctx;
}
