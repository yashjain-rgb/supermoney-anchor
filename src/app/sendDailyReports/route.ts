
import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import { Parser } from 'json2csv';

// This line prevents Next.js from trying to statically optimize this route during build
export const dynamic = 'force-dynamic';

/**
 * Standard email template wrapper with Supermoney branding.
 */
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

/**
 * Route Handler to handle GET requests for daily reports.
 */
export async function GET(request: Request) {
    return await validateAndProcess(request);
}

/**
 * Route Handler to handle POST requests for daily reports.
 */
export async function POST(request: Request) {
    return await validateAndProcess(request);
}

/**
 * Validates the Bearer token and triggers the report generation.
 */
async function validateAndProcess(request: Request) {
    const authHeader = request.headers.get('Authorization');
    const expectedToken = process.env.DEALER_API_SECRET_KEY;

    if (!expectedToken) {
        console.error("DEALER_API_SECRET_KEY is not set in environment variables.");
        return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    // Normalize the input token: Handle both "Bearer <token>" and raw token formats
    const inputToken = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

    if (inputToken !== expectedToken) {
        console.warn(`Unauthorized access attempt to daily reports. Token mismatch.`);
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return await processDailyReports();
}

/**
 * Core logic to generate and send daily MIS reports.
 */
async function processDailyReports() {
    console.log("Triggering Daily MIS Report via Route Handler...");

    // Get Project ID from environment
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    // Idempotent initialization of Firebase Admin SDK with explicit project discovery
    if (!admin.apps.length) {
        admin.initializeApp({
            projectId: projectId
        });
    }

    // Access the specialized "live" database instance correctly
    // We use the getter method to ensure scopes are refreshed per request
    const db = getFirestore("live");

    // Setup Nodemailer with environment variables
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp-relay.gmail.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
    });

    try {
        // 1. Get all active Anchor users
        const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
        if (usersSnapshot.empty) {
            console.log("No active anchor users found.");
            return NextResponse.json({ message: "No active anchor users found." }, { status: 200 });
        }

        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

        for (const user of users) {
            if (!user.emailAddress) continue;

            const isANC011 = user.externalId === 'ANC011';

            // 2. Fetch dealer data for the specific Anchor
            const dealersSnapshot = await db.collection("dealers").where("anchorId", "==", user.externalId).get();
            if (dealersSnapshot.empty) continue;

            const dealers = dealersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
            const dealerIds = dealers.map(d => d.id);

            // 3. Fetch limits in chunks (Firestore limit is 30 for 'in' queries)
            const CHUNK_SIZE = 30;
            const allLimits: any[] = [];
            for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
                const chunk = dealerIds.slice(i, i + CHUNK_SIZE);
                const limitsSnapshot = await db.collection("dealerLimits")
                    .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
                    .get();
                limitsSnapshot.forEach(doc => allLimits.push({ id: doc.id, ...doc.data() }));
            }
            const limitsMap = new Map(allLimits.map(doc => [doc.id, doc]));

            // 4. Map report data
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

            // 5. Send report based on Anchor ID
            try {
                if (isANC011) {
                    // Specialized MIS for Anchor ANC011
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
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Daily Limit Utilization Summary</h2>
                        <p>Dear Team,</p>
                        <p>Please find below the Daily Limit Utilization Summary for <strong>${user.userName}</strong>.</p>
                        <div style="background-color: #f9f9f9; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
                          <h3 style="margin-top: 0; color: #2c3e50;">📊 Daily Limit Utilization</h3>
                          <p style="font-size: 14px; margin-bottom: 0;">The attached CSV contains the Dealer Tab View for all dealers mapped to your account, providing a consolidated view of current limit utilization.</p>
                        </div>
                    `;

                    await transporter.sendMail({
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: [user.emailAddress, 'channelfinance.in@redingtongroup.com'],
                        subject: "Supermoney Daily Limit Utilization Summary",
                        html: wrapEmailTemplate(content),
                        attachments: [{
                            filename: `Limit_Utilization_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        }]
                    });
                } else {
                    // Standard Overdue Report
                    const overdueDealers = reportData.filter(d => d.overdueAmount > 0);
                    if (overdueDealers.length === 0) continue;

                    const totalOverdue = overdueDealers.reduce((sum, d) => sum + d.overdueAmount, 0);
                    const parser = new Parser({ fields: ["dealerName", "overdueAmount", "status"] });
                    const csv = parser.parse(overdueDealers);

                    const content = `
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Daily Overdue Summary</h2>
                        <p>Hello ${user.userName},</p>
                        <p>Here is your daily summary of outstanding payments from the Supermoney Anchor Platform.</p>
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #3498db; margin: 20px 0;">
                          <h3 style="margin-top: 0; color: #333;">Overdue Summary</h3>
                          <p>Total overdue amount: <strong>${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalOverdue)}</strong></p>
                        </div>
                    `;

                    await transporter.sendMail({
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: user.emailAddress,
                        subject: "Supermoney Daily Overdue Report",
                        html: wrapEmailTemplate(content),
                        attachments: [{
                            filename: `Daily_Overdue_Report_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        }]
                    });
                }
            } catch (err) {
                console.error(`Failed to send email to ${user.emailAddress}:`, err);
            }
        }

        return NextResponse.json({ message: "Daily reports process completed successfully." }, { status: 200 });

    } catch (error: any) {
        console.error("Critical error in reporting route:", error);
        return NextResponse.json({ error: error.message || "An internal error occurred." }, { status: 500 });
    }
}
