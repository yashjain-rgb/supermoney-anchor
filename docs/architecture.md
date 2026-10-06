# Architecture Diagram

> **Auto-generated**. Last updated: 2026-05-07.
> When making architecture-level changes (new services, data stores, auth flows, external integrations, new Cloud Functions), update this diagram.

```mermaid
graph TB
    subgraph Browser["Browser (Client)"]
        AuthCtx["AuthProvider<br/>useAuth() context"]
        Login["Login Form<br/>email + password"]
        Pages["Pages (App Router)<br/>server + client components"]
        SessionClient["session-client.ts<br/>GET /api/session"]
    end

    subgraph NextServer["Next.js Server"]
        direction TB
        SA["Server Actions<br/>'use server'<br/>─ mutations ─"]
        API["API Routes<br/>/api/session<br/>/api/update-dealer-limit<br/>/api/upcoming-payments<br/>/api/upsert-invoice<br/>/api/get-dealer-id"]
        IronS["iron-session<br/>encrypt/decrypt cookie"]
        GenkitFlows["Genkit AI Flows<br/>ask-ai | risk-assessment<br/>extract-invoice-data"]
    end

    subgraph AI["AI Layer"]
        Gemini["Gemini 2.0 Flash<br/>via @genkit-ai/google-genai"]
        Tools["Data Tools<br/>getFullProgramData<br/>getFullInvoiceData<br/>getFullDealerData<br/>getFullLeadData"]
    end

    subgraph Data["Data Layer — Firebase Firestore"]
        DB1[("db1: anchorlink-g5wbd<br/>database: 'live'<br/>users | programs | dealers<br/>invoices | dealerLimits<br/>upcomingPayments | invoiceConsents")]
        DB2[("db2: supermoney-sales-hub<br/>default database<br/>dealers | vendors<br/>(momentum leads)")]
    end

    subgraph BgJobs["Background Jobs"]
        CF["Cloud Functions<br/>sendLimitReports<br/>sendOverdueReports<br/>(HTTPS triggers)<br/>Bearer: MIS_REPORT_API_KEY"]
        Scheduler["Cloud Scheduler<br/>daily cron"]
        MailAPI["Internal mail service<br/>live.supermoney.in<br/>/supermoney-service/email/send<br/>plain-text body + CSV attachment"]
    end

    subgraph External["External Consumers"]
        DealerAPI["External System<br/>POST /api/update-dealer-limit<br/>Bearer token auth"]
        DealerConsent["Dealers (no login)<br/>GET /consent?token=xxx<br/>approve/reject invoices"]
    end

    %% Auth flow
    Login -->|"authenticate()"| SA
    SA -->|"getUserByEmail()"| DB1
    SA -->|"set iron-session cookie"| IronS
    IronS -->|"encrypted cookie"| Browser
    SessionClient --> API
    API --> IronS

    %% Data flow
    Pages -->|"read (server)"| Data
    Pages -->|"mutate"| SA
    SA --> DB1
    Pages -->|"lead data"| DB2

    %% AI flow
    Pages -->|"user question"| GenkitFlows
    GenkitFlows --> Gemini
    GenkitFlows --> Tools
    Tools --> Data

    %% Background
    Scheduler --> CF
    CF --> DB1
    CF --> MailAPI

    %% External
    DealerAPI --> API
    DealerConsent --> Pages

    %% Auth context
    AuthCtx --> SessionClient

    style Browser fill:#e3f2fd
    style NextServer fill:#e8f5e9
    style AI fill:#fff3e0
    style Data fill:#fce4ec
    style BgJobs fill:#f3e5f5
    style External fill:#e0f2f1
```

## Component Map

| Layer | Key Files | Purpose |
|-------|-----------|---------|
| Auth | `src/app/auth/actions.ts`, `src/lib/session.ts`, `src/lib/session-client.ts`, `src/context/auth-context.tsx` | Iron-session cookie auth, client-side session check |
| Data | `src/lib/data.ts`, `src/lib/firebase.ts` | Two-Firestore data access, all reads/writes |
| AI | `src/ai/genkit.ts`, `src/ai/flows/*.ts`, `src/ai/tools/data-tools.ts` | Genkit + Gemini flows |
| UI Layout | `src/app/layout.tsx`, `src/components/nav.tsx` | AuthProvider + role-based sidebar |
| Background | `src/functions/index.ts` | Cloud Function for daily reports |
| External API | `src/app/api/*/route.ts` | REST endpoints for external systems |

## Key Flows

### Invoice Lifecycle
```
Initiated → Approved → Sent to Lender → Consent Approved → Disbursed
                 ↘ Rejected (any point)
```

### Dealer Onboarding Pipeline
```
Lead Created → Lead Verified → Documents Collected → Documents Verified
    → Site Visit Done → Business Limit Approved → Dealer Activated
```

### Role Hierarchy
```
Admin ─── full access, user management
SuperMoney User ─── Admin minus user management
Anchor ─── scoped to their externalId
  ├─ sales_person       → add leads
  ├─ sales_manager      → validate leads
  ├─ onboarding_ops     → verify documents
  ├─ field_inspector    → site visit reports
  ├─ legal_compliance   → document + site verification
  ├─ regional_manager   → credit check + limit approval
  └─ dealer_admin       → final activation
```
