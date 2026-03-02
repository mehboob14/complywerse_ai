import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const cookies = request.headers.get('cookie') || '';
    const authHeader = request.headers.get('authorization') || '';
    
    const headers: Record<string, string> = {};
    if (cookies) headers['Cookie'] = cookies;
    if (authHeader) headers['Authorization'] = authHeader;
    
    const backendUrl = `${BACKEND_URL}/grc/compliance/assessments/upload`;
    console.log(`[Assessment Upload] Attempting to connect to: ${backendUrl}`);
    
    const response = await fetch(backendUrl, {
      method: 'POST',
      body: formData,
      headers,
    });
    
    let data: any;
    const contentType = response.headers.get('content-type');
    
    try {
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error('Non-JSON response from backend:', text);
        data = { detail: `Backend returned non-JSON response: ${text.substring(0, 200)}` };
      }
    } catch (parseError) {
      console.error('Failed to parse response:', parseError);
      data = { detail: 'Failed to parse server response' };
    }
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Assessment upload proxy error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Backend URL attempted: ${BACKEND_URL}/grc/compliance/assessments/upload`);
    return NextResponse.json(
      { detail: `Upload failed: ${errorMessage}. Ensure backend is running on ${BACKEND_URL}` },
      { status: 500 }
    );
  }
}
