'use client';

import { useState, useEffect } from 'react';
import { authedFetch } from '@/lib/auth-fetch';

const PERM_CACHE_KEY = '__perm_state';

function normalizePerm(perm: string): string {
  const cleaned = perm.trim();
  return cleaned.includes('.') ? cleaned.replace(/\./g, ':') : cleaned;
}

/** Client-specific modules this tenant has (/auth/me tenant.features), e.g. "audit_register". */
export function useTenantFeatures(): { features: string[]; isLoading: boolean } {
  const [state, setState] = useState<{ features: string[]; isLoading: boolean }>({ features: [], isLoading: true });
  useEffect(() => {
    let live = true;
    authedFetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (live) setState({ features: Array.isArray(data?.tenant?.features) ? data.tenant.features : [], isLoading: false }); })
      .catch(() => { if (live) setState({ features: [], isLoading: false }); });
    return () => { live = false; };
  }, []);
  return state;
}

export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try sessionStorage cache first to avoid repeated API calls
    try {
      const cached = sessionStorage.getItem(PERM_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const cachedPermsRaw = Array.isArray(parsed?.permissions) ? parsed.permissions : [];
        const cachedPerms = cachedPermsRaw
          .filter((p: unknown) => typeof p === 'string')
          .map((p: string) => normalizePerm(p));
        setPermissions(cachedPerms);
        setIsAdmin(!!parsed.isAdmin);
        setIsLoading(false);
        return;
      }
    } catch {}

    const fetchPermissions = async () => {
      try {
        const response = await authedFetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          if (data?.authenticated && data.user) {
            const rawPerms: unknown = data.user.permissions;
            const perms: string[] = Array.isArray(rawPerms)
              ? rawPerms
                  .filter((p: unknown) => typeof p === 'string')
                  .map((p: string) => normalizePerm(p))
              : [];
            const admin = !!data.user.is_admin;
            setPermissions(perms);
            setIsAdmin(admin);
            // Write to cache so PermissionGuard and usePermissions share the same data
            sessionStorage.setItem(PERM_CACHE_KEY, JSON.stringify({ permissions: perms, isAdmin: admin, loading: false }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch permissions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPermissions();
  }, []);

  const hasPermission = (permission: string): boolean => {
    if (isAdmin) return true;
    if (!Array.isArray(permissions)) return false;
    if (permissions.includes('*:*:*')) return true;
    
    const req = normalizePerm(permission);
    if (permissions.includes(req)) return true;
    
    const parts = req.split(':');
    if (parts.length === 3) {
      if (permissions.includes(`${parts[0]}:${parts[1]}:*`)) return true;
      if (permissions.includes(`${parts[0]}:*:*`)) return true;
    }
    // wildcard required (e.g. "risks:risk_register:*")
    if (req.endsWith(':*')) {
      const prefix = req.slice(0, -2);
      return permissions.some((p) => p.startsWith(prefix + ':'));
    }
    return false;
  };

  const hasAnyPermission = (perms: string[]): boolean => {
    return perms.some(perm => hasPermission(perm));
  };

  return {
    permissions,
    isAdmin,
    hasPermission,
    hasAnyPermission,
    isLoading,
  };
}
