'use client';

// notify.success / error / warning / info: the feedback standard on top of useToast. A confirmation of a quick action goes by itself after 3 seconds;
// an error stays until someone dismisses it, says what the server said (cleaned) and can carry a Retry. Needs the app's ToastProvider, like useToast.
// What each call turns into is decided in reportOutcome.ts (confirmationToast, errorToast).
import { useMemo } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { confirmationToast, errorToast, type NotifyErrorOptions, type NotifyOptions } from './reportOutcome';

export type { NotifyErrorOptions, NotifyOptions };

/** Each call shows a toast and returns its id. */
export interface Notify {
  /** a quick action went through: `notify.success('Document archived')` */
  success: (message: string, options?: NotifyOptions) => string;
  /** something failed: pass the caught error (or a sentence); `{ title, fallback, retry }` shape the toast. Never goes by itself */
  error: (errorOrMessage: unknown, options?: NotifyErrorOptions) => string;
  warning: (message: string, options?: NotifyOptions) => string;
  info: (message: string, options?: NotifyOptions) => string;
}

export function useNotify(): Notify {
  const { toast } = useToast();
  return useMemo<Notify>(() => ({
    success: (message, options) => toast(confirmationToast('success', message, options)),
    error: (errorOrMessage, options) => toast(errorToast(errorOrMessage, options)),
    warning: (message, options) => toast(confirmationToast('warning', message, options)),
    info: (message, options) => toast(confirmationToast('info', message, options)),
  }), [toast]);                                                      // `toast` is stable, so is `notify`: safe in a dependency list
}
