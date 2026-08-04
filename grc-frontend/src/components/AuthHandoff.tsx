'use client';

import { useEffect } from 'react';

/**
 * Reads auth context from the URL fragment on first mount, hydrates
 * localStorage on this origin, and strips the fragment from the URL.
 *
 * Used by the cross-subdomain login redirect: when the user logs in at
 * `<any>.localhost/login` and the authenticated tenant is `<other>`, the
 * login page redirects to `<other>.localhost/dashboard#auth_token=…&...`.
 * Because each subdomain has its own localStorage, the destination needs
 * the token + tenant info handed over via the URL. We use a fragment so
 * the token never reaches the server (no access-log leak, no proxy cache).
 */
export default function AuthHandoff() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const token = params.get('auth_token');
    if (!token) return;

    // Hydrate localStorage on this origin.
    localStorage.setItem('token', token);
    const slug = params.get('tenant_slug');
    if (slug) localStorage.setItem('tenant_slug', slug);
    const sub = params.get('tenant_subdomain');
    if (sub) localStorage.setItem('tenant_subdomain', sub);
    const name = params.get('tenant_name');
    if (name) localStorage.setItem('tenant_name', name);
    const id = params.get('tenant_id');
    if (id) localStorage.setItem('tenant_id', id);

    // Strip the fragment from the URL so the token doesn't sit in the
    // address bar or get copy-pasted into bookmarks. This uses
    // history.replaceState so it doesn't trigger a navigation.
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', cleanUrl);
  }, []);

  return null;
}
