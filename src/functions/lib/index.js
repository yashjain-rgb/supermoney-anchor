"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOverdueReports = exports.sendLimitReports = void 0;
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
/**
 * The address every test/dev run is redirected to. Hardcoded deliberately —
 * these are the only two reports that mail anyone, and neither should be able
 * to reach a real Anchor until it has been signed off.
 */
const TEST_RECIPIENT = "yash.jain@supermoney.in";
/** Every run is recorded here for auditability. Never gates a send. */
const RUN_LOG_COLLECTION = "misRunLog";
/** The Anchor whose limit report has an extra group recipient. */
const ANC011_EXTERNAL_ID = "ANC011";
/**
 * ANC011's limit report also goes to Reddington's channel-financing group.
 *
 * This is a property of THAT ANCHOR, not of the report type — so it stays keyed
 * on `externalId`, and test mode suppresses it entirely like every other
 * recipient.
 *
 * It is a `supermoney.in` group, not the external `redingtongroup.com` mailbox
 * it replaced: mail about ANC011 now stays inside the organisation.
 */
const ANC011_EXTRA_RECIPIENT = "reddingtonchannelfinancing@supermoney.in";
/**
 * Dedicated credential for both endpoints, deliberately NOT `DEALER_API_SECRET_KEY`.
 * That key guards the seven Next.js API routes on the VM and is read from the VM's
 * `.env`; this one is read from Secret Manager by these functions only. Rotating
 * either must not disturb the other. Both functions share it by design — one
 * credential covers the whole MIS surface, so rotating it is a single operation.
 */
const API_KEY_SECRET = "MIS_REPORT_API_KEY";
const PORTAL_URL = "https://anchor.supermoney.in/";
/**
 * Supermoney's internal mail service. Replaces SMTP delivery entirely, which
 * removes three problems at once: a stored mail password, the Gmail app-password
 * policy, and the static-egress-IP work (VPC connector + Cloud NAT) that an
 * IP-allowlisted SMTP relay would have required. Sender identity — including the
 * signature and logo — is the service's concern, not ours; we set no `from`.
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
/**
 * Resolves a single Anchor by `externalId`. Filtered on one field only, so it
 * needs no composite index; `roleType` is checked in code.
 */
const getAnchorByExternalId = async (db, anchorId) => {
    const snapshot = await db
        .collection("users")
        .where("externalId", "==", anchorId)
        .limit(10)
        .get();
    const doc = snapshot.docs.find((d) => d.data().roleType === "Anchor");
    return doc ? Object.assign({ id: doc.id }, doc.data()) : null;
};
/** Dealer rows with their limit figures, scoped to one Anchor. */
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
 * Plain-text body footer.
 *
 * The mail service does NOT render HTML — it delivers `body` verbatim, so any
 * tags sent here arrive as visible markup (verified against the live endpoint:
 * a body of `<h2>HTML check</h2>` was received by the recipient as exactly that
 * string). The signature and logo are appended by the mail service itself, so
 * they are deliberately NOT duplicated here.
 */
const buildEmailBody = (content) => `${content}

This is an automated MIS report. For real-time updates, please log in to the portal:
${PORTAL_URL}`;
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
 * Shared bearer gate. Each function calls this itself before doing any work, so
 * both verify auth independently (R3) and neither depends on the other having
 * run. It writes its own failure response, so a caller cannot forget to.
 *
 * Returns true when the request may proceed.
 */
const authorized = (req, res) => {
    const expected = process.env[API_KEY_SECRET];
    if (!expected) {
        console.error(`[mis] ${API_KEY_SECRET} is not configured for this function`);
        res.status(503).send("Server not configured.");
        return false;
    }
    const header = req.headers.authorization;
    const token = (header === null || header === void 0 ? void 0 : header.startsWith("Bearer ")) ? header.slice(7) : header;
    if (token !== expected) {
        res.status(401).send("Unauthorized");
        return false;
    }
    return true;
};
/**
 * `anchorId` is required on both endpoints: it is what makes them generic, and
 * requiring it means a missing parameter can never fan out into a mail run
 * across every Anchor.
 */
