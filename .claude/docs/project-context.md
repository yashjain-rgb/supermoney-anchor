# Project Context — Commands, Data Layer, Routes

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** you need commands, file paths, collection names, route inventory, data-layer functions, or environment variable names.

---

## Commands

```bash
npm run dev          # Next.js dev server with Turbopack on port 9002 (loads .env via dotenv-cli)
npm run build        # Production build
npm run start        # Start production server on port 3002
npm run lint         # Run ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit)

# AI (Genkit)
npm run genkit:dev   # Genkit dev UI + AI flows

# Firebase
npm run deploy       # Deploy Cloud Functions (firebase deploy --only functions)
```

## Deployment

`live` runs on a **self-hosted VM** — this is permanent, not a migration state.

- Next.js server runs under **PM2** (process `anchor-dashboard-live`) behind **nginx**
- Deployed by `.github/workflows/production.yml` (self-hosted runner): rsyncs GitHub `live` → GitLab (`gitlab.mintwalk.com`), force-pushing to that repo
- `apphosting.yaml` exists in the repo but **App Hosting is not the live target** — its Secret Manager entries do not apply to the VM, which reads env vars from its own `.env`
- `firebase.json` deploys **only** Cloud Functions (`npm run deploy`)

### Admin SDK credentials on the VM

Anything using the **Firebase Admin SDK** on the VM needs an explicit, properly-scoped credential. `initializeApp()` with no arguments falls back to host ADC, and the VM's metadata token lacks the Datastore scope. Symptom:

```
7 PERMISSION_DENIED: Request had insufficient authentication scopes
```

Only one Next.js file uses the Admin SDK — `src/app/sendDailyReports/route.ts`. The entire data layer (`src/lib/data.ts`) uses the **client SDK** (`src/lib/firebase.ts`, `NEXT_PUBLIC_FIREBASE_*` API key) and is unaffected by this constraint. **Do not copy Cloud Function code into the Next.js runtime**: `admin.initializeApp()` is implicitly credentialed inside Cloud Functions but not in a self-hosted Node process.

## Two-Firestore Architecture

The app connects to **two separate Firebase projects**, initialized in `src/lib/firebase.ts`:

- **`db1`** (`anchorlink-g5wbd`, database `live`) — Primary app data: `users`, `programs`, `dealers`, `invoices`, `dealerLimits`, `upcomingPayments`, `invoiceConsents`
- **`db2`** (`supermoney-sales-hub`, default database) — Sales/momentum dealer leads in `dealers` and `vendors` collections

## Authentication & Sessions

Iron-session (encrypted cookies) — **not** Firebase Auth. The flow:

1. `src/app/auth/actions.ts` — `authenticate()` validates email/password against Firestore `users` collection, creates an iron-session cookie
2. `src/lib/session.ts` — Server-side session reading (`getSession()` reads + decrypts the cookie). **No hardcoded fallback password** — throw at boot if `SECRET_COOKIE_PASSWORD` is missing
3. `src/lib/session-client.ts` — Client-side session fetch via `GET /api/session` (calls iron-session server-side)
4. `src/context/auth-context.tsx` — `AuthProvider` wraps the app, checks session on mount, redirects to `/` if unauthenticated

## Roles & Navigation

Three role types (`UserRole`): `"Admin"`, `"SuperMoney User"`, `"Anchor"`.

Anchor users have sub-roles (`UserSubRole`) for the dealer onboarding workflow: `sales_person`, `sales_manager`, `onboarding_ops`, `field_inspector`, `legal_compliance`, `regional_manager`, `dealer_admin`. Navigation links are filtered by sub-role in `src/components/nav.tsx`.

Login redirect: Admin → `/add-program`, SuperMoney User → `/add-invoice`, Anchor → `/dashboard`. Special user `biu@supermoney.in` redirects to `/select-anchor` (multi-anchor switcher).

## Route Structure

Each feature follows the pattern: `/src/app/<feature>/` with:
- `page.tsx` — Server component (or thin wrapper)
- `client-page.tsx` — Client-side interactive component (when needed)
- `actions.ts` — Server actions (`"use server"`) for data mutations

**Pages**: dashboard, dealers, invoices, leads, programs, retailers, reports, settings, psbx, select-anchor, upcoming-payments, risk-assessment, consent, subscribe
**Admin-only**: add-program, add-dealer, add-invoice, add-dealer-limit, add-anchor (add user), add-lead, add-leads-bulk, update-gst, update-region, update-email, view-users
**Dealer onboarding (subscription-gated)**: onboarding-dashboard, dealer-leads, dealer-documents, site-visits, business-limit, dealer-activation, collection-dashboard
**API routes**: `api/session`, `api/upsert-invoice`, `api/update-dealer-limit` (guarded by `DEALER_API_SECRET_KEY`), `api/create-dealer`, `api/get-dealer-id`, `api/upcoming-payments`

