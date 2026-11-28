import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet' | 'ok';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold select-none transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100 text-center leading-tight';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong shadow-card',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink hover:bg-surface-2',
  quiet: 'bg-brand-soft text-brand-strong hover:bg-surface-3 dark:text-brand',
  danger: 'bg-bad-solid text-white hover:brightness-95 shadow-card',
  ok: 'bg-ok-solid text-white hover:brightness-95 shadow-card',
};

// Objetivos táctiles: md y superiores ≥ 48 px; xl (modo cocina) ≥ 64 px.
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-3 text-sm',
  md: 'min-h-12 px-4 text-base',
  lg: 'min-h-14 px-6 text-lg',
  xl: 'min-h-18 px-7 text-xl rounded-2xl',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, cn(block && 'w-full', className))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'xl' ? 26 : 20} /> : icon ? <Icon name={icon} size={size === 'xl' ? 28 : 20} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'xl' ? 28 : 20} /> : null}
    </button>
  );
});

type LinkButtonProps = LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconRight?: IconName; block?: boolean };

export function LinkButton({ variant = 'primary', size = 'md', icon, iconRight, block, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, cn(block && 'w-full', className as string))} {...rest}>
      {icon ? <Icon name={icon} size={20} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={20} /> : null}
    </Link>
  );
}

/** Botón solo con icono: exige etiqueta accesible. */
export function IconButton({
  icon,
  label,
  size = 48,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl text-ink hover:bg-surface-2 disabled:opacity-50', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} />
    </button>
  );
}
