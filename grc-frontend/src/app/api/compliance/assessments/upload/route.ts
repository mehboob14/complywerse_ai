import { NextRequest, NextResponse } from 'next/server';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const cookies = request.headers.get('cookie') || '';
    const authHeader = request.headers.get('authorization') || '';
    
    const headers: Record<string, string> = {};
    if (cookies) headers['Cookie'] = cookies;
    if (authHeader) headers['Authorization'] = authHeader;
    
    const response = await fetch(`${BACKEND_URL}/grc/compliance/assessments/upload`, {
      method: 'POST',
      body: formData,
      headers,
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Assessment upload proxy error:', error);
    return NextResponse.json(
      { detail: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
