"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDailyReports = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const json2csv_1 = require("json2csv");
const firestore_1 = require("firebase-admin/firestore");
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
const liveDb = () => (0, firestore_1.getFirestore)(admin.app(), LIVE_DATABASE_ID);
/** Test-mode recipient: every report is redirected here. */
const TEST_RECIPIENT = "yash.jain@supermoney.in";
/** Every run is recorded here for auditability. Never gates a send. */
const RUN_LOG_COLLECTION = "misRunLog";
/** ANC011's report also goes to their channel-finance mailbox. */
const ANC011_EXTRA_RECIPIENT = "channelfinance.in@redingtongroup.com";
/**
 * Dedicated credential for this endpoint, deliberately NOT `DEALER_API_SECRET_KEY`.
 * That key guards the seven Next.js API routes on the VM and is read from the VM's
 * `.env`; this one is read from Secret Manager by the Cloud Function only. Rotating
 * either must not disturb the other.
 */
const API_KEY_SECRET = "MIS_REPORT_API_KEY";
/**
 * Supermoney's internal mail service. Replaces SMTP delivery entirely, which
 * removes three problems at once: a stored mail password, the Gmail app-password
 * policy, and the static-egress-IP work (VPC connector + Cloud NAT) that an
 * IP-allowlisted SMTP relay would have required. Sender identity is the service's
 * concern, not ours — we no longer set a `from`.
 */
const EMAIL_API_URL = process.env.EMAIL_API_URL ||
    "https://live.supermoney.in/supermoney-service/email/send";
/** Bounds a single send so one hung request cannot consume the 540s budget. */
const EMAIL_TIMEOUT_MS = 30000;
/**
 * Sends one mail through the internal service.
 *
 * Contract notes, all verified against the live endpoint — the API is strict
 * about them and returns a bare 400 "Invalid Request" otherwise:
 *   - `multipart/form-data` only; a urlencoded body is rejected with 415.
 *   - `imageUrls` is MANDATORY ("ImageUrl list must not be empty"), so every
 *     send must carry its CSV. There is no attachment-less path.
 *   - `emailId` is singular, so one call delivers to exactly one recipient.
 *   - Success is HTTP 200 with `{"successFlag":true}`; a 200 is not sufficient
 *     on its own, so both are checked.
 */
const sendEmail = async (mail) => {
    const form = new FormData();
    form.append("subject", mail.subject);
    form.append("body", mail.body);
    form.append("emailId", mail.to);
    form.append("imageUrls", new Blob([mail.attachment.content], { type: mail.attachment.contentType }), mail.attachment.filename);
    const response = await fetch(EMAIL_API_URL, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`mail service returned HTTP ${response.status}`);
    }
    const result = (await response.json().catch(() => null));
    if (!(result === null || result === void 0 ? void 0 : result.successFlag)) {
        throw new Error("mail service did not confirm delivery");
    }
};
// Function to get all active anchor users
const getActiveAnchorUsers = async (db) => {
    const usersSnapshot = await db.collection("users").where("roleType", "==", "Anchor").get();
    if (usersSnapshot.empty) {
        console.log("No active anchor users found.");
        return [];
    }
    return usersSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
};
// Function to get dealer data with comprehensive limit information
const getDealerDataForAnchor = async (db, anchorId) => {
    const dealersSnapshot = await db.collection("dealers").where("anchorId", "==", anchorId).get();
    if (dealersSnapshot.empty) {
        return [];
    }
    const dealers = dealersSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
    const dealerIds = dealers.map(d => d.id);
    if (dealerIds.length === 0) {
        return [];
    }
    // Chunking logic to handle Firestore's limit for 'in' queries (max 30)
    const CHUNK_SIZE = 30;
    const allLimits = [];
    for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
        const chunk = dealerIds.slice(i, i + CHUNK_SIZE);
        const limitsSnapshot = await db.collection("dealerLimits").where(firestore_1.FieldPath.documentId(), 'in', chunk).get();
        limitsSnapshot.forEach(doc => {
            allLimits.push(Object.assign({ id: doc.id }, doc.data()));
        });
    }
    const limitsMap = new Map(allLimits.map(doc => [doc.id, doc]));
    return dealers.map(dealer => {
        const limit = limitsMap.get(dealer.id);
        return {
            dealerName: dealer.dealerName || 'N/A',
            sanctionedLimit: (limit === null || limit === void 0 ? void 0 : limit.limitAmount) || 0,
            utilizedLimit: (limit === null || limit === void 0 ? void 0 : limit.utilisationAmount) || 0,
            availableLimit: (limit === null || limit === void 0 ? void 0 : limit.availableAmount) || 0,
            overdueAmount: (limit === null || limit === void 0 ? void 0 : limit.principalOverdue) || 0,
            status: dealer.status || 'N/A'
        };
    });
};
/**
 * Plain-text body wrapper.
 *
 * The mail service does NOT render HTML — it delivers `body` verbatim, so any
 * tags sent here arrive as visible markup (verified against the live endpoint:
 * a body of `<h2>HTML check</h2>` was received by the recipient as exactly that
 * string). Everything below is therefore plain text. The branded logo, heading
 * colours and the button styling are gone as a result: the only way to keep them
 * would be to have the service render HTML, which it does not.
 */
