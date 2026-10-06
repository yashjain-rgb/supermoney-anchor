
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import { Parser } from "json2csv";
import { getFirestore, FieldPath, type Firestore } from "firebase-admin/firestore";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

/**
 * Portal data lives in the named "live" database — this project has no
 * "(default)" database. The namespaced `admin.firestore(x)` API takes an App,
 * not a database id, so it cannot select a named database. Use the modular API.
 */
const LIVE_DATABASE_ID = "live";
const liveDb = (): Firestore => getFirestore(admin.app(), LIVE_DATABASE_ID);

/** Test-mode recipient: every report is redirected here. */
const TEST_RECIPIENT = "yash.jain@supermoney.in";

/** Every run is recorded here for auditability. Never gates a send. */
const RUN_LOG_COLLECTION = "misRunLog";

/**
 * SMTP credentials live in Secret Manager, not in the function's env. They must
 * be named in `runWith({ secrets })` or nodemailer starts with `user: undefined`
 * and every send fails auth. Both functions declare them.
 *
 * Only USER and PASS are listed: those carry an explicit
 * `secretmanager.secretAccessor` binding for the runtime SA. SMTP_HOST/SMTP_PORT
 * exist as secrets too but have no binding, and `roles/editor` does not include
 * `secretmanager.versions.access` — naming them here would fail at runtime.
 * Host/port are plain config, so they live as defaults in `buildTransporter`.
 */
const SMTP_SECRETS = ["SMTP_USER", "SMTP_PASS"];

/**
 * Dedicated credential for this endpoint, deliberately NOT `DEALER_API_SECRET_KEY`.
 * That key guards the seven Next.js API routes on the VM and is read from the VM's
 * `.env`; this one is read from Secret Manager by the Cloud Function only. Rotating
 * either must not disturb the other.
 */
const API_KEY_SECRET = "MIS_REPORT_API_KEY";

