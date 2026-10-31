'use client';

// Button and IconButton: the platform's one button. The classes live in buttonStyles.ts; this is the behaviour.
//
//   <Button variant="primary" leftIcon={<Plus />} onClick={add}>New document</Button>
//   <Button href="/governance/settings" variant="link">Settings</Button>             a next/link with the same look
//   <Button variant="primary" loading={save.isPending} onClick={save}>Save</Button>
//   <IconButton label="Delete row" onClick={remove}><Trash2 /></IconButton>         the label is the aria-label and the title
//
// `type` is "button" unless you say otherwise, so a button inside a form never submits by accident. A loading button does nothing when pressed
// and says so (aria-busy); it uses aria-disabled rather than the disabled attribute so keyboard focus stays on it. A disabled link is rendered
// without an href, so it cannot be followed by any route (click, middle click, "open in a new tab"); it keeps role="link" and is out of the tab order.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { buttonClasses, iconButtonClasses, type ButtonSize, type ButtonVariant, type IconButtonVariant } from './buttonStyles';

interface ButtonOwn {
  /** default "secondary" */
  variant?: ButtonVariant;
  /** "md" is the control height (32px, 44px on touch); "sm" is 28px (44px on touch) */
  size?: ButtonSize;
  /** a spinner replaces the left icon (or sits over the middle when there is none); the button keeps its width, ignores presses and reports aria-busy */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
}
type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwn>;
type NativeLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwn | 'href'>;

/** With `href` the button is a link (next/link) and takes the anchor's attributes; without it, the button's. */
export type ButtonProps = ButtonOwn & (({ href?: undefined } & NativeButton) | ({ href: string } & NativeLink));

const swallow = (e: MouseEvent) => e.preventDefault();

function Content({ loading, leftIcon, rightIcon, children }: { loading: boolean; leftIcon?: ReactNode; rightIcon?: ReactNode; children?: ReactNode }) {
  // With no left icon the spinner goes over the middle and the content turns transparent (not hidden: the name must stay in the accessibility tree),
  // so the button never changes width.
  const overlay = loading && !leftIcon;
  const spinner = <Loader2 aria-hidden="true" className="animate-spin" strokeWidth={1.75} />;
  return (
    <>
      {overlay && <span className="absolute inset-0 grid place-items-center">{spinner}</span>}
      <span className={overlay ? 'inline-flex min-w-0 items-center gap-[6px] opacity-0' : 'inline-flex min-w-0 items-center gap-[6px]'}>
        {loading && leftIcon ? spinner : leftIcon}
        {children != null && children !== false && <span className="min-w-0 truncate">{children}</span>}
        {rightIcon}
      </span>
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const { variant, size, loading = false, leftIcon, rightIcon, fullWidth, disabled = false, className, children, ...rest } = props;
  const classes = clsx(buttonClasses({ variant, size, fullWidth, loading }), className);
  const content = <Content loading={loading} leftIcon={leftIcon} rightIcon={rightIcon}>{children}</Content>;
  const busy = loading || undefined;

  if (rest.href !== undefined) {
    const { href, onClick, ...anchor } = rest;
    if (disabled || loading) {
      return (
        <a {...anchor} ref={ref as Ref<HTMLAnchorElement>} role="link" aria-disabled="true" aria-busy={busy} tabIndex={-1} className={classes}>{content}</a>
      );
    }
    return <Link {...anchor} ref={ref as Ref<HTMLAnchorElement>} href={href} onClick={onClick} className={classes}>{content}</Link>;
  }

  const { type = 'button', onClick, ...button } = rest;
  return (
    <button
      {...button}
      ref={ref as Ref<HTMLButtonElement>}
      type={type}
      disabled={disabled}
      aria-disabled={busy}
      aria-busy={busy}
      onClick={loading ? swallow : onClick}
      className={classes}
    >
      {content}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** What the button does ("Delete row"). Required: it is the accessible name (aria-label) and the tooltip (title), because an icon alone names nothing. */
  label: string;
  /** default "ghost" */
  variant?: IconButtonVariant;
}

/** A square icon-only button. Pass the icon as the child (any lucide icon; it is drawn at 16px). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, variant, type = 'button', className, children, ...rest }, ref) {
  return (
    <button title={label} {...rest} ref={ref} type={type} aria-label={label} className={clsx(iconButtonClasses(variant), className)}>
      {children}
    </button>
  );
});
