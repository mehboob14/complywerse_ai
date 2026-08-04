'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';

/**
 * Browser-side idle-timeout sentinel.
 *
 * Watches for keyboard / mouse / touch activity. After `idleMinutes` of
 * inactivity it shows a "you're about to be signed out" warning; if the
 * user doesn't respond within 60 more seconds it calls /auth/logout, wipes
 * localStorage, and redirects to /login?reason=idle.
 *
 * The server enforces idle timeout independently (see
 * `auth_router.require_auth`'s `is_session_idle` check). This component is
 * the UX layer — it gives the user a clean handoff to the login screen
 * instead of a generic 401 on their next click.
 *
 * Settings are read from /admin/password-policy. If that call fails (e.g.
 * stale token), we fall back to a safe 30-min default; we never crash the
 * dashboard because the policy lookup hiccupped.
 */
export default function IdleLogout() {
  const router = useRouter();
  const [idleMinutes, setIdleMinutes] = useState<number>(30);
  const [warning, setWarning] = useState<boolean>(false);
  const lastActivityRef = useRef<number>(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load idle timeout from the policy endpoint once on mount. If it fails,
  // stick with the 30-min default.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/admin/password-policy')
      .then((r) => {
        if (cancelled) return;
        const t = r?.data?.session_idle_timeout_minutes;
        if (typeof t === 'number' && t >= 5 && t <= 1440) {
          setIdleMinutes(t);
        }
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Main idle loop — re-arms on every activity event.
  useEffect(() => {
    const clearTimers = () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      warningTimerRef.current = null;
      logoutTimerRef.current = null;
    };

    const performLogout = async () => {
      try {
        await apiClient.post('/auth/logout');
      } catch {
        /* network may be down — still wipe local state */
      }
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('tenant');
      } catch {
        /* ignore quota errors */
      }
      router.replace('/login?reason=idle');
    };

    const armTimers = () => {
      clearTimers();
      // Show warning at (idleMinutes - 1) — gives user 60s to click to stay.
      const warnAtMs = Math.max(60_000, idleMinutes * 60_000 - 60_000);
      warningTimerRef.current = setTimeout(() => setWarning(true), warnAtMs);
      // Hard logout at idleMinutes total.
      logoutTimerRef.current = setTimeout(performLogout, idleMinutes * 60_000);
    };

    const onActivity = () => {
      lastActivityRef.current = Date.now();
      if (warning) setWarning(false);
      armTimers();
    };

    armTimers();
    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'visibilitychange',
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    return () => {
      clearTimers();
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [idleMinutes, warning, router]);

  if (!warning) return null;

  // Small inline banner — intentionally light-weight so it doesn't depend on
  // any modal/dialog primitive that might not be available everywhere.
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg"
      onClick={() => {
        lastActivityRef.current = Date.now();
        setWarning(false);
      }}
    >
      <p className="text-sm font-semibold text-amber-900">
        You'll be signed out for inactivity in 60 seconds.
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Click anywhere or move the mouse to stay signed in.
      </p>
    </div>
  );
}
