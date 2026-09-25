
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import { Parser } from "json2csv";

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
db.settings({ databaseId: "live" });

// Nodemailer transporter setup
let transporter: nodemailer.Transporter;

// Function to get all active users
const getActiveUsers = async () => {
  const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
  if (usersSnapshot.empty) {
    console.log("No active anchor users found.");
    return [];
  }
  return usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
};

// Function to get dealer data for a specific anchor
const getDealerDataForAnchor = async (anchorId: string) => {
  const dealersSnapshot = await db.collection("dealers").where("anchorId", "==", anchorId).get();
  if (dealersSnapshot.empty) {
    return [];
  }
  const dealers = dealersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
  
  // Fetch limits for these dealers
  const dealerIds = dealers.map(d => d.id);
  if (dealerIds.length === 0) {
      return [];
  }

  // Chunking logic to handle Firestore's 30-item limit for 'in' queries
  const CHUNK_SIZE = 30;
  const dealerIdChunks = [];
  for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
      dealerIdChunks.push(dealerIds.slice(i, i + CHUNK_SIZE));
  }

  const allLimits: admin.firestore.DocumentData[] = [];
  for (const chunk of dealerIdChunks) {
      const limitsSnapshot = await db.collection("dealerLimits").where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
      limitsSnapshot.forEach(doc => {
          allLimits.push({ id: doc.id, ...doc.data() });
      });
  }

  const limitsMap = new Map(allLimits.map(doc => [doc.id, doc]));

  return dealers.map(dealer => {
      const limit = limitsMap.get(dealer.id);
      return {
          ...dealer,
          sanctionedLimit: limit?.limitAmount || 0,
          utilizedLimit: limit?.utilisationAmount || 0,
          availableLimit: limit?.availableAmount || 0,
          overdueAmount: limit?.principalOverdue || 0,
      };
  });
};

// Function to generate email body for standard reports
const generateEmailBody = (userName: string, overdueAmount: number, overdueCount: number) => {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(overdueAmount);

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Supermoney Daily Summary</h2>
      <p>Hello ${userName},</p>
      <p>Here is your daily summary from the Supermoney Anchor Platform.</p>
      <div style="background-color: #f2f2f2; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Overdue Summary</h3>
        <p>Total overdue amount: <strong>${formattedAmount}</strong></p>
        <p>Number of dealers with overdue payments: <strong>${overdueCount}</strong></p>
      </div>
      <p>For more details, please visit your dashboard:</p>
      <a href="https://anchor.supermoney.in" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Dashboard</a>
      <p style="margin-top: 30px;">Thank you,</p>
      <p><strong>The Supermoney Team</strong></p>
    </div>
  `;
};

// Function to generate specialized email body for ANC011
const generateANC011EmailBody = (anchorId: string) => {
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://www.supermoney.in/supermoney-powerd-logo.png" alt="Supermoney Logo" style="width: 150px; height: auto;">
      </div>
      
      <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Supermoney Daily Limit Utilization Summary</h2>
      
      <p>Dear Team,</p>
      <p>Please find below the Daily Limit Utilization Summary for Anchor ID <strong>${anchorId}</strong>.</p>
      
      <div style="background-color: #f9f9f9; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #2c3e50;">📊 Daily Limit Utilization</h3>
        <p style="font-size: 14px; margin-bottom: 0;">The attached CSV contains the Dealer Tab View for all dealers mapped to this Anchor, providing a consolidated view of their current limit utilization.</p>
      </div>
      
      <div style="margin: 20px 0;">
        <p style="font-weight: bold; margin-bottom: 10px;">The report includes:</p>
        <ul style="margin-top: 0; padding-left: 20px;">
          <li>Dealer-wise sanctioned limit</li>
          <li>Utilized Limit</li>
          <li>Available Limit</li>
          <li>Overdue Amount</li>
        </ul>
      </div>

      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #7f8c8d;">This is an automated MIS report. For real-time updates, please login to the portal.</p>
        <a href="https://anchor.supermoney.in" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Login to Portal</a>
      </div>

      <p style="margin-top: 30px; font-size: 14px;">Thank you,<br><strong>The Supermoney Team</strong></p>
    </div>
    `;
};

// Main function to be triggered by Cloud Scheduler
export const sendDailyReports = functions
  .https.onRequest(async (req, res) => {
    // Initialize transporter for passwordless SMTP relay
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp-relay.gmail.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
    });

    try {
        const users = await getActiveUsers();

        for (const user of users) {
        if (!user.emailAddress) {
            console.log(`User ${user.userName} has no email address, skipping.`);
            continue;
        }
        
        const isANC011 = user.externalId === 'ANC011';
        const dealers = await getDealerDataForAnchor(user.externalId);
        
        const logData: any = {
            userId: user.id,
            userName: user.userName,
            email: user.emailAddress,
            sentAt: new Date(),
        };

        try {
            let mailOptions: nodemailer.SendMailOptions;

            if (isANC011) {
                // Specialized MIS for ANC011
                const csvFields = [
                    { label: 'Dealer Name', value: 'dealerName' },
                    { label: 'Sanctioned Limit', value: 'sanctionedLimit' },
                    { label: 'Utilized Limit', value: 'utilizedLimit' },
                    { label: 'Available Limit', value: 'availableLimit' },
                    { label: 'Overdue Amount', value: 'overdueAmount' },
                    { label: 'Status', value: 'status' }
                ];
                const json2csvParser = new Parser({ fields: csvFields });
                const csv = json2csvParser.parse(dealers);

                mailOptions = {
                    from: `"Supermoney Platform" <noreply@supermoney.in>`,
                    to: [user.emailAddress, 'channelfinance.in@redingtongroup.com'],
                    subject: "Supermoney Daily Limit Utilzation Summary",
                    html: generateANC011EmailBody(user.externalId),
                    attachments: [
                        {
                            filename: `Limit_Utilization_Report_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        },
                    ],
                };
            } else {
                // Standard Overdue Report
                const overdueDealers = dealers.filter((d) => d.overdueAmount > 0);
                const totalOverdueAmount = overdueDealers.reduce((sum, d) => sum + d.overdueAmount, 0);

                const csvFields = ["dealerName", "overdueAmount", "status"];
                const json2csvParser = new Parser({ fields: csvFields });
                const csv = json2csvParser.parse(overdueDealers);
                
                mailOptions = {
                    from: `"Supermoney Platform" <noreply@supermoney.in>`,
                    to: user.emailAddress,
                    subject: "Supermoney Daily Dashboard Summary & Dealer Report",
                    html: generateEmailBody(user.userName, totalOverdueAmount, overdueDealers.length),
                    attachments: [
                        {
                            filename: `Daily_Overdue_Report_${new Date().toISOString().split('T')[0]}.csv`,
                            content: csv,
                            contentType: 'text/csv'
                        },
                    ],
                };
            }
            
            await transporter.sendMail(mailOptions);
            console.log(`Email sent successfully for ${user.emailAddress}`);
            logData.status = 'Success';

        } catch (emailError) {
            console.error(`Failed to send email to ${user.emailAddress}:`, emailError);
            logData.status = 'Failure';
            logData.error = (emailError as Error).message;
        }

        await db.collection("email_logs").add(logData);
        }
        
        res.status(200).send("Daily reports process completed successfully.");

    } catch (error) {
        console.error("Error in sendDailyReports function:", error);
        res.status(500).send("An internal error occurred.");
    }
});
