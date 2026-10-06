# Security, Compliance & Privacy

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** touching auth, PII, secrets, security headers, file uploads, dependencies, logging, or AI/LLM prompts.
> Related: `architecture.md` (Server Action auth pattern), `anti-patterns.md` (AP-5, AP-9, AP-10, AP-11), `self-review.md`.

---

## Compliance Target

This project is being hardened for **cert-in / ISO 27001:2022 / VAPT** readiness (see `SECURITY_REMEDIATION_PLAN.md` at the repo root). Every change must advance — never regress — the security, resilience, auditability, and privacy of the system.

### Mandatory Controls Checklist (ISO 27001:2022)

| Control | Requirement | Project Status |
|---|---|---|
| **A.8.11** Data masking | Mask PII (PAN, Aadhaar, GSTIN, phone, bank) outside authorized roles; mask before sending to LLMs | ⚠️ PII sent to Gemini for OCR extraction — mask before AI calls |
| **A.8.12** Data leakage prevention | File uploads size-capped; no data exfiltration via email/AI | ⚠️ nginx 1MB limit; 50MB server action limit is a DoS surface |
| **A.8.15 / A.8.16** Logging & monitoring | Audit trail of admin/sensitive operations; SIEM-ready structured logs | ❌ Not implemented |
| **A.8.20** Network security | Origin/referer validation, no open proxies | ⚠️ No middleware; Server Actions rely on built-in origin check |
| **A.8.24** Cryptography | Secrets in env only, httpOnly session cookies, TLS | ✅ iron-session httpOnly cookies; secrets server-side |
| **A.8.25** Secure development lifecycle | No `ignoreBuildErrors`, dependency scanning (SCA), SAST | ❌ `ignoreBuildErrors: true` set in `next.config.ts` |
| **A.9.1 / A.9.2** Access control | Server-side auth + RBAC on every Server Action, Route Handler, Cloud Function | ✅ Session auth on Server Actions / Route Handlers; `sendDailyReports` bearer-authenticated via `MIS_REPORT_API_KEY` |
| **A.9.4** Secret management | Zero secrets on client; env vars only | ✅ `NEXT_PUBLIC_*` only for Firebase config |
| **A.10.1** Cryptography | TLS in transit, strong password policy, secret rotation | ⚠️ Verify HSTS; rotate `SECRET_COOKIE_PASSWORD` / `DEALER_API_SECRET_KEY` |
| **A.12.1** Input validation | Zod on every server boundary | ⚠️ Validate in all Server Actions + Route Handlers |
| **A.12.2** Output encoding | Sanitized error messages; no unsanitized HTML | ❌ Not consistently applied |
| **A.12.5** Malware / command control | Security headers (CSP, HSTS, X-Frame-Options, etc.) | ❌ **Not configured** in `next.config.ts` — required |
| **A.12.6** Resource management | Rate limiting on auth, AI, email, public endpoints — **required for future use, not mandatory for now** | ⚠️ Deferred — new sensitive endpoints must be rate-limiter-ready (no rework later) |
| **A.12.7** Ops security | Incident-ready error boundaries, graceful degradation | ❌ No global error boundary |
| **A.14.2** Secure engineering | CI gates: lint, typecheck, tests, `npm audit` | ❌ Not in CI |
| **A.16.1** Incident management | Error boundaries, health check, structured errors | ❌ Partially |
| **A.17.1** Business continuity | Firestore backup strategy, DR plan | ❌ Not documented |
| **A.18.1** Privacy (GDPR / DPDP Act 2023) | PII inventory, data retention, right-to-erasure, data minimization | ❌ Not documented |

> **cert-in:** Per Indian CERT guidelines, maintain a **180-day tamper-proof audit trail** of sensitive operations and reportable incident logging. GDPR/DPDP: process Indian personal data (GSTIN, PAN, bank accounts, phone numbers) lawfully, minimize collection, and support erasure.

---

## Security — VAPT / ISO 27001 / cert-in Ready

> **VAPT = Vulnerability Assessment and Penetration Testing. cert-in = Indian Computer Emergency Response Team guidelines (180-day audit trail, data localization, reportable incidents).** Every rule in this section directly impacts audit findings. Zero exceptions.

### Known Security Gaps (Do Not Reintroduce / Fix When Touched)