const buildTransporter = (): nodemailer.Transporter =>
  nodemailer.createTransport({
    // Defaults must match the value the app uses (smtp.gmail.com, NOT
    // smtp-relay.gmail.com — the relay needs IP allowlisting and will reject).
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

// Function to get all active anchor users
const getActiveAnchorUsers = async (db: Firestore) => {
  const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
  if (usersSnapshot.empty) {
    console.log("No active anchor users found.");
    return [];
  }
  return usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
};

// Function to get dealer data with comprehensive limit information
const getDealerDataForAnchor = async (db: Firestore, anchorId: string) => {
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
    const limitsSnapshot = await db.collection("dealerLimits").where(FieldPath.documentId(), 'in', chunk).get();
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

type RunMode = "api" | "test";
type SendOutcome = "sent" | "skipped";

interface RunOptions {
  mode: RunMode;
  /** Limit the run to a single anchor (matched against `users.externalId`). */
  anchorId?: string;
  /** Redirect delivery to the test address instead of real recipients. */
  testRecipient?: string;
}

interface RunSummary {
  mode: RunMode;
  scope: string;
  usersConsidered: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsFailed: number;
  note?: string;
}

/** The single MIS implementation — the trigger API calls this. Do not fork it. */
const runMISReport = async (options: RunOptions): Promise<RunSummary> => {
  const db = liveDb();
  const summary: RunSummary = {
    mode: options.mode,
    scope: options.anchorId ? `anchor:${options.anchorId}` : "all-anchors",
    usersConsidered: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    emailsFailed: 0,
  };

  const allUsers = await getActiveAnchorUsers(db);
  const users = options.anchorId
    ? allUsers.filter((u) => u.externalId === options.anchorId)
    : allUsers;

  summary.usersConsidered = users.length;

  if (users.length === 0) {
    summary.note = options.anchorId ? "anchor-not-found" : "no-anchor-users";
    await recordRun(db, summary);
    return summary;
  }

  const transporter = buildTransporter();

  for (const user of users) {
    // In test mode, deliver the first eligible anchor's report to the test address only.
    const recipient = options.testRecipient ? options.testRecipient : user.emailAddress;
    if (!recipient) {
      summary.emailsSkipped += 1;
      continue;
    }

    try {
      const outcome = await sendReportForAnchor(db, transporter, user, recipient);
      if (outcome === "sent") {
        summary.emailsSent += 1;
      } else {
        summary.emailsSkipped += 1;
      }
    } catch (emailError) {
      summary.emailsFailed += 1;
      console.error(`Failed to send email to ${user.emailAddress}:`, emailError);
    }

    if (options.testRecipient) break;
  }

  await recordRun(db, summary);
  return summary;
};

/** Best-effort audit record. A logging failure must never fail the run. */
const recordRun = async (db: Firestore, summary: RunSummary): Promise<void> => {
  try {
    await db.collection(RUN_LOG_COLLECTION).add({
      ...summary,
      triggeredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[mis] run-log write failed (report already processed)", error);
  }
};

/**
 * Builds and sends one anchor's report. ANC011 gets the full limit-utilization
 * view; every other anchor gets the overdue summary. Returns "skipped" when the
 * anchor has nothing to report.
 */
const sendReportForAnchor = async (
  db: Firestore,
  transporter: nodemailer.Transporter,
  user: any,
  recipient: string
): Promise<SendOutcome> => {
  const isANC011 = user.externalId === 'ANC011';
  const dealers = await getDealerDataForAnchor(db, user.externalId);

  if (isANC011) {
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
          <p style="font-size: 14px; margin-bottom: 0;">The attached CSV contains the Dealer Tab View for all dealers mapped to your account, providing a consolidated view of current limit utilization.</p>
        </div>
    `;

    await transporter.sendMail({
      from: `"Supermoney Platform" <noreply@supermoney.in>`,
      to: [recipient, 'channelfinance.in@redingtongroup.com'],
      subject: "Supermoney Daily Limit Utilization Summary",
      html: wrapEmailTemplate(content),
      attachments: [
        {
          filename: `Limit_Utilization_Report_${new Date().toISOString().split('T')[0]}.csv`,
          content: csv,
          contentType: 'text/csv'
        },
      ],
    });
    return "sent";
  }

  // Standard Overdue Report for other Anchors
  const overdueDealers = dealers.filter((d) => d.overdueAmount > 0);
  if (overdueDealers.length === 0) {
    return "skipped";
  }

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

  await transporter.sendMail({
    from: `"Supermoney Platform" <noreply@supermoney.in>`,
    to: recipient,
    subject: "Supermoney Daily Overdue Report",
    html: wrapEmailTemplate(content),
    attachments: [
      {
        filename: `Daily_Overdue_Report_${new Date().toISOString().split('T')[0]}.csv`,
        content: csv,
        contentType: 'text/csv'
      },
    ],
  });
  return "sent";
};

/**
 * Trigger API — call this whenever anchor data changes.
 *
 *   POST /sendDailyReports                       → all anchors
 *   POST /sendDailyReports?anchorId=ANC001       → only that anchor
 *   POST /sendDailyReports?test=true             → one report to TEST_RECIPIENT
 *   POST /sendDailyReports?test=true&anchorId=X  → that anchor's report, to TEST_RECIPIENT
 *
 * There is deliberately no schedule and no once-per-day guard: it sends exactly
 * when called, so the caller owns the frequency. To run it daily, point Cloud
 * Scheduler at this URL with an `Authorization: Bearer <key>` header rather than
 * adding a second sender here — two triggers would double-send.
 *
 * Requires `Authorization: Bearer <MIS_REPORT_API_KEY>`, held in Secret Manager.
 */
export const sendDailyReports = functions
  // asia-south1 (Mumbai) — R18. Without this the function defaults to
  // us-central1, which puts compute outside India and reads the Mumbai
  // Firestore cross-region. Deploying a new region does NOT move the old
  // function: a us-central1 `sendDailyReports` would remain and must be
  // deleted separately.
  .region('asia-south1')
  .runWith({
    timeoutSeconds: 540,
    memory: "512MB",
    secrets: [...SMTP_SECRETS, API_KEY_SECRET],
  })
  .https.onRequest(async (req, res) => {
    const expected = process.env[API_KEY_SECRET];
    if (!expected) {
      console.error(`[mis] ${API_KEY_SECRET} is not configured for this function`);
      res.status(503).send("Server not configured.");
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : header;
    if (token !== expected) {
      res.status(401).send("Unauthorized");
      return;
    }

    const isTest = req.query.test === "true";
    const anchorId = typeof req.query.anchorId === "string" ? req.query.anchorId : undefined;

    try {
      const summary = await runMISReport({
        mode: isTest ? "test" : "api",
        anchorId,
        testRecipient: isTest ? TEST_RECIPIENT : undefined,
      });
      console.log("[mis] api run complete", JSON.stringify(summary));
      res.status(200).json(summary);
    } catch (error) {
      console.error("[mis] api run failed", error);
      res.status(500).json({ error: "Report run failed. Check function logs." });
    }
  });
