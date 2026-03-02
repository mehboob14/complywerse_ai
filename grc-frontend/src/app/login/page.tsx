'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, LogIn, AlertCircle, Building2 } from 'lucide-react';

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
        
        // CRITICAL: Clear ALL previous localStorage to prevent cross-tenant data leakage
        localStorage.clear();
        
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
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
            <Shield className="h-10 w-10 text-primary-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">ComplyVerse</h1>
          <p className="mt-2 text-slate-500">Sign in to your account</p>
        </div>

        {tenantSlug && (
          <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary-600" />
                <div>
                  <p className="text-sm text-slate-500">Signing in to</p>
                  <p className="font-medium text-slate-800">{tenantName || tenantSlug}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearTenantContext}
                className="text-xs text-primary-600 hover:text-primary-700 underline"
              >
                Switch company
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-8 shadow-card space-y-6">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-700">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <>
                <LogIn size={18} />
                Sign in
              </>
            )}
          </button>

          <div className="mt-6 text-center">
            <p className="text-slate-500">
              Don&apos;t have an account?{' '}
              <a href="/register" className="text-primary-600 hover:text-primary-700 font-medium">
                Register your company
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
