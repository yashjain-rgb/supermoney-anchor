
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import { Parser } from "json2csv";

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
db.settings({ databaseId: "live" });

// Nodemailer transporter setup (Passwordless approach)
let transporter: nodemailer.Transporter;

// Function to get all active anchor users
const getActiveAnchorUsers = async () => {
  const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
  if (usersSnapshot.empty) {
    console.log("No active anchor users found.");
    return [];
  }
  return usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
};

// Function to get dealer data with comprehensive limit information
const getDealerDataForAnchor = async (anchorId: string) => {
  const dealersSnapshot = await db.collection("dealers").where("anchorId", "==", anchorId).get();
  if (dealersSnapshot.empty) {
    return [];
  }
  const dealers = dealersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
  
  const dealerIds = dealers.map(d => d.id);
  if (dealerIds.length === 0) {
      return [];
  }

  // Chunking logic to handle Firestore's limit for 'in' queries (max 30)
  const CHUNK_SIZE = 30;
  const allLimits: any[] = [];
  for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
      const chunk = dealerIds.slice(i, i + CHUNK_SIZE);
      const limitsSnapshot = await db.collection("dealerLimits").where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
      limitsSnapshot.forEach(doc => {
          allLimits.push({ id: doc.id, ...doc.data() });
      });
  }

  const limitsMap = new Map(allLimits.map(doc => [doc.id, doc]));

  return dealers.map(dealer => {
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
};

// Common Email Wrapper Template with Supermoney Branding
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

// Main function to be triggered by Cloud Scheduler
export const sendDailyReports = functions
  .https.onRequest(async (req, res) => {
    // Initialize transporter for passwordless SMTP relay
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp-relay.gmail.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465, // false for 587 (STARTTLS)
    });

    try {
        const users = await getActiveAnchorUsers();

        for (const user of users) {
            if (!user.emailAddress) continue;
            
            const isANC011 = user.externalId === 'ANC011';
            const dealers = await getDealerDataForAnchor(user.externalId);
            
            const logData: any = {
                userId: user.id,
                userName: user.userName,
                email: user.emailAddress,
                sentAt: new Date(),
                anchorId: user.externalId
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

                    const content = `
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Daily Limit Utilization Summary</h2>
                        <p>Dear Team,</p>
                        <p>Please find below the Daily Limit Utilization Summary for <strong>${user.userName}</strong>.</p>
                        
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
                    `;

                    mailOptions = {
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: [user.emailAddress, 'channelfinance.in@redingtongroup.com'],
                        subject: "Supermoney Daily Limit Utilzation Summary",
                        html: wrapEmailTemplate(content),
                        attachments: [
                            {
                                filename: `Limit_Utilization_Report_${new Date().toISOString().split('T')[0]}.csv`,
                                content: csv,
                                contentType: 'text/csv'
                            },
                        ],
                    };
                } else {
                    // Standard Overdue Report for other Anchors
                    const overdueDealers = dealers.filter((d) => d.overdueAmount > 0);
                    if (overdueDealers.length === 0) continue; 

                    const totalOverdueAmount = overdueDealers.reduce((sum, d) => sum + d.overdueAmount, 0);
                    const formattedAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalOverdueAmount);

                    const csvFields = ["dealerName", "overdueAmount", "status"];
                    const json2csvParser = new Parser({ fields: csvFields });
                    const csv = json2csvParser.parse(overdueDealers);

                    const content = `
                        <h2 style="color: #3498db; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Daily Overdue Summary</h2>
                        <p>Hello ${user.userName},</p>
                        <p>Here is your daily summary of outstanding payments from the Supermoney Anchor Platform.</p>
                        
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #3498db; margin: 20px 0;">
                          <h3 style="margin-top: 0; color: #333;">Overdue Summary</h3>
                          <p>Total overdue amount: <strong>${formattedAmount}</strong></p>
                          <p>Number of dealers with overdue payments: <strong>${overdueDealers.length}</strong></p>
                        </div>
                    `;
                    
                    mailOptions = {
                        from: `"Supermoney Platform" <noreply@supermoney.in>`,
                        to: user.emailAddress,
                        subject: "Supermoney Daily Overdue Report",
                        html: wrapEmailTemplate(content),
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
