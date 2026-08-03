'use client';

// Reporting permissions — a report must never expose data the user can't open
// in its own module. This mirrors the Sidebar's matching rules exactly (same
// `module:submodule:action` grammar, same wildcards, same admin bypass) so a
// dataset appears in Reports if, and only if, its module would appear in the nav.
//
// (The Sidebar keeps its own copy of this logic inline; it is a large,
// frequently-touched component, so it isn't refactored onto this hook here —
// if you change the rules, change both.)

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';

const normalizePerm = (perm: string): string => {
  const cleaned = perm.trim();
  if (!cleaned) return '';
  return cleaned.includes('.') ? cleaned.replace(/\./g, ':') : cleaned;
};

export interface Perms {
  loaded: boolean;
  isAdmin: boolean;
  /** True only when /auth/me came back with an authenticated session. Lets the UI
   *  tell "signed out / session dropped" apart from "signed in, no module access". */
  authenticated: boolean;
  /** True when the user holds any of `required` (or when nothing is required). */
  can: (required?: string[]) => boolean;
}

export function usePermissions(): Perms {
  const [granted, setGranted] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await apiClient.get('/auth/me');
        if (!alive) return;
        if (data?.authenticated && data.user) {
          setAuthenticated(true);
          const perms: string[] = (data.user.permissions || [])
            .filter((p: unknown) => typeof p === 'string')
            .map((p: string) => normalizePerm(p));
          const admin = !!data.user.is_admin;
          setIsAdmin(admin);
          // Admin with an empty role payload still gets everything — matches the Sidebar.
          setGranted(admin && perms.length === 0 ? ['*:*:*'] : perms);
        }
      } catch {
        /* Fail closed on permissions, but don't fail loud: `loaded` still flips
           so the UI renders its "no datasets" state rather than hanging. */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const matches = (requiredPerm: string): boolean => {
    const required = normalizePerm(requiredPerm);
    if (granted.includes('*:*:*')) return true;
    if (granted.includes(required)) return true;

    // "module:sub:*" — satisfied by holding anything under that prefix.
    if (required.endsWith(':*')) {
      const prefix = required.slice(0, -2);
      if (granted.some((p) => p.startsWith(`${prefix}:`))) return true;
    }
    // "module:sub:action" — satisfied by a covering wildcard.
    const parts = required.split(':');
    if (parts.length === 3) {
      if (granted.includes(`${parts[0]}:${parts[1]}:*`)) return true;
      if (granted.includes(`${parts[0]}:*:*`)) return true;
    }
    return false;
  };

  const can = (required?: string[]): boolean => {
    if (!required || required.length === 0) return true;
    if (isAdmin) return true;
    return required.some(matches);
  };

  return { loaded, isAdmin, authenticated, can };
}
