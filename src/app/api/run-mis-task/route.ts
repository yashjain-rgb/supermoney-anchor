import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession();

  if (!session || session.roleType !== 'Admin') {
    return NextResponse.json({ error: "Unauthorized", details: "Admin role required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isTest = searchParams.get('test') === 'true';
  
  const token = process.env.DEALER_API_SECRET_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://anchor.supermoney.in';
  
  if (!token) {
    return NextResponse.json({ error: "Configuration Error", details: "DEALER_API_SECRET_KEY is missing." }, { status: 500 });
  }

  try {
    const triggerUrl = `${baseUrl}/sendDailyReports?test=${isTest}`;
    console.log(`Triggering MIS task: ${triggerUrl}`);

    const response = await fetch(triggerUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Cache-Control': 'no-cache'
        }
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = { error: "Non-JSON Response", details: text.substring(0, 300) };
    }

    if (!response.ok) {
        return NextResponse.json({ 
            error: data.error || "Internal Server Error", 
            details: data.details || `Server returned ${response.status}: ${text.substring(0, 100)}`,
            status: response.status 
        }, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
    
  } catch (error: any) {
    console.error("MIS Task Runner Error:", error);
    return NextResponse.json({ error: "Connection Error", details: error.message }, { status: 500 });
  }
}
