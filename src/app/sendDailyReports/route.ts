import { NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import { Parser } from 'json2csv';

export const dynamic = 'force-dynamic';

const wrapEmailTemplate = (content: string) => `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://www.supermoney.in/supermoney-powerd-logo.png" alt="Supermoney Logo" style="width: 150px; height: auto;">
      </div>
      ${content}
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #7f8c8d;">This is an automated MIS report. For real-time updates, please login to the portal.</p>
        <a href="https://anchor.supermoney.in" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Login to Portal</a>
      </div>
      <p style="margin-top: 30px; font-size: 14px;">Thank you,<br><strong>The Supermoney Team</strong></p>
    </div>
`;

export async function GET(request: Request) {
    return await validateAndProcess(request);
}

export async function POST(request: Request) {
    return await validateAndProcess(request);
}

async function validateAndProcess(request: Request) {
    const authHeader = request.headers.get('Authorization');
    const expectedToken = process.env.DEALER_API_SECRET_KEY;

    if (!expectedToken) {
        return NextResponse.json({ error: "Execution Error", details: "DEALER_API_SECRET_KEY is not set in environment variables." }, { status: 500 });
    }

    const inputToken = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

    if (inputToken !== expectedToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const isTest = searchParams.get('test') === 'true';

    return await processDailyReports(isTest);
}

async function processDailyReports(isTest: boolean = false) {
    try {
        // Force initialize with specific project ID to ensure scope discovery for named databases
        if (getApps().length === 0) {
            initializeApp({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'anchorlink-g5wbd'
            });
        }

        // Modular Firestore call is required for named databases in v12+
        const db = getFirestore("live");

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp-relay.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            }
        });

        const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
        if (usersSnapshot.empty) {
            return NextResponse.json({ message: "No active anchor users found." }, { status: 200 });
        }

        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

        for (const user of users) {
            if (!user.emailAddress) continue;

            const isANC011 = user.externalId === 'ANC011';
            const dealersSnapshot = await db.collection("dealers").where("anchorId", "==", user.externalId).get();
            
            if (dealersSnapshot.empty && !isTest) continue;

            const dealers = dealersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
            const dealerIds = dealers.map(d => d.id);

            const allLimits: any[] = [];
            if (dealerIds.length > 0) {
                const CHUNK_SIZE = 30;
                for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
                    const chunk = dealerIds.slice(i, i + CHUNK_SIZE);
                    const limitsSnapshot = await db.collection("dealerLimits")
                        .where('__name__', 'in', chunk)
                        .get();
                    limitsSnapshot.forEach(doc => allLimits.push({ id: doc.id, ...doc.data() }));
                }
            }
            const limitsMap = new Map(allLimits.map(doc => [doc.id, doc]));

            const reportData = dealers.map(dealer => {
                const limit = limitsMap.get(dealer.id);
                return {
                    dealerName: dealer.dealerName || 'N/A',
                    sanctionedLimit: limit?.limitAmount || 0,
                    utilizedLimit: limit?.utilisationAmount || 0,
                    availableLimit: limit?.availableAmount || 0,
                    overdueAmount: limit?.principalOverdue || 0,
                    status: dealer.status || 'N/A'
                };
            });

            let recipients = isTest ? ['yash.jain@supermoney.in'] : [user.emailAddress];
            
            if (isANC011 && !isTest) {
                recipients.push('channelfinance.in@redingtongroup.com');
            }

            try {
                if (isANC011) {
                    const csvFields = [
                        { label: 'Dealer Name', value: 'dealerName' },
                        { label: 'Sanctioned Limit', value: 'sanctionedLimit' },
                        { label: 'Utilized Limit', value: 'utilizedLimit' },
                        { label: 'Available Limit', value: 'availableLimit' },
                        { label: 'Overdue Amount', value: 'overdueAmount' },
                        { label: 'Status', value: 'status' }
                    ];
                    const parser = new Parser({ fields: csvFields });
                    const csv = parser.parse(reportData);

                    const content = `
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">${isTest ? '[TEST] ' : ''}Daily Limit Utilization Summary</h2>
                        <p>Dear Team,</p>
                        <p>Please find below the Daily Limit Utilization Summary for <strong>${user.userName}</strong>.</p>
                    `;

                    await transporter.sendMail({
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: recipients,
                        subject: `${isTest ? '[TEST] ' : ''}Supermoney Daily Limit Utilization Summary - ${user.userName}`,
                        html: wrapEmailTemplate(content),
                        attachments: [{
                            filename: `Limit_Utilization_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        }]
                    });
                } else {
                    const overdueDealers = reportData.filter(d => d.overdueAmount > 0);
                    if (overdueDealers.length === 0 && !isTest) continue;

                    const totalOverdue = overdueDealers.reduce((sum, d) => sum + d.overdueAmount, 0);
                    const parser = new Parser({ fields: ["dealerName", "overdueAmount", "status"] });
                    const csv = parser.parse(overdueDealers);

                    const content = `
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">${isTest ? '[TEST] ' : ''}Daily Overdue Summary</h2>
                        <p>Hello ${user.userName},</p>
                        <p>Here is your daily summary of outstanding payments from the Supermoney Anchor Platform.</p>
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #3498db; margin: 20px 0;">
                          <h3 style="margin-top: 0; color: #333;">Overdue Summary</h3>
                          <p>Total overdue amount: <strong>${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalOverdue)}</strong></p>
                        </div>
                    `;

                    await transporter.sendMail({
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: recipients,
                        subject: `${isTest ? '[TEST] ' : ''}Supermoney Daily Overdue Report - ${user.userName}`,
                        html: wrapEmailTemplate(content),
                        attachments: [{
                            filename: `Daily_Overdue_Report_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        }]
                    });
                }

                if (isTest) {
                    return NextResponse.json({ message: "Test MIS report sent to yash.jain@supermoney.in" }, { status: 200 });
                }

            } catch (err: any) {
                console.error(`Email attempt failed:`, err);
                if (isTest) throw err;
            }
        }

        return NextResponse.json({ message: "Daily reports process completed successfully." }, { status: 200 });

    } catch (error: any) {
        console.error("Critical error in reporting route:", error);
        return NextResponse.json({ 
            error: "Execution Error", 
            details: error.message,
            stack: error.stack,
            code: error.code 
        }, { status: 500 });
    }
}