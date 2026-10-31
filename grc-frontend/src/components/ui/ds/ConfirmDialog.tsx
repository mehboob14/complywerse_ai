'use client';

// The question box that replaces window.confirm: a title, a few words, and two buttons (Cancel on the left, the action on the right).
// Built on the platform's AnimatedModal (scrim, Escape, backdrop, scroll lock); useConfirm drives it. The action's label says what will happen
// ("Archive 3 documents"); it has no default. A destructive question puts focus on Cancel, so a stray Enter cannot do the damage.
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';

export interface ConfirmRequest {
  title: string;
  message?: ReactNode;
  /** what the button does, as a verb phrase: "Archive 3 documents" (never "OK") */
  confirmLabel: string;
  /** default "Cancel" */
  cancelLabel?: string;
  /** "danger" makes the action red and puts focus on Cancel */
  tone?: 'default' | 'danger';
}

export interface ConfirmDialogProps extends ConfirmRequest {
  open: boolean;
  onConfirm: () => void;
  /** Cancel, Escape and a click on the backdrop */
  onCancel: () => void;
}

const BUTTON = 'inline-flex min-h-ds-control items-center justify-center rounded-ds-control px-3 text-ds-body font-medium transition-colors focus-visible:outline-none focus-visible:shadow-ds-ring';
const CANCEL = `${BUTTON} border border-ds-border-control bg-ds-surface text-ds-fg hover:bg-ds-surface-hover`;
const PRIMARY = `${BUTTON} bg-ds-primary text-ds-on-primary hover:bg-ds-primary-hover active:bg-ds-primary-active`;
const DANGER = `${BUTTON} bg-ds-danger text-ds-on-danger hover:bg-ds-danger-hover`;

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const hasMessage = Boolean(message);
  const danger = tone === 'danger';

  const panel = useRef<HTMLElement | null>(null);

  // runs when AnimatedModal mounts the content (a frame after `open`): names the dialog and puts focus on the marked button
  const mount = useCallback((el: HTMLDivElement | null) => {
    const dialog = el?.closest<HTMLElement>('[role="dialog"]') ?? null;
    panel.current = dialog;
    if (!el || !dialog) return;
    dialog.setAttribute('aria-labelledby', titleId);
    if (hasMessage) dialog.setAttribute('aria-describedby', messageId);
    else dialog.removeAttribute('aria-describedby');
    if (!dialog.contains(document.activeElement)) el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [titleId, messageId, hasMessage]);

  // Escape and a click on the backdrop answer this question, and nothing under it: asked from inside a drawer or another dialog, those must stay
  // open. The window sees the key first (capture), before the overlays' own document listeners. The backdrop is handled here because
  // AnimatedModal's own check (`target === currentTarget`) never passes: its scrim covers the overlay and takes the click.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      onCancel();
    };
    const onDown = (e: MouseEvent) => {
      const dialog = panel.current;
      const target = e.target as Node | null;
      if (dialog?.parentElement && target && dialog.parentElement.contains(target) && !dialog.contains(target)) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [open, onCancel]);

  return (
    <AnimatedModal isOpen={open} onClose={onCancel} bareHeader size="md">
      <div ref={mount} className="px-[20px] pb-[16px] pt-[20px]">
        <h2 id={titleId} className="text-ds-section text-ds-fg">{title}</h2>
        {hasMessage && <div id={messageId} className="mt-2 break-words text-ds-body text-ds-fg-body">{message}</div>}
        <div className="mt-[20px] flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} data-autofocus={danger ? '' : undefined} className={CANCEL}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} data-autofocus={danger ? undefined : ''} className={danger ? DANGER : PRIMARY}>{confirmLabel}</button>
        </div>
      </div>
    </AnimatedModal>
  );
}

export default ConfirmDialog;
