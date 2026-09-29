import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession();

  if (!session || session.roleType !== 'Admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isTest = searchParams.get('test') === 'true';
  
  const token = process.env.DEALER_API_SECRET_KEY;
  // Use internal communication if possible, but standard fetch to the public URL is safer for testing App Hosting rewrites
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://anchor.supermoney.in';
  
  try {
    const triggerUrl = `${baseUrl}/sendDailyReports?test=${isTest}`;
    console.log(`Internal task runner calling: ${triggerUrl}`);

    const response = await fetch(triggerUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json({ 
            error: data.error || "Execution failed", 
            details: data.details || "Check server logs for Permission Denied errors.",
            status: response.status 
        }, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
    
  } catch (error: any) {
    console.error("Internal task runner crash:", error);
    return NextResponse.json({ error: "Failed to connect to trigger route.", details: error.message }, { status: 500 });
  }
}