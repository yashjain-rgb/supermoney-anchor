# Self-Review Checklist

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** before declaring code done.
> This is the pass/fail gate. Each section's rules are stated in full in its owning module — linked in the heading.

---

Before declaring code done, verify every item:

### Security (Zero tolerance — every item must pass for VAPT readiness)

> Rules: `security.md`

- [ ] No secrets exposed to client (check `NEXT_PUBLIC_*`, props, network tab)
- [ ] Every Server Action independently verifies auth + authorization
- [ ] All user input validated with Zod before processing
- [ ] HTTP security headers configured (CSP, HSTS, X-Frame-Options, etc.)
- [ ] No `dangerouslySetInnerHTML` without explicit sanitization
- [ ] File uploads: MIME type checked, size limit enforced (nginx 1 MB body limit respected)
- [ ] Error messages sanitized — no raw `error.message`, stack traces, or paths in responses
- [ ] Sensitive endpoints are rate-limiter-ready (ISO A.12.6) — implementation deferred, design required
- [ ] No base64 blobs stored in Firestore (use Firebase Storage)
- [ ] No auth tokens in `localStorage`/`sessionStorage`
- [ ] New AI flows: auth check as the FIRST line; PII masked before sending to the LLM
- [ ] Sensitive operations logged with actor + target + timestamp (audit trail)

### VAPT Compliance (Per-Change)

> Rules: `security.md`

- [ ] **Authentication bypass** — no endpoint or flow works without server-side auth
- [ ] **Authorization bypass** — RBAC check is at the data access layer, not just UI hiding
- [ ] **Information disclosure** — error responses, headers, and client bundle reveal no internals
- [ ] **Injection** — all user input reaches Zod before any processing; HTML output is sanitized
- [ ] **Session management** — auth state is not in client-reachable storage
- [ ] **Missing security headers** — CSP and Permissions-Policy evolve with new features
- [ ] **Resilience** — graceful degradation implemented for AI/external service failures; core UI never blocks on AI

### Architecture

> Rules: `architecture.md`

- [ ] Server Components used by default; `'use client'` only on interactive leaves
- [ ] No duplicate logic — shared logic extracted into hooks/utilities
- [ ] Props ≤ 7, component lines ≤ 150
- [ ] Every async page has `loading.tsx` and `error.tsx`
- [ ] Barrel exports reviewed for tree-shaking impact

### Performance

> Rules: `frontend.md` § Performance

- [ ] All images use `next/image` with explicit width/height
- [ ] Hero/above-fold images marked `priority`
- [ ] Heavy components lazy-loaded with `next/dynamic`
- [ ] Third-party scripts deferred with `strategy="lazyOnload"`
- [ ] Fonts self-hosted or optimized via `next/font`
- [ ] No `useEffect` data fetching — data fetched in Server Components

### TypeScript

> Rules: `frontend.md` § TypeScript

- [ ] No `any` without explicit justification comment
- [ ] Component props use `interface`
- [ ] Hooks have explicit return types
- [ ] Discriminated unions for async/multi-state logic

### Accessibility

> Rules: `frontend.md` § Accessibility (WCAG 2.2 AA)

- [ ] Semantic HTML elements used appropriately
- [ ] All images have appropriate `alt` text
- [ ] Form inputs have associated labels
- [ ] Keyboard navigation works end-to-end
- [ ] Color contrast meets 4.5:1 minimum

### Testing

> Rules: `testing.md`

- [ ] Happy path tested
- [ ] Error states tested
- [ ] Empty/null states tested
- [ ] Edge cases: empty array, missing fields, timeout scenarios
- [ ] Security tests: 401 / 403 / 400 for new endpoints and Server Actions