const readAnchorId = (req) => typeof req.query.anchorId === "string" ? req.query.anchorId.trim() : "";
const anchorIdRequired = (res, hint) => {
    res.status(400).json({ error: "anchorId is required.", hint });
};
/**
 * Limit-utilization report for ONE Anchor, scoped by `anchorId`.
 *
 * Generic by design: any Anchor can be asked for, and the caller names it.
 * `?test=true` redirects delivery to TEST_RECIPIENT and suppresses every other
 * recipient, including ANC011's external channel-finance mailbox.
 */
const runLimitReport = async (anchorId, isTest) => {
    const db = liveDb();
    const summary = {
        report: "limit",
        mode: isTest ? "test" : "live",
        scope: `anchor:${anchorId}`,
        usersConsidered: 0,
        emailsSent: 0,
        emailsSkipped: 0,
        emailsFailed: 0,
    };
    const anchor = await getAnchorByExternalId(db, anchorId);
    if (!anchor) {
        summary.note = "anchor-not-found";
        await recordRun(db, summary);
        return summary;
    }
    summary.usersConsidered = 1;
    // Test mode replaces every recipient: the Anchor is not mailed, and neither is
    // the external channel-finance mailbox.
    const candidates = isTest
        ? [TEST_RECIPIENT]
        : anchor.externalId === ANC011_EXTERNAL_ID
            ? [anchor.emailAddress, ANC011_EXTRA_RECIPIENT]
            : [anchor.emailAddress];
    const recipients = candidates.filter((to) => Boolean(to));
    if (recipients.length === 0) {
        summary.emailsSkipped = 1;
        summary.note = "anchor-has-no-email";
        await recordRun(db, summary);
        return summary;
    }
    // Count only — addresses are PII. This is what makes test mode checkable: it
    // reads 1 even for ANC011, instead of 2.
    console.log(`[mis] limit ${anchor.externalId}: sending to ${recipients.length} recipient(s)`);
    try {
        const dealers = await getDealerDataForAnchor(db, anchor.externalId);
        const csvFields = [
            { label: 'Dealer Name', value: 'dealerName' },
            { label: 'Sanctioned Limit', value: 'sanctionedLimit' },
            { label: 'Utilized Limit', value: 'utilizedLimit' },
            { label: 'Available Limit', value: 'availableLimit' },
            { label: 'Overdue Amount', value: 'overdueAmount' },
            { label: 'Status', value: 'status' }
        ];
        const csv = new json2csv_1.Parser({ fields: csvFields }).parse(dealers);
        const content = `Dear Team,

Please find below the Daily Limit Utilization Summary for ${anchor.userName}.

📊 Daily Limit Utilisation

The attached CSV contains the Dealer Tab View for all dealers mapped to this Anchor, providing a consolidated view of their current limit utilisation.

The report includes:
  • Dealer-wise sanctioned limit
  • Utilised limit
  • Available limit
  • Overdue amount`;
        const body = buildEmailBody(content);
        const reportDate = new Date().toISOString().split('T')[0];
        for (const to of recipients) {
            await sendEmail({
                to,
                subject: "Supermoney Daily Limit Utilization Summary",
                body,
                attachment: {
                    filename: `Limit_Utilization_${anchor.externalId}_${reportDate}.csv`,
                    content: csv,
                    contentType: "text/csv",
                },
            });
        }
        summary.emailsSent = 1;
    }
    catch (error) {
        summary.emailsFailed = 1;
        console.error(`[mis] limit send failed for ${anchor.externalId}:`, error);
    }
    await recordRun(db, summary);
    return summary;
};
/**
 * Overdue report for ONE Anchor.
 *
 * DEV ONLY — the overdue report is still being specified, so delivery is pinned
 * to TEST_RECIPIENT unconditionally and No Anchor can receive it yet. When the
 * report is signed off, replace the pinned recipient with the Anchor's own and
 * decide whether ANC011 (which today never receives an overdue summary) joins in.
 */
