import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Buttons (all colours/fonts from src/theme.ts):
 *  - primary:   forest-950 pill, stone-100 text, arrow icon, 52px tall; hover/press olive-600
 *  - secondary: transparent, 1.5px olive border, olive text
 *  - accent:    olive-100 fill, forest-950 text — MAX ONE PER SCREEN
 *  - danger:    Conflict colours (warning / destructive)
 *  - ghost:     text-only olive action
 * Each variant has its own font token so they can be restyled in src/theme.ts in one edit.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'btn-primary-type btn-arrow min-h-button px-6 bg-chrome text-on-chrome border border-chrome hover:bg-primary hover:border-primary active:bg-primary active:border-primary',
  secondary:
    'btn-secondary-type px-5 bg-transparent text-primary-ink border-[1.5px] border-primary hover:bg-surface-tint active:bg-surface-tint',
  accent: 'btn-primary-type px-5 bg-accent-soft text-on-accent-soft border border-accent-soft hover:border-primary',
  danger: 'btn-danger-type px-5 bg-conflict-bg text-conflict-fg border-[1.5px] border-conflict-fg hover:brightness-95',
  ghost: 'btn-secondary-type px-4 bg-transparent text-primary-ink border border-transparent hover:bg-surface-tint',
};

export function buttonClass(variant: ButtonVariant = 'primary', extra = '', block = false): string {
  return [
    'inline-flex min-h-tap items-center justify-center gap-2 rounded-chip py-2 text-base no-underline',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    block ? 'w-full' : '',
    VARIANT[variant],
    extra,
  ].join(' ');
}

type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; block?: boolean };

export function Button({ variant = 'primary', block = false, className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className, block)} {...rest} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; block?: boolean };

export function ButtonLink({ variant = 'primary', block = false, className = '', ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, className, block)} {...rest} />;
}