The following were confirmed in the codebase (see `SECURITY_REMEDIATION_PLAN.md` at the repo root) — **do not write code that depends on these holding**, and fix them when your change touches the area:

| Gap | Location | Impact |
|---|---|---|
| `ignoreBuildErrors: true` + `ignoreDuringBuilds: true` | `next.config.ts` | VAPT blocker — TS/ESLint errors ship to production |
| No security headers (CSP, HSTS, X-Frame-Options…) | `next.config.ts` | A.12.5 — configure the header block below |
| No middleware / route-level auth guard | repo-wide | Server Actions are the only protected surface; API routes rely on per-route checks |
| Base64 file blobs stored in Firestore (`invoiceConsents`) | consent flow | Exceeds Firestore 1 MiB document cap; migrate to Firebase Storage |
| nginx 1 MB body limit vs `bodySizeLimit: '50mb'` | `next.config.ts` + nginx | 50 MB server-action body is a DoS vector; client-side size validation added — keep it |
| `sendDailyReports` Cloud Function is publicly invokable at the IAM layer | `src/functions/index.ts` | `allUsers` holds `roles/cloudfunctions.invoker`, so anyone can reach the URL and only the in-code bearer check gates it. No rate limit (A.12.6 deferred) — a publicly reachable endpoint that sends email should be rate-limited before wide exposure |
| `DEALER_API_SECRET_KEY` shared across all seven VM API routes | `api/update-dealer-limit`, `api/upsert-invoice`, `api/get-dealer-id`, `api/upcoming-payments`, `api/partial-update-dealer-limit`, `api/run-mis-task`, `sendDailyReports` (route) | One shared bearer secret guards every external route on the VM, so any exposure requires rotating all of them. The Cloud Function no longer shares it — it uses its own `MIS_REPORT_API_KEY` (A.9.4 / A.10.1) |
| Manual MIS route returns raw `error.message` + `error.code` | `src/app/sendDailyReports/route.ts:197` | Leaks gRPC codes and internals to the caller (A.12.2) |
| No structured audit log / no dependency scanning | repo-wide | A.8.15, A.8.25 findings |

### Authentication & Authorization

- Verify auth in **every** Server Action, Route Handler, and protected page — never only at the layout level. Layouts can render without re-running their auth check.
- Use **`httpOnly`**, **`Secure`**, and **`SameSite=Lax`** cookies for session tokens (iron-session already does this). Never store tokens in `localStorage` (XSS-vulnerable).
- Implement **role-based access control (RBAC)** (ISO A.9.2). Check permissions inside the protected resource, not just at the route level. Roles: `Admin`, `SuperMoney User`, `Anchor` (with sub-roles `sales_person`, `sales_manager`, `onboarding_ops`, `field_inspector`, `legal_compliance`, `regional_manager`, `dealer_admin`).
- Protect against **CSRF**: Next.js 15+ Server Actions include built-in origin-based CSRF protection. For Route Handlers, use token-based CSRF if cookie-based auth is used.

### Input Validation

- **Validate everything from the client.** Every Server Action parameter, every Route Handler body, every URL param. Use Zod schemas — never trust raw input.
- Sanitize user-generated content before rendering to prevent XSS. React's JSX escapes by default, but `dangerouslySetInnerHTML` and third-party rendering bypass this.
- Validate **file uploads**: check MIME type (not just extension), enforce size limits (client-side cap ~5 MB to stay under the nginx 1 MB body limit for base64 payloads — keep the existing validation), scan for malware.

### Error Sanitization (OWASP Information Disclosure)

- **Never** return raw `error.message`, stack traces, or internal file paths to the client.
- Wrap all route-handler failures in a sanitized error formatter; log the detail server-side with a correlation ID.

```ts
// ✅ Sanitized — client sees a safe message, detail stays server-side
try {
  await doThing();
} catch (error) {
  console.error('[corr-abc123] doThing failed', error);   // detail → server log
  throw new Error('Something went wrong');                 // safe message → client
}
```

### Rate Limiting (ISO A.12.6) — Required for Future Use, Not Mandatory Now

- **Deferred by project decision (2026-08-21):** rate limiting is not a current release gate. It is a **design requirement** — new endpoints for authentication (login attempts), AI/Genkit flows (credit burn), file uploads, and public-facing APIs must be structured so a limiter can be added without rework.
- When implemented: in-memory sliding-window limiter is acceptable at current scale; key by session user + IP.

