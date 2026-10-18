'use client';

import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { TOAST_TEXT, TOAST_TONES } from './toastTheme';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
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

export function Toast({ id, title, message, type, duration = 5000, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const styles = toastStyles[type];
  const Icon = styles.icon;

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, id]);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onDismiss(id);
    }, 300);
  };

  return (
    <div
      className={clsx(
        'pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-elevated transition-all duration-300',
        styles.bg,
        styles.border,
        isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
      role="alert"
      aria-live="polite"
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
      className="fixed top-4 right-4 z-[10000] flex flex-col gap-3 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export default Toast;