const runOverdueReport = async (anchorId) => {
    const db = liveDb();
    const summary = {
        report: "overdue",
        mode: "dev",
        scope: `anchor:${anchorId}`,
        usersConsidered: 0,
        emailsSent: 0,
        emailsSkipped: 0,
        emailsFailed: 0,
    };
    const anchor = await getAnchorByExternalId(db, anchorId);
    if (!anchor) {
        summary.note = "anchor-not-found";
        await recordRun(db, summary);
        return summary;
    }
    summary.usersConsidered = 1;
    try {
        const dealers = await getDealerDataForAnchor(db, anchor.externalId);
        const overdueDealers = dealers.filter((d) => d.overdueAmount > 0);
        if (overdueDealers.length === 0) {
            summary.emailsSkipped = 1;
            summary.note = "no-overdue-dealers";
            await recordRun(db, summary);
            return summary;
        }
        const totalOverdueAmount = overdueDealers.reduce((sum, d) => sum + d.overdueAmount, 0);
        const formattedAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalOverdueAmount);
        const csv = new json2csv_1.Parser({ fields: ["dealerName", "overdueAmount", "status"] }).parse(overdueDealers);
        const content = `Hello ${anchor.userName},

Here is the overdue summary for dealers mapped to your Anchor on the Supermoney Anchor Platform.

📊 Overdue Summary

Total overdue amount: ${formattedAmount}
Number of dealers with overdue payments: ${overdueDealers.length}`;
        const reportDate = new Date().toISOString().split('T')[0];
        await sendEmail({
            to: TEST_RECIPIENT,
            subject: "Supermoney Daily Overdue Report",
            body: buildEmailBody(content),
            attachment: {
                filename: `Daily_Overdue_${anchor.externalId}_${reportDate}.csv`,
                content: csv,
                contentType: "text/csv",
            },
        });
        summary.emailsSent = 1;
        console.log(`[mis] overdue ${anchor.externalId}: sent (dev mode, pinned recipient)`);
    }
    catch (error) {
        summary.emailsFailed = 1;
        console.error(`[mis] overdue send failed for ${anchor.externalId}:`, error);
    }
    await recordRun(db, summary);
    return summary;
};
/**
 * Both triggers share one runtime profile and one secret binding.
 *
 * `region('asia-south1')` is applied per-function below and is NOT optional:
 * without it a function silently defaults to us-central1, putting compute
 * outside India and reading the Mumbai Firestore cross-region (R18). Deploying
 * a new region does NOT move an existing function — a us-central1 copy would
 * remain under the same name and must be deleted separately.
 */
const RUNTIME = {
    timeoutSeconds: 540,
    memory: "512MB",
    secrets: [API_KEY_SECRET],
};
/**
 * Limit-utilization report — generic, one Anchor per call.
 *
 *   POST /sendLimitReports?anchorId=ANC011              → ANC011's real recipient
 *   POST /sendLimitReports?anchorId=ANC001&test=true    → ANC001's report, to TEST_RECIPIENT
 *
 * There is deliberately no "all Anchors" mode: `anchorId` is required, so this
 * endpoint cannot fan out. Requires `Authorization: Bearer <MIS_REPORT_API_KEY>`.
 */
exports.sendLimitReports = functions
    .region('asia-south1')
    .runWith(RUNTIME)
    .https.onRequest(async (req, res) => {
    if (!authorized(req, res)) {
        return;
    }
    const anchorId = readAnchorId(req);
    if (!anchorId) {
        anchorIdRequired(res, "POST /sendLimitReports?anchorId=ANC011[&test=true]");
        return;
    }
    try {
        const summary = await runLimitReport(anchorId, req.query.test === "true");
        console.log("[mis] limit run complete", JSON.stringify(summary));
        res.status(summary.note === "anchor-not-found" ? 404 : 200).json(summary);
    }
    catch (error) {
        console.error("[mis] limit run failed", error);
        res.status(500).json({ error: "Report run failed. Check function logs." });
    }
});
/**
 * Overdue report — DEV ONLY, delivery pinned to TEST_RECIPIENT.
 *
 *   POST /sendOverdueReports?anchorId=ANC001
 *
 * No Anchor receives this report yet. Requires the same bearer credential.
 */
exports.sendOverdueReports = functions
    .region('asia-south1')
    .runWith(RUNTIME)
    .https.onRequest(async (req, res) => {
    if (!authorized(req, res)) {
        return;
    }
    const anchorId = readAnchorId(req);
    if (!anchorId) {
        anchorIdRequired(res, "POST /sendOverdueReports?anchorId=ANC001");
        return;
    }
    try {
        const summary = await runOverdueReport(anchorId);
        console.log("[mis] overdue run complete", JSON.stringify(summary));
        res.status(summary.note === "anchor-not-found" ? 404 : 200).json(summary);
    }
    catch (error) {
        console.error("[mis] overdue run failed", error);
        res.status(500).json({ error: "Report run failed. Check function logs." });
    }
});
//# sourceMappingURL=index.js.map