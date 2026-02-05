'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, LogIn, AlertCircle, Building2 } from 'lucide-react';

function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  
  // Check URL query param first (for links from registration)
  const urlParams = new URLSearchParams(window.location.search);
  const urlTenant = urlParams.get('tenant');
  if (urlTenant) {
    localStorage.setItem('tenant_slug', urlTenant);
    return urlTenant;
  }
  
  // Then check localStorage (persisted from previous session)
  return localStorage.getItem('tenant_slug');
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
      
      // Add tenant slug header if we have one
      if (tenantSlug) {
        headers['X-Tenant-Slug'] = tenantSlug;
      }
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: email, password }),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        
        // Store tenant info if returned (for organization users)
        if (data.tenant) {
          localStorage.setItem('tenant_slug', data.tenant.slug || '');
          localStorage.setItem('tenant_name', data.tenant.name || '');
          localStorage.setItem('tenant_id', String(data.tenant.id || ''));
        }
        
        router.push('/dashboard');
      } else {
        const data = await response.json();
        setError(data.detail || 'Invalid credentials');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const clearTenantContext = () => {
    localStorage.removeItem('tenant_slug');
    localStorage.removeItem('tenant_name');
    localStorage.removeItem('tenant_id');
    setTenantSlug(null);
    setTenantName(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">ComplyVerse</h1>
          <p className="mt-2 text-slate-400">Sign in to your account</p>
        </div>

        {tenantSlug && (
          <div className="mb-4 rounded-lg border border-primary-600/30 bg-primary-900/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary-400" />
                <div>
                  <p className="text-sm text-slate-400">Signing in to</p>
                  <p className="font-medium text-white">{tenantName || tenantSlug}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearTenantContext}
                className="text-xs text-slate-400 hover:text-white underline"
              >
                Switch org
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="card space-y-6">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-900/50 p-3 text-red-400">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
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
            <p className="text-slate-400">
              Don't have an account?{' '}
              <a href="/register" className="text-primary-400 hover:text-primary-300 font-medium">
                Register your organization
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
