'use client';

import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { clsx } from 'clsx';

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
  success: {
    icon: CheckCircle,
    bg: 'bg-success-500/10',
    border: 'border-success-500/30',
    iconColor: 'text-success-400',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-danger-500/10',
    border: 'border-danger-500/30',
    iconColor: 'text-danger-400',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/30',
    iconColor: 'text-warning-400',
  },
  info: {
    icon: Info,
    bg: 'bg-info-500/10',
    border: 'border-info-500/30',
    iconColor: 'text-info-400',
  },
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
        'pointer-events-auto w-80 rounded-lg border bg-white p-4 shadow-elevated transition-all duration-300',
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
          <p className="text-sm font-medium text-white">{title}</p>
          {message && (
            <p className="mt-1 text-sm text-slate-600">{message}</p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-slate-600 hover:text-white transition-colors"
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
      className="fixed top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export default Toast;
