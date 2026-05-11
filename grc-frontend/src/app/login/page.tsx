'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, Lock } from 'lucide-react';

// Bare IPv4 hosts (e.g. 68.183.198.54 in IP-only deployments) split into
// 4 numeric parts — without the guard below, parts[0] would be treated
// as a tenant slug ("68"), which is obviously wrong.
const _IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function getTenantSlugFromHost(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return null;
  if (_IPV4_RE.test(host)) return null;
  if (host.endsWith('.localhost')) {
    const parts = host.split('.');
    if (parts.length === 2) return parts[0];
  }
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0];
  return null;
}

function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  
  const urlParams = new URLSearchParams(window.location.search);
  const urlTenant = urlParams.get('tenant');
  if (urlTenant) {
    localStorage.setItem('tenant_slug', urlTenant);
    return urlTenant;
  }

  const hostTenant = getTenantSlugFromHost();
  if (hostTenant) {
    localStorage.setItem('tenant_slug', hostTenant);
    return hostTenant;
  }

  // Do not reuse stale tenant_slug for login; let backend resolve by email domain
  localStorage.removeItem('tenant_slug');
  return null;
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    const slug = getTenantSlug();
    setTenantSlug(slug);
    const name = localStorage.getItem('tenant_name');
    setTenantName(name);

    // Just registered? Show a confirmation banner and pre-fill the email.
    if (searchParams?.get('registered') === '1') {
      const prefill = searchParams.get('email') || '';
      if (prefill) setEmail(prefill);
      setInfo("Account created. Sign in with the password you just set.");
    }

    // Surface SSO callback errors (e.g. domain not allowed, token exchange failure)
    const ssoErr = searchParams?.get('error');
    if (ssoErr) {
      const map: Record<string, string> = {
        sso_not_provisioned: "Your Microsoft account isn't allowed to sign in to this organization. Contact your administrator.",
        sso_state_mismatch: "Sign-in expired or was tampered with. Please try again.",
        sso_state_expired: "Sign-in expired. Please try again.",
        sso_invalid_callback: "Microsoft sign-in failed (invalid callback).",
        sso_provider_error: "Microsoft returned an error. Please try again.",
        sso_token_exchange_failed: "Microsoft rejected the sign-in request. Contact your administrator.",
        sso_id_token_invalid: "Microsoft sign-in could not be verified. Contact your administrator.",
        sso_disabled: "Microsoft sign-in is not enabled for this organization.",
        sso_tenant_lost: "Could not resolve your organization. Please try again.",
      };
      setError(map[ssoErr] || 'Microsoft sign-in failed.');
    }

    // Check if SSO is configured for this tenant
    (async () => {
      try {
        const headers: Record<string, string> = {};
        const slugForHeader = getTenantSlugFromHost() || slug;
        if (slugForHeader) headers['X-Tenant-Slug'] = slugForHeader;
        const res = await fetch('/api/auth/entra/availability', { headers, credentials: 'include' });
        if (!res.ok) {
          setSsoEnabled(false);
          return;
        }
        const data = await res.json();
        setSsoEnabled(!!data?.enabled);
      } catch {
        setSsoEnabled(false);
      }
    })();
  }, [searchParams]);

  const handleSsoSignIn = () => {
    // Backend resolves tenant via subdomain or X-Tenant-Slug; we can't set
    // headers on a top-level navigation, so rely on the subdomain (or pass
    // ?tenant_slug= as a fallback). Backend reads X-Tenant-Slug from
    // TenantMiddleware which falls back to the URL host.
    const slug = getTenantSlugFromHost() || tenantSlug;
    const url = slug
      ? `/api/auth/entra/login?tenant_slug=${encodeURIComponent(slug)}`
      : '/api/auth/entra/login';
    window.location.href = url;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      
      if (tenantSlug) {
        headers['X-Tenant-Slug'] = tenantSlug;
      } else {
        localStorage.removeItem('tenant_slug');
      }
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: email, password }),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();

        // CRITICAL: Clear ALL previous localStorage and sessionStorage to prevent cross-user data leakage
        localStorage.clear();
        sessionStorage.clear(); // Clears permission cache so new user gets fresh permissions

        // Bearer token from response body. Stored in localStorage so the axios
        // interceptor can stamp every request with `Authorization: Bearer ...`.
        // We don't rely on the Set-Cookie header alone because browsers reject
        // `Domain=localhost` cookies — the cookie would be silently discarded
        // and the user would bounce-loop on the dashboard.
        if (data.access_token) {
          localStorage.setItem('token', data.access_token);
        }

        if (data.tenant) {
          localStorage.setItem('tenant_slug', data.tenant.slug || data.tenant.subdomain || '');
          // tenant_subdomain is read by the 401 response interceptor to
          // detect wrong-subdomain bounces and redirect cleanly. Always
          // populate it (even if it equals tenant_slug, like in our default
          // setup where slug == subdomain).
          localStorage.setItem('tenant_subdomain', data.tenant.subdomain || data.tenant.slug || '');
          localStorage.setItem('tenant_name', data.tenant.name || '');
          localStorage.setItem('tenant_id', String(data.tenant.id || ''));
        }

        // Ensure no stale user/session data survives cross-account login.
        queryClient.clear();

        // ALWAYS do a full-page navigation to the canonical tenant URL after
        // login. Two reasons we don't use router.replace here:
        //
        //   1. If the current subdomain differs from the authenticated tenant
        //      (e.g. browser at acme.localhost, logged in as bob@layeron),
        //      we must change hostname so the axios interceptor reads the
        //      right slug from window.location. The interceptor in api.ts
        //      OVERWRITES localStorage.tenant_slug with the host-derived slug
        //      on every request, which silently breaks any cross-host
        //      `router.replace`.
        //   2. A full nav resets React state and React Query cache cleanly,
        //      so the new tenant context can't see any stale data from the
        //      previous user/tenant.
        const targetSub: string | undefined = data.tenant?.subdomain || data.tenant?.slug;
        const host = window.location.hostname.toLowerCase();
        const { protocol, port } = window.location;
        let currentSub: string | null = null;
        if (host.endsWith('.localhost')) {
          const parts = host.split('.');
          if (parts.length === 2) currentSub = parts[0];
        } else if (host !== 'localhost' && host !== '127.0.0.1' && !_IPV4_RE.test(host)) {
          // Skip IPv4 — first octet isn't a tenant slug.
          const parts = host.split('.');
          if (parts.length >= 3) currentSub = parts[0];
        }
        const baseHost = host.endsWith('.localhost')
          ? 'localhost'
          : (currentSub ? host.split('.').slice(-2).join('.') : host);
        // eslint-disable-next-line no-console
        console.log('[login] currentSub=%s targetSub=%s host=%s', currentSub, targetSub, host);

        if (targetSub && currentSub !== targetSub) {
          // Cross-subdomain redirect. localStorage on the destination is a
          // SEPARATE storage area (per-origin), so we hand off the token + tenant
          // context via URL fragment. Fragments are not sent to the server, so
          // the token never leaks via access logs / proxies. The destination's
          // root layout reads the fragment, hydrates its own localStorage, then
          // strips the fragment from the URL.
          const params = new URLSearchParams();
          if (data.access_token) params.set('auth_token', data.access_token);
          if (data.tenant?.slug) params.set('tenant_slug', data.tenant.slug);
          if (data.tenant?.subdomain) params.set('tenant_subdomain', data.tenant.subdomain);
          if (data.tenant?.name) params.set('tenant_name', data.tenant.name);
          if (data.tenant?.id != null) params.set('tenant_id', String(data.tenant.id));
          const dest = `${protocol}//${targetSub}.${baseHost}${port ? ':' + port : ''}/dashboard#${params.toString()}`;
          window.location.href = dest;
          return;
        }
        // Same tenant — still do a full nav to wipe React state.
        window.location.href = `${protocol}//${host}${port ? ':' + port : ''}/dashboard`;
        return;
      } else {
        const data = await response.json();
        if (response.status === 409) {
          setError(data.detail || 'Multiple organizations found. Please select your company and try again.');
        } else {
          setError(data.detail || 'Invalid credentials');
        }
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const clearTenantContext = () => {
    // Clear ALL localStorage to ensure clean state
    localStorage.clear();
    setTenantSlug(null);
    setTenantName(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-2xl font-bold text-slate-950 tracking-tight">
              Compl<span className="relative inline-block">
                {/* dotless i via unicode + colored dot above */}
                <span style={{ fontVariantLigatures: 'none' }}>ı</span>
                <span
                  className="absolute left-1/2 -translate-x-1/2 rounded-full"
                  style={{ top: '-3px', width: '5px', height: '5px', background: 'var(--color-base, #14b8a6)' }}
                />
              </span>verse
            </span>
            <span className="text-sm font-medium text-slate-950 self-end mb-0.5">AI</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Sign in to your GRC workspace</p>
        </div>

        {/* Tenant badge */}
        {tenantSlug && (
          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-[11px] text-slate-500">Signing in to</p>
                  <p className="text-xs font-semibold text-slate-800">{tenantName || tenantSlug}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearTenantContext}
                className="text-[11px] text-blue-600 hover:text-blue-700 underline"
              >
                Switch
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">

          {/* Microsoft SSO */}
          {ssoEnabled ? (
            <>
              <button
                type="button"
                onClick={handleSsoSignIn}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 mb-5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 23 23">
                  <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
                <span>Sign in with Microsoft</span>
              </button>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400 font-medium">or sign in with email</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled
                title="Microsoft SSO is not enabled for this organization."
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-500 cursor-not-allowed opacity-60 mb-5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 23 23">
                  <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
                <span>Sign in with Microsoft</span>
                <Lock size={13} className="ml-auto opacity-60" />
              </button>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400 font-medium">or sign in with email</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {info && !error && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-emerald-700">
                <span className="text-xs">{info}</span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-rose-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span className="text-xs">{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-600 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:bg-white transition-colors"
                placeholder="name@companydomain.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-600 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:bg-white transition-colors"
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors mt-1"
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-400">
            Want to join?{' '}
            <a
              href="/register"
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              Register your company
            </a>
            {' '}&mdash; or contact{' '}
            <a href="mailto:support@compliverse.ai" className="text-blue-600 hover:text-blue-700">
              support
            </a>
          </p>
        </div>

        {/* Footer */}
        <p className="mt-5 text-center text-[11px] text-slate-400 leading-relaxed px-2">
          By signing in, you agree to Compliverse&apos;s{' '}
          <a
            href="https://compliverse.ai/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600"
          >
            Privacy Policy
          </a>
          {' '}and{' '}
          <a
            href="https://compliverse.ai/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600"
          >
            Terms of Service
          </a>
          . Your data is protected with enterprise-grade security.
        </p>

      </div>
    </div>
  );
}
