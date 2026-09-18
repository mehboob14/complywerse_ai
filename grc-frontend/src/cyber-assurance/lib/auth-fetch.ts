/**
 * Drop-in replacement for `fetch()` that attaches the Bearer token and
 * X-Tenant-Slug header from localStorage.
 *
 * Why this exists: browsers reject `Domain=localhost` cookies, so cross-
 * subdomain auth relies on Bearer tokens in localStorage. The axios client
 * already does this via an interceptor, but raw `fetch()` callers do not —
 * use this helper from any non-axios code path that needs auth.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const baseHeaders = new Headers(init.headers || {});

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token && !baseHeaders.has('Authorization')) {
      baseHeaders.set('Authorization', `Bearer ${token}`);
    }
    const tenantSlug = localStorage.getItem('tenant_slug');
    if (tenantSlug && !baseHeaders.has('X-Tenant-Slug')) {
      baseHeaders.set('X-Tenant-Slug', tenantSlug);
    }
  }

  return fetch(input, {
    credentials: 'include',
    ...init,
    headers: baseHeaders,
  });
}