## Data Layer

`src/lib/data.ts` is the central data access layer. Key functions:
- `getPrograms(anchorId?, region?)` — Aggregates programs with computed stats from dealers, limits, invoices
- `getDealers(anchorId?, region?)` — Dealers with joined limit/invoice/program data
- `getInvoices(anchorId?, region?)` — Invoices filtered by dealer visibility
- `getMomentumDealerLeads(anchorId?)` — From `db2`, merges `dealers` and `vendors` collections
- `getUserByEmail(email)` — Lookup user for auth

All Timestamps are converted to ISO strings via `processDocumentDates()` helper.

## AI (Genkit)

Configured in `src/ai/genkit.ts` — uses **Gemini 2.5 Flash** via `@genkit-ai/google-genai`.

- `src/ai/flows/ask-ai-flow.ts` — Ask-anything assistant with tools to query programs, invoices, dealers, leads
- `src/ai/flows/risk-assessment.ts` — AI risk scoring for dealers
- `src/ai/flows/extract-invoice-data-flow.ts` — OCR-like invoice data extraction (**receives dealer PII — mask before sending, A.8.11**)
- `src/ai/tools/data-tools.ts` — Genkit tools wrapping `src/lib/data.ts` functions

## Cloud Functions

`src/functions/index.ts` exports one — the on-demand MIS trigger:

- **`sendDailyReports`** (HTTPS trigger, `us-central1`, 1st gen, 540s / 512MB) — per-Anchor emails with CSV attachments, recipients resolved from the live DB `users` where `roleType == "Anchor"`. Runs in the Cloud Functions runtime, where `admin.initializeApp()` is implicitly credentialed. Reads the named `live` database via the modular `getFirestore(app, "live")`; the namespaced `admin.firestore(x)` form takes an App, not a database id, so it cannot select a named database.
  - Auth: `Authorization: Bearer <MIS_REPORT_API_KEY>` (Secret Manager — **not** `DEALER_API_SECRET_KEY`)
  - `?anchorId=ANC011` — scope the run to one anchor; omit for all anchors
  - `?test=true` — one report to the test recipient instead of real recipients
  - No schedule and no once-per-day guard: it sends exactly when called, so the caller owns the frequency

There is deliberately **no scheduled export**. To run it daily, point Cloud Scheduler at the function URL with a bearer header — adding an in-function schedule alongside a scheduler hitting the same URL would double-send.

## Daily MIS Report — who gets emailed

Recipients are data-driven, not hardcoded. Source: `live` DB, `users` where `roleType == "Anchor"`, skipping empty `emailAddress`.

| Case | Recipients |
|---|---|
| `externalId === 'ANC011'` | the user's `emailAddress` + `channelfinance.in@redingtongroup.com` |
| All other Anchors | the user's `emailAddress` only, and only if they have ≥1 dealer with `overdueAmount > 0` |
| `?test=true` | a single test address, first Anchor user only, then returns |

Each Anchor receives only their own dealers, scoped by `anchorId === user.externalId`. Two implementations still exist and have drifted: the Cloud Function `sendDailyReports` (the working one, bearer-authenticated), and the portal route `src/app/sendDailyReports/route.ts` (triggered by `src/app/api/run-mis-task/route.ts`, Admin session required — **still broken**, since it uses the Admin SDK in the Next.js runtime where `initializeApp()` falls back to host ADC and lacks the Datastore scope). The route duplicates the function's logic — it inlines `getDealerDataForAnchor` rather than sharing it. `api/run-mis-task` POSTs to `${NEXT_PUBLIC_BASE_URL}/sendDailyReports`, i.e. the route, **not** the Cloud Function.

## UI

shadcn/ui components (Radix UI primitives) in `src/components/ui/`. Tailwind CSS with custom theme. Recharts for charts. `src/lib/utils.ts` exports the standard `cn()` classname merger.

## Key Environmental Variables

- `SECRET_COOKIE_PASSWORD` — Iron-session encryption key (**required — no fallback**)
- `GEMINI_API_KEY` / `SECRET_GEMINI_API_KEY` — Google AI API key
- Firebase config via `NEXT_PUBLIC_FIREBASE_*` (project 1) and `NEXT_PUBLIC_FIREBASE_*_2` (project 2)
- SMTP credentials — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `DEALER_API_SECRET_KEY` — Secures the dealer limit update API
