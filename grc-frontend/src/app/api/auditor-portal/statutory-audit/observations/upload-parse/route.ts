import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 900;
export const dynamic = 'force-dynamic';

/** Resolve backend base including /grc whether or not BACKEND_URL already has it. */
function backendGrcBase(): string {
  const raw = (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://127.0.0.1:4000/grc'
  ).replace(/\/$/, '');
  if (raw.endsWith('/grc')) return raw;
  return `${raw}/grc`;
}

/**
 * Long-running PDF text extraction + AI observation drafting. Next.js rewrite
 * proxy drops the connection (~30s socket hang up → HTTP 500). This App Router
 * proxy keeps the upstream fetch open for up to 15 minutes.
 */
export async function POST(request: NextRequest) {
  const backendUrl = `${backendGrcBase()}/auditor-portal/statutory-audit/observations/upload-parse`;

  try {
    const formData = await request.formData();
    const cookies = request.headers.get('cookie') || '';
    const authHeader =
      request.headers.get('authorization') ||
      request.headers.get('Authorization') ||
      '';
    const tenantSlug =
      request.headers.get('x-tenant-slug') ||
      request.headers.get('X-Tenant-Slug') ||
      '';

    const headers: Record<string, string> = {};
    if (cookies) headers.Cookie = cookies;
    if (authHeader) headers.Authorization = authHeader;
    if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900_000);

    console.log(`[Statutory Audit Upload-Parse] Proxying to ${backendUrl}`);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(backendUrl, {
        method: 'POST',
        body: formData,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(
      `[Statutory Audit Upload-Parse] Upstream ${response.status} in ${Date.now() - started}ms`,
    );

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = {
        detail: text.slice(0, 500) || `Upstream returned ${response.status}`,
      };
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    console.error('[Statutory Audit Upload-Parse] proxy error:', error);
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        {
          detail:
            'Request timed out while extracting observations. Try a smaller or text-based PDF, or register observations manually.',
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        detail: `AI import failed: ${err?.message || 'Unknown error'}. Ensure the backend is running.`,
      },
      { status: 502 },
    );
  }
}
