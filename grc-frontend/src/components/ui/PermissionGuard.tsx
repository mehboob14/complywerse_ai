'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { authedFetch } from '@/lib/auth-fetch';

interface PermissionGuardProps {
  /** One or more permission strings. Access is granted if the user has ANY of them. */
  required: string | string[];
  children: React.ReactNode;
  /** Rendered instead of children when access is denied. Defaults to a full-page 403 block. */
  fallback?: React.ReactNode;
}

interface PermissionState {
  loading: boolean;
  isAdmin: boolean;
  permissions: string[];
}

function normalizePerm(perm: string): string {
  const cleaned = perm.trim();
  return cleaned.includes('.') ? cleaned.replace(/\./g, ':') : cleaned;
}

function matchesPermission(required: string, permissions: string[]): boolean {
  const req = normalizePerm(required);
  if (permissions.includes('*:*:*')) return true;
  if (permissions.includes(req)) return true;

  // wildcard like "risks:risk_register:*"
  if (req.endsWith(':*')) {
    const prefix = req.slice(0, -2);
    return permissions.some((p) => p.startsWith(prefix + ':'));
  }

  // specific perm — check if user has a covering wildcard
  const parts = req.split(':');
  if (parts.length === 3) {
    if (permissions.includes(`${parts[0]}:${parts[1]}:*`)) return true;
    if (permissions.includes(`${parts[0]}:*:*`)) return true;
  }
  return false;
}

function hasAccess(required: string | string[], state: PermissionState): boolean {
  if (state.isAdmin) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((perm) => matchesPermission(perm, state.permissions));
}

const defaultFallback = (
  <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
    <div className="p-5 bg-slate-100 rounded-full">
      <Lock className="w-10 h-10 text-slate-400" />
    </div>
    <h2 className="text-xl font-semibold text-slate-700">Access Denied</h2>
    <p className="text-sm text-slate-500 max-w-sm">
      You do not have permission to view this page. Contact your administrator to request access.
    </p>
  </div>
);

export default function PermissionGuard({ required, children, fallback }: PermissionGuardProps) {
  const [state, setState] = useState<PermissionState>({ loading: true, isAdmin: false, permissions: [] });

  useEffect(() => {
    let cancelled = false;
    const cached = sessionStorage.getItem('__perm_state');
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PermissionState;
        if (!cancelled) setState({ ...parsed, loading: false });
        return;
      } catch {}
    }

    authedFetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated && data.user) {
          const perms: string[] = (data.user.permissions || [])
            .filter((p: unknown) => typeof p === 'string')
            .map((p: string) => normalizePerm(p));
          const isAdmin = !!data.user.is_admin;
          const next: PermissionState = { loading: false, isAdmin, permissions: perms };
          setState(next);
          // Cache for this browser session to avoid repeated fetches
          sessionStorage.setItem('__perm_state', JSON.stringify(next));
        } else {
          setState({ loading: false, isAdmin: false, permissions: [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, isAdmin: false, permissions: [] });
      });

    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (!hasAccess(required, state)) {
    return <>{fallback ?? defaultFallback}</>;
  }

  return <>{children}</>;
}

/** Utility: inline guard — renders nothing if permission is missing (for buttons/actions) */
export function IfPermission({ required, children }: { required: string | string[]; children: React.ReactNode }) {
  const [state, setState] = useState<PermissionState>({ loading: true, isAdmin: false, permissions: [] });

  useEffect(() => {
    let cancelled = false;
    const cached = sessionStorage.getItem('__perm_state');
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PermissionState;
        if (!cancelled) setState({ ...parsed, loading: false });
        return;
      } catch {}
    }
    authedFetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated && data.user) {
          const perms: string[] = (data.user.permissions || [])
            .filter((p: unknown) => typeof p === 'string')
            .map((p: string) => normalizePerm(p));
          const isAdmin = !!data.user.is_admin;
          const next: PermissionState = { loading: false, isAdmin, permissions: perms };
          setState(next);
          sessionStorage.setItem('__perm_state', JSON.stringify(next));
        } else {
          setState({ loading: false, isAdmin: false, permissions: [] });
        }
      })
      .catch(() => { if (!cancelled) setState({ loading: false, isAdmin: false, permissions: [] }); });
    return () => { cancelled = true; };
  }, []);

  if (state.loading || !hasAccess(required, state)) return null;
  return <>{children}</>;
}
