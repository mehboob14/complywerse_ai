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
 * Long-running OCR + AI impact analysis. Next.js rewrite proxy drops the
 * connection (~30s socket hang up → HTTP 500). This App Router proxy keeps
 * the upstream fetch open for up to 15 minutes.
 */
export async function POST(request: NextRequest) {
  const backendUrl = `${backendGrcBase()}/governance/regulatory-changes/changes/upload`;

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

    console.log(`[Regulatory Upload] Proxying to ${backendUrl}`);
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
      `[Regulatory Upload] Upstream ${response.status} in ${Date.now() - started}ms`,
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
    console.error('[Regulatory Upload] proxy error:', error);
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        {
          detail:
            'Request timed out while analyzing the circular. Try again, or upload a text-based PDF.',
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        detail: `Upload failed: ${err?.message || 'Unknown error'}. Ensure the backend is running.`,
      },
      { status: 500 },
    );
  }
}
