'use client';

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { TOAST_ACTION, TOAST_TEXT, TOAST_TONES, toastRole } from './toastTheme';
import { createToastTimer, type ToastTimer } from './toastLogic';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** A button on the toast ("Retry", "Undo"): it runs, then the toast goes. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

export interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
}

const toastStyles: Record<ToastType, { icon: React.ElementType; bg: string; border: string; iconColor: string }> = {
  success: { icon: CheckCircle, ...TOAST_TONES.success },
  error: { icon: AlertCircle, ...TOAST_TONES.error },
  warning: { icon: AlertTriangle, ...TOAST_TONES.warning },
  info: { icon: Info, ...TOAST_TONES.info },
};

export function Toast({ id, title, message, type, duration = 5000, action, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const clock = useRef<ToastTimer | null>(null);
  const styles = toastStyles[type];
  const Icon = styles.icon;

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  // the auto-dismiss clock (duration 0 never runs); it waits while someone is reading: pointer over the toast, or focus inside it
  useEffect(() => {
    const timer = createToastTimer(duration, () => handleDismiss());
    clock.current = timer;
    timer.start();
    return () => timer.pause();
  }, [duration, id]);

  useEffect(() => {
    if (hovered || focused) clock.current?.pause();
    else clock.current?.start();
  }, [hovered, focused]);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onDismiss(id);
    }, 300);
  };

  // once: the button stays for the 300 ms the toast fades, and a second click must not Retry (repeat the request) twice
  const acted = useRef(false);
  const runAction = () => {
    if (acted.current || !action) return;
    acted.current = true;
    action.onClick();
    handleDismiss();
  };

  return (
    <div
      className={clsx(
        'pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-elevated transition-all duration-300',
        styles.bg,
        styles.border,
        isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
      role={toastRole(type)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      <div className="flex gap-3">
        <div className={clsx('flex-shrink-0', styles.iconColor)}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={clsx('text-sm font-medium break-words', TOAST_TEXT.title)}>{title}</p>
          {message && (
            <p className={clsx('mt-1 text-sm break-words', TOAST_TEXT.message)}>{message}</p>
          )}
          {action && (
            <button
              type="button"
              onClick={runAction}
              className={clsx('mt-2 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]', TOAST_ACTION)}
            >
              {action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className={clsx('flex-shrink-0 self-start rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]', TOAST_TEXT.close)}
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed top-14 right-4 z-[10000] flex flex-col gap-3 pointer-events-none"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export default Toast;