### Secrets & Environment

- **`NEXT_PUBLIC_*`** values are baked into the client bundle at build time and visible to anyone. Use only for non-sensitive config (Firebase Web SDK config). **Never** for API keys, secrets, tokens, or credentials.
- Store secrets in environment variables (server-only). Access via `process.env.SECRET` — never via `NEXT_PUBLIC_SECRET`.
- **Never hardcode fallback values for secrets** in source code (e.g., the historical `'complex_password_at_least_32_characters_long'` fallback for `SECRET_COOKIE_PASSWORD` — removed; if missing, throw at boot).
- Key secrets: `SECRET_COOKIE_PASSWORD`, `GEMINI_API_KEY` / `SECRET_GEMINI_API_KEY`, `DEALER_API_SECRET_KEY`, SMTP credentials.
- Use Next.js's built-in **taint** APIs (`taintObjectReference`, `taintUniqueValue`) to prevent sensitive data from accidentally leaking to the client.

### HTTP Security Headers (Required — Not Yet Configured)

Configure these in `next.config.ts` (currently missing — this is a P0 VAPT finding):

```ts
// ✅ Essential VAPT headers (ISO A.12.5)
headers: async () => [{
  source: '/(.*)',
  headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-XSS-Protection', value: '0' },          // Deprecated; CSP replaces this
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self';" },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ],
}],
```

### Dependency Security (ISO A.8.25)

- Run `npm audit` regularly. Fix critical/high vulnerabilities immediately — gate the build on them in CI.
- Keep Next.js, React, and authentication libraries on the latest patch version.
- Use `npm audit signatures` to verify package integrity.
- Minimize dependencies. Every third-party package is a potential supply-chain attack vector. Known unmaintained packages: `xlsx@0.18.5` (CVE-2024-22363 prototype pollution, CVE-2024-22362 ReDoS) — migrate to `exceljs` or similar.

---

## Observability & Logging (ISO A.12.7 / A.8.15)

> **cert-in mandates a 180-day tamper-proof audit trail** of sensitive operations. Log, don't console-dump.

### Logging Standards

```ts
// ✅ Good — structured, searchable, no PII in the log message
logger.info('Dealer limit updated', {
  dealerId: 'ANC001',
  limitType: 'lifetimeSanction',
  actor: 'user-abc123',
  timestamp: new Date().toISOString(),
});

// ❌ Bad — unstructured, leaks PII
console.log(`Dealer ${dealer.email} limit updated by ${user.name}`);
```

### Audit Trail (Required for Sensitive Operations)

Log with actor + target + timestamp + result for: user creation, role changes, dealer limit updates, invoice consent changes, dealer activation, data exports, and AI extraction of invoice data.

Format: `{ level, event, actorId, targetId, result, timestamp, metadata }` — structured JSON, no PII in the log message.

### Error Tracking (Target)

- Structured error aggregation (Sentry or equivalent) for client + server errors.
- Health check endpoint (`GET /api/health`) returning DB connectivity + service status.

---

## Data Protection & Privacy (ISO A.18.1 / GDPR / DPDP Act 2023)

### PII Inventory

The system stores:
- User emails, names, phone numbers (`users`)
- Dealer PII: GSTIN, PAN, Aadhaar (masked), bank account numbers, addresses, phone (`dealers`, `dealerLimits`)
- Invoice data extracted by AI (includes dealer PII — sent to Gemini 2.5 Flash for OCR extraction; **mask/minimize before sending**)
- `invoiceConsents` — consent documents with file attachments

### Data Minimization

- Don't log PII in console or error messages.
- Don't include full dealer/user objects in API responses unless needed — return only required fields.
- Mask sensitive fields (PAN, Aadhaar, account numbers) outside authorized roles.
- Mask PII before sending data to LLMs (A.8.11) — no raw GSTIN/phone/address in AI prompts.

### Data Retention & Erasure

- Define and document retention periods per collection (invoices, consents, audit logs).
- **Right to erasure (GDPR Art. 17 / DPDP):** support deleting a dealer/user with cascading anonymization of associated logs — never leave PII in deleted entities' audit history.
- Back up Firestore (scheduled exports to GCS) — required for A.17.1 business continuity.
