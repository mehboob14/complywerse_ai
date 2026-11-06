import { NextRequest, NextResponse } from 'next/server';
import { backendGrcBase } from '@/lib/backendUrl';
import { proxyBody } from '@/lib/proxyReply';

export const maxDuration = 900;
export const dynamic = 'force-dynamic';

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

    // a plain-text error is not JSON: one plain sentence, the backend's status
    const data = proxyBody(await response.text(), 'The circular could not be analysed now. Try again in a minute.');

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
