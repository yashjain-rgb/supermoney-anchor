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

`src/functions/index.ts` — `sendDailyReports` (HTTPS trigger): sends daily overdue summary emails to all Anchor users with CSV attachments. Configured with SMTP secrets. Runs via Cloud Scheduler. **⚠️ The HTTPS trigger has no authentication — invoke a fix when the area is touched (A.9.1).**

## UI

shadcn/ui components (Radix UI primitives) in `src/components/ui/`. Tailwind CSS with custom theme. Recharts for charts. `src/lib/utils.ts` exports the standard `cn()` classname merger.

## Key Environmental Variables

- `SECRET_COOKIE_PASSWORD` — Iron-session encryption key (**required — no fallback**)
- `GEMINI_API_KEY` / `SECRET_GEMINI_API_KEY` — Google AI API key
- Firebase config via `NEXT_PUBLIC_FIREBASE_*` (project 1) and `NEXT_PUBLIC_FIREBASE_*_2` (project 2)
- SMTP credentials — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `DEALER_API_SECRET_KEY` — Secures the dealer limit update API
