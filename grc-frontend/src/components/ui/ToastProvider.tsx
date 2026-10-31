'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { ToastContainer, type ToastAction, type ToastData, type ToastType } from './Toast';
import { keepToasts } from './toastLogic';
import { detailText } from '@/lib/apiError';

interface ToastOptions {
  title: string;
  message?: string;
  type?: ToastType;
  /** ms before it goes by itself (default 5000); 0 keeps it until someone dismisses it */
  duration?: number;
  /** a button on the toast ("Retry"); clicking it runs it and dismisses the toast */
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

function generateToastId(): string {
  toastIdCounter += 1;
  return `toast-${toastIdCounter}-${Date.now()}`;
}

export interface ToastProviderProps {
  children: ReactNode;
  maxToasts?: number;
}

export function ToastProvider({ children, maxToasts = 5 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  // Toasts are the app's only notification channel (~40 call sites, incl. every
  // alert()->toast conversion). This was left hardcoded to true (a WIP/debug
  // switch), silently swallowing all of them; re-enabled so they actually show.
  const suppressToasts = false;

  const toast = useCallback((options: ToastOptions): string => {
    const id = generateToastId();
    if (suppressToasts) {
      return id;
    }
    const newToast: ToastData = {
      id,
      title: options.title,
      // a server's `detail` passed on as it came (a 422 list, an object) is read out, not rendered as an object (a blank app)
      message: options.message == null || typeof options.message === 'string' ? options.message : detailText(options.message),
      type: options.type || 'info',
      duration: options.duration ?? 5000,
      action: options.action,
    };

    // too many: the oldest goes, but a toast that stays until dismissed (an error nobody has read) outlives one that goes by itself
    setToasts((prev) => keepToasts([...prev, newToast], maxToasts));

    return id;
  }, [maxToasts, suppressToasts]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss, dismissAll }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export default ToastProvider;
