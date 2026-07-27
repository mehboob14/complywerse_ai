'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Lock, Mail, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';

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

// Shared field styling — soft filled pill inputs with a leading icon, per the
// design mockups. Split base so each field controls its own padding.
const FIELD_BASE =
  'block w-full rounded-full border bg-slate-50/80 py-3 text-[15px] text-slate-900 placeholder:font-normal placeholder:text-slate-400/70 outline-none transition-all focus:bg-white focus:ring-4';
const FIELD_OK =
  'border-slate-200 hover:border-slate-300 focus:border-primary-500 focus:ring-primary-500/15';
const FIELD_BAD =
  'border-rose-400 bg-rose-50/40 focus:border-rose-500 focus:ring-rose-500/15';
// Visible field labels — small, quiet, left-aligned with the pill's padding.
const FIELD_LABEL = 'mb-1 block pl-1 text-[13px] font-medium text-slate-700';

// Microsoft 4-square mark, reused by the button and the SSO handoff card.
function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 23 23" aria-hidden>
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoRedirecting, setSsoRedirecting] = useState(false);
  const ssoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  // True only when ?tenant= was used — host-derived tenants should not change
  // the heading (keeps subdomain login visually identical to localhost).
  const [tenantFromQuery, setTenantFromQuery] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromQuery = Boolean(urlParams.get('tenant'));
    setTenantFromQuery(fromQuery);

    const slug = getTenantSlug();
    setTenantSlug(slug);
    const name = localStorage.getItem('tenant_name');
    setTenantName(name);

    // Just registered? Show a confirmation banner and pre-fill the email.
    if (searchParams?.get('registered') === '1') {
      const prefill = searchParams.get('email') || '';
      if (prefill) setEmail(prefill);
      setInfo('Account created. Sign in with the password you just set.');
    }

    // Surface SSO callback errors (e.g. domain not allowed, token exchange failure)
    const ssoErr = searchParams?.get('error');
    if (ssoErr) {
      const map: Record<string, string> = {
        sso_not_provisioned: "Your Microsoft account isn't allowed to sign in to this organization. Contact your administrator.",
        sso_state_mismatch: 'Sign-in expired or was tampered with. Please try again.',
        sso_state_expired: 'Sign-in expired. Please try again.',
        sso_invalid_callback: 'Microsoft sign-in failed (invalid callback).',
        sso_provider_error: 'Microsoft returned an error. Please try again.',
        sso_token_exchange_failed: 'Microsoft rejected the sign-in request. Contact your administrator.',
        sso_id_token_invalid: 'Microsoft sign-in could not be verified. Contact your administrator.',
        sso_disabled: 'Microsoft sign-in is not enabled for this organization.',
        sso_tenant_lost: 'Could not resolve your organization. Please try again.',
      };
      setError(map[ssoErr] || 'Microsoft sign-in failed.');
    }
  }, [searchParams]);

  // If the user comes BACK from the Microsoft page (browser back button /
  // bfcache restore), the redirecting card would otherwise be stuck on
  // screen. pageshow with persisted=true fires exactly in that case.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setSsoRedirecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      if (ssoTimer.current) clearTimeout(ssoTimer.current);
    };
  }, []);

  const handleSsoSignIn = () => {
    // Backend resolves tenant via subdomain or X-Tenant-Slug; we can't set
    // headers on a top-level navigation, so rely on the subdomain (or pass
    // ?tenant_slug= as a fallback). Backend reads X-Tenant-Slug from
    // TenantMiddleware which falls back to the URL host.
    const slug = getTenantSlugFromHost() || tenantSlug;
    const url = slug
      ? `/api/auth/entra/login?tenant_slug=${encodeURIComponent(slug)}`
      : '/api/auth/entra/login';
    // Show the handoff card briefly before navigating so the user knows a
    // Microsoft window is about to take over (and can cancel).
    setError('');
    setSsoRedirecting(true);
    ssoTimer.current = setTimeout(() => {
      window.location.href = url;
    }, 900);
  };

  const cancelSsoSignIn = () => {
    if (ssoTimer.current) {
      clearTimeout(ssoTimer.current);
      ssoTimer.current = null;
    }
    setSsoRedirecting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setPasswordInvalid(false);

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

        // Subdomain-first tenant routing (restored from the temporary
        // single-host mode):
        //   - On `localhost` / `.localhost` hosts we ALWAYS redirect to
        //     `{tenant_subdomain}.localhost:{port}/dashboard` so the
        //     browser hostname carries the tenant identity. Modern OSes
        //     (Win 10+, macOS, Linux) auto-resolve *.localhost to
        //     127.0.0.1; no /etc/hosts edit needed.
        //   - On dotted-domain hosts (e.g. `app.example.com`) we redirect
        //     to `{subdomain}.example.com` when current ≠ target.
        //   - Bare IPv4 hosts (e.g. `68.183.198.54`) STILL skip the
        //     redirect — prefixing the IP would produce an unreachable
        //     hostname like `company.68.183.198.54`. The `baseHost`
        //     calculation above keeps IP hosts pointing at the IP.
        const isBareIPv4 = _IPV4_RE.test(host);
        const shouldRedirect = !!targetSub
          && !isBareIPv4
          && (currentSub !== targetSub);
        if (shouldRedirect) {
          // localStorage on the destination is a SEPARATE storage area
          // (per-origin), so we hand off the token + tenant context via
          // URL fragment. Fragments are not sent to the server, so the
          // token never leaks via access logs / proxies. The destination's
          // root layout reads the fragment, hydrates its own localStorage,
          // then strips the fragment from the URL.
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
        // Same tenant, OR bare-IP host where we can't redirect cross-subdomain —
        // still do a full nav to wipe React state.
        window.location.href = `${protocol}//${host}${port ? ':' + port : ''}/dashboard`;
        return;
      } else {
        const data = await response.json();
        if (response.status === 409) {
          setError(data.detail || 'Multiple organizations found. Please select your company and try again.');
        } else {
          setError(data.detail || 'Invalid credentials');
          // Outline the password field only for actual credential rejections
          // (401), not for lockouts (423) or tenant-resolution errors.
          if (response.status === 401) setPasswordInvalid(true);
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
    setTenantFromQuery(false);
  };

  // ── SSO handoff state — shown while we bounce to Microsoft ──────────────
  if (ssoRedirecting) {
    return (
      <AuthShell>
        <div className="auth-fade-up rounded-2xl border border-slate-100 bg-white px-8 py-10 text-center shadow-elevated">
          <div className="relative mx-auto mb-6 h-16 w-16">
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-primary-100 border-t-primary-600" />
            <div className="absolute inset-2 flex items-center justify-center rounded-full bg-white shadow-sm">
              <MicrosoftMark size={22} />
            </div>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Redirecting to Microsoft…</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
            A Microsoft window will open to sign you in
            {tenantSlug ? (
              <> to <span className="font-semibold text-slate-700">{tenantName || tenantSlug}</span></>
            ) : null}
            . Approve the request to continue.
          </p>
          <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3.5 py-1.5 text-[11px] font-medium text-primary-800">
            <Lock size={11} strokeWidth={2} />
            Secure, audit-logged connection
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={cancelSsoSignIn}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              Cancel and go back
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {/* Heading — same copy on bare localhost and tenant subdomains so the
          form card matches. Tenant is still resolved from the host for API
          headers; Switch only appears when the tenant came from ?tenant=. */}
      <div className="mb-5 text-center">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">Welcome back</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          {tenantFromQuery ? (
            <>
              Sign in to <span className="font-semibold text-slate-800">{tenantName || tenantSlug}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <button
                type="button"
                onClick={clearTenantContext}
                className="font-semibold text-primary-700 underline-offset-2 hover:text-primary-800 hover:underline"
              >
                Switch
              </button>
            </>
          ) : (
            'Sign in to your GRC workspace.'
          )}
        </p>
      </div>

      {/* Banners */}
      {info && !error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-emerald-700">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span className="text-xs">{info}</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-600" />
          <div>
            <p className="text-xs font-semibold text-rose-700">We couldn&apos;t sign you in</p>
            <p className="mt-0.5 text-xs leading-relaxed text-rose-600">{error}</p>
          </div>
        </div>
      )}

      {/* Microsoft SSO — always available; the backend handles configured vs. not. */}
      <button
        type="button"
        onClick={handleSsoSignIn}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-[0_2px_10px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.08)] transition-all hover:border-slate-300 hover:shadow-[0_4px_14px_rgba(15,23,42,0.1),0_1px_3px_rgba(15,23,42,0.08)]"
      >
        <MicrosoftMark />
        <span>Sign in with Microsoft</span>
      </button>

      <div className="my-4 flex items-center gap-4">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">or continue with email</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Email + password */}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label htmlFor="email" className={FIELD_LABEL}>Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" style={{ left: '1.125rem' }} strokeWidth={1.75} />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${FIELD_BASE} ${FIELD_OK} pl-11 pr-5`}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className={FIELD_LABEL}>Password</label>
          <div className="relative">
            <Lock
              className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 ${passwordInvalid ? 'text-rose-400' : 'text-slate-400'}`}
              style={{ left: '1.125rem' }}
              strokeWidth={1.75}
            />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordInvalid(false); }}
              className={`${FIELD_BASE} ${passwordInvalid ? FIELD_BAD : FIELD_OK} pl-11 pr-12`}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {passwordInvalid && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
              <AlertCircle size={12} className="shrink-0" />
              Incorrect password
            </p>
          )}
        </div>

        {/* pt wrapper gives the CTA a touch more separation than the fields
            have between themselves, without fighting the form's space-y. */}
        <div className="pt-1.5">
          <button
            type="submit"
            disabled={isLoading}
            className="auth-cta group flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary-400 via-primary-600 to-primary-700 px-4 py-3 text-sm font-bold tracking-wide text-white shadow-[0_14px_30px_-14px_rgba(13,148,136,0.65)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-14px_rgba(13,148,136,0.7)] disabled:translate-y-0 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </span>
          </button>
        </div>
      </form>

      {/* Recovery path for locked accounts — support is the only reset
          mechanism today (there is no self-service password-reset route). */}
      {error && (
        <p className="mt-4 text-center text-xs text-slate-500">
          Locked out?{' '}
          <a
            href="mailto:support@compliverse.ai?subject=Account%20locked%20—%20password%20reset"
            className="font-semibold text-primary-700 hover:text-primary-800"
          >
            Reset your password
          </a>
        </p>
      )}

      {/* Legal only — the security claim that used to live here was marketing
          dressed as fine print, and is already made on the hero. */}
      <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
        By signing in you agree to our{' '}
        <a href="https://compliverse.ai/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-600">Terms</a>
        {' '}and{' '}
        <a href="https://compliverse.ai/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-600">Privacy Policy</a>.
        {' '}Trouble signing in?{' '}
        <a href="mailto:support@compliverse.ai" className="underline underline-offset-2 hover:text-slate-600">Contact support</a>
      </p>
    </AuthShell>
  );
}
