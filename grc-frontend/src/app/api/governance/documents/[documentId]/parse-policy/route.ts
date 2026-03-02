import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes (Vercel limit, but works for dev too)
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const documentId = params.documentId;
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:4000';
  
  console.log(`[Parse Policy API Route] Starting for document ${documentId}`);
  
  try {
    // Get cookies and headers from the request
    const cookie = request.headers.get('cookie') || '';
    const tenantSlug = request.headers.get('X-Tenant-Slug') || 
                       request.headers.get('x-tenant-slug') || '';
    
    console.log(`[Parse Policy API Route] Tenant slug: ${tenantSlug}`);
    console.log(`[Parse Policy API Route] Backend URL: ${backendUrl}/grc/governance/documents/${documentId}/parse-policy`);
    
    // Forward the request to the backend with extended timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[Parse Policy API Route] Request timeout after 15 minutes`);
      controller.abort();
    }, 900000); // 15 minutes
    
    const startTime = Date.now();
    const response = await fetch(
      `${backendUrl}/grc/governance/documents/${documentId}/parse-policy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie,
          'X-Tenant-Slug': tenantSlug,
        },
        signal: controller.signal,
      }
    );
    
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    console.log(`[Parse Policy API Route] Request completed in ${duration}ms with status ${response.status}`);
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[Parse Policy API Route] Backend error:`, data);
      return NextResponse.json(data, { status: response.status });
    }
    
    console.log(`[Parse Policy API Route] Success - extracted ${data.total_statements} statements`);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Policy parsing proxy error:', error);
    
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { detail: 'Request timeout - document parsing took too long' },
        { status: 504 }
      );
    }
    
    return NextResponse.json(
      { detail: error.message || 'Failed to parse policy document' },
      { status: 500 }
    );
  }
}