const buildEmailBody = (content) => `${content}

This is an automated MIS report. For real-time updates, please login to the portal:
https://anchor.supermoney.in

Thank you,
The Supermoney Team`;
/** The single MIS implementation — the trigger API calls this. Do not fork it. */
const runMISReport = async (options) => {
    const db = liveDb();
    const summary = {
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
    for (const user of users) {
        // In test mode, deliver the first eligible anchor's report to the test address only.
        const recipient = options.testRecipient ? options.testRecipient : user.emailAddress;
        if (!recipient) {
            summary.emailsSkipped += 1;
            continue;
        }
        try {
            const outcome = await sendReportForAnchor(db, user, recipient, Boolean(options.testRecipient));
            if (outcome === "sent") {
                summary.emailsSent += 1;
            }
            else {
                summary.emailsSkipped += 1;
            }
        }
        catch (emailError) {
            summary.emailsFailed += 1;
            // Log the address the mail actually went to. In test mode that is the test
            // recipient, never the anchor — logging `user.emailAddress` here reads as
            // "we mailed this anchor" and misdirects debugging.
            console.error(`Failed to send report for ${user.externalId} to ${recipient}:`, emailError);
        }
        if (options.testRecipient)
            break;
    }
    await recordRun(db, summary);
    return summary;
};
/** Best-effort audit record. A logging failure must never fail the run. */
const recordRun = async (db, summary) => {
    try {
        await db.collection(RUN_LOG_COLLECTION).add(Object.assign(Object.assign({}, summary), { triggeredAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error("[mis] run-log write failed (report already processed)", error);
    }
};
/**
 * Builds and sends one anchor's report. ANC011 gets the full limit-utilization
 * view; every other anchor gets the overdue summary. Returns "skipped" when the
 * anchor has nothing to report.
 *
 * `isTest` suppresses every recipient except the one passed in — see below.
 */
const sendReportForAnchor = async (db, user, recipient, isTest = false) => {
    const isANC011 = user.externalId === 'ANC011';
    const dealers = await getDealerDataForAnchor(db, user.externalId);
    // The mail service accepts one `emailId` per request, so deliver per address.
    // ANC011's extra mailbox belongs to an EXTERNAL party (channel finance), so a
    // test run must never reach it: with `isTest` the report goes to the test
    // address and nowhere else. Real runs mail both, as before.
    const recipients = isANC011 && !isTest ? [recipient, ANC011_EXTRA_RECIPIENT] : [recipient];
    // Count only — addresses are PII and must not be logged. This is what makes
    // test mode checkable: it stays at 1 even for ANC011, instead of 2.
    console.log(`[mis] ${user.externalId}: sending to ${recipients.length} recipient(s)`);
    const reportDate = new Date().toISOString().split('T')[0];
    if (isANC011) {
        const csvFields = [
            { label: 'Dealer Name', value: 'dealerName' },
            { label: 'Sanctioned Limit', value: 'sanctionedLimit' },
            { label: 'Utilized Limit', value: 'utilizedLimit' },
            { label: 'Available Limit', value: 'availableLimit' },
            { label: 'Overdue Amount', value: 'overdueAmount' },
            { label: 'Status', value: 'status' }
        ];
        const json2csvParser = new json2csv_1.Parser({ fields: csvFields });
        const csv = json2csvParser.parse(dealers);
        const content = `Daily Limit Utilization Summary

Dear Team,

Please find below the Daily Limit Utilization Summary for ${user.userName}.

DAILY LIMIT UTILIZATION
The attached CSV contains the Dealer Tab View for all dealers mapped to your account, providing a consolidated view of current limit utilization.`;
        const body = buildEmailBody(content);
        for (const to of recipients) {
            await sendEmail({
                to,
                subject: "Supermoney Daily Limit Utilization Summary",
                body,
                attachment: {
                    filename: `Limit_Utilization_Report_${reportDate}.csv`,
                    content: csv,
                    contentType: "text/csv",
                },
            });
        }
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
    const json2csvParser = new json2csv_1.Parser({ fields: csvFields });
    const csv = json2csvParser.parse(overdueDealers);
    const content = `Daily Overdue Summary

Hello ${user.userName},

Here is your daily summary of outstanding payments from the Supermoney Anchor Platform.

OVERDUE SUMMARY
Total overdue amount: ${formattedAmount}
Number of dealers with overdue payments: ${overdueDealers.length}`;
    const body = buildEmailBody(content);
    for (const to of recipients) {
        await sendEmail({
            to,
            subject: "Supermoney Daily Overdue Report",
            body,
            attachment: {
                filename: `Daily_Overdue_Report_${reportDate}.csv`,
                content: csv,
                contentType: "text/csv",
            },
        });
    }
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
exports.sendDailyReports = functions
    // asia-south1 (Mumbai) — R18. Without this the function defaults to
    // us-central1, which puts compute outside India and reads the Mumbai
    // Firestore cross-region. Deploying a new region does NOT move the old
    // function: a us-central1 `sendDailyReports` would remain and must be
    // deleted separately.
    .region('asia-south1')
    .runWith({
    timeoutSeconds: 540,
    memory: "512MB",
    // SMTP_USER / SMTP_PASS are gone: delivery no longer uses SMTP, so the
    // function holds no mail credential at all.
    secrets: [API_KEY_SECRET],
})
    .https.onRequest(async (req, res) => {
    const expected = process.env[API_KEY_SECRET];
    if (!expected) {
        console.error(`[mis] ${API_KEY_SECRET} is not configured for this function`);
        res.status(503).send("Server not configured.");
        return;
    }
    const header = req.headers.authorization;
    const token = (header === null || header === void 0 ? void 0 : header.startsWith("Bearer ")) ? header.slice(7) : header;
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
    }
    catch (error) {
        console.error("[mis] api run failed", error);
        res.status(500).json({ error: "Report run failed. Check function logs." });
    }
});
//# sourceMappingURL=index.js.map