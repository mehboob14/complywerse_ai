import { NextRequest, NextResponse } from 'next/server';
import { backendGrcBase } from '@/lib/backendUrl';
import { proxyBody } from '@/lib/proxyReply';

const FAILURE = 'The statements could not be read now. Try again in a minute.';

export const maxDuration = 300; // 5 minutes (Vercel limit, but works for dev too)
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const documentId = params.documentId;
  const backendUrl = backendGrcBase();

  try {
    // Get cookies and headers from the request
    const cookie = request.headers.get('cookie') || '';
    const tenantSlug = request.headers.get('X-Tenant-Slug') ||
                       request.headers.get('x-tenant-slug') || '';
    // Forward the Authorization header — Bearer auth is the primary token
    // path because browsers reject `Domain=localhost` cookies. Without this
    // line every request through this custom proxy 401s.
    const authorization = request.headers.get('authorization') ||
                          request.headers.get('Authorization') || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 minutes

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'X-Tenant-Slug': tenantSlug,
    };
    if (authorization) headers['Authorization'] = authorization;

    const response = await fetch(
      `${backendUrl}/governance/documents/${documentId}/parse-policy`,
      {
        method: 'POST',
        headers,
        signal: controller.signal,
      }
    );
    
    clearTimeout(timeoutId);
    // a plain-text error (the backend's "Internal Server Error") is not JSON: one plain sentence, the backend's status
    const data = proxyBody(await response.text(), FAILURE);
    if (!response.ok) console.error(`[Parse Policy API Route] Backend error ${response.status}:`, data);
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('Policy parsing proxy error:', error);
    
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { detail: 'Request timeout - document parsing took too long' },
        { status: 504 }
      );
    }
    
    return NextResponse.json({ detail: FAILURE }, { status: 502 });   // the backend could not be reached
  }
}
