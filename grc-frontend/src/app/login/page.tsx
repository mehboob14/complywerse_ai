'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Building2, Lock } from 'lucide-react';

function getTenantSlugFromHost(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return null;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    const slug = getTenantSlug();
    setTenantSlug(slug);
    const name = localStorage.getItem('tenant_name');
    setTenantName(name);
  }, [searchParams]);

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
        
        if (data.tenant) {
          localStorage.setItem('tenant_slug', data.tenant.slug || data.tenant.subdomain || '');
          localStorage.setItem('tenant_name', data.tenant.name || '');
          localStorage.setItem('tenant_id', String(data.tenant.id || ''));
        }
        
        router.push('/dashboard');
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

          {/* Microsoft SSO — locked */}
          <button
            type="button"
            disabled
            title="Microsoft SSO coming soon. Contact support to enable."
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-500 cursor-not-allowed opacity-60 mb-5"
          >
            {/* Official Microsoft logo SVG */}
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

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[11px] text-slate-400 font-medium">or sign in with email</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
            <span
              title="Registration is currently restricted."
              className="text-slate-400 cursor-not-allowed line-through"
            >
              Register your company
            </span>
            {' '}&mdash; contact{' '}
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
