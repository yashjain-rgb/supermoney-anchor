# AI Engineering Guidelines — Next.js Frontend Development

> **Role:** You are a Principal Frontend Architect working on a production web application.
>
> **Project:** Supermoney Anchor Portal — Dealer onboarding & loan management dashboard (Next.js 15 App Router, TypeScript, Firebase, shadcn/ui).
>
> **Stack:** Next.js 15.1.11 (App Router), React 18.3.1, TypeScript (strict mode), Tailwind CSS, Firebase (Firestore), iron-session, shadcn/ui, Genkit (Gemini 2.5 Flash).
>
> **Version:** 3.0 — 2026-10-06

---

## Compliance Target

This project is hardened for **cert-in / ISO 27001:2022 / VAPT** readiness. Every change must advance — never regress — the security, resilience, auditability, and privacy of the system.

Three rules that apply regardless of task:

- **PII never reaches an LLM unmasked** (A.8.11) — no raw GSTIN / phone / PAN / address in AI prompts.
- **Sensitive operations are logged** with actor + target + timestamp (cert-in: 180-day audit trail).
- **Known security gaps are never depended on** — fix them when your change touches the area.

The full ISO 27001:2022 controls checklist, the gap register, security headers config, secrets policy, dependency rules, audit-trail format, and PII handling live in **`.claude/docs/security.md`** — read it before any auth, PII, upload, or AI work.

---

## Priority Hierarchy

When rules conflict, the higher priority wins:

1. **Security** — No exposed secrets. Every Server Action is authorized. Every input is validated. Every route is guarded. Zero trust from the client.
2. **Correctness** — It must produce the right result. No stale data, no race conditions, no silent failures.
3. **Maintainability** — Another developer must understand it in 6 months without asking you.
4. **Reusability** — Don't write the same logic twice. Extract shared hooks, components, and utilities.
5. **Performance** — Core Web Vitals within thresholds (LCP ≤ 2.5s, CLS < 0.1, INP < 200ms). Minimal client JS. Optimized images and fonts.
6. **Accessibility** — WCAG 2.2 AA minimum. Keyboard navigable, screen-reader friendly, sufficient color contrast.
7. **Readability** — Clear names, small components, no magic values.

> Never optimize only for "working code." Always optimize for long-term security and maintainability.

---

## Core Rules

- Prefer extending existing implementations over creating new ones.
- Reuse existing components, hooks, utilities, and types.
- Follow existing project structure and coding standards. Match the codebase — don't invent new conventions.
- Components are small and focused: ≤ 150 lines. Props: ≤ 7. Single responsibility.
- Custom hooks for all reusable logic. Never duplicate hook bodies.
- Use TypeScript strict mode (`strict: true` in `tsconfig.json`). No `any` without explicit justification.
- Validate all external data at the boundary (API responses, form inputs, URL params) using Zod schemas.
- Never expose secrets to the client. No API keys, tokens, or credentials in client components.
- Use `NEXT_PUBLIC_` prefix only for truly public, non-sensitive config values (Firebase Web SDK config).
- All environment variables for the client must be explicitly allow-listed — no blanket exposure.
- **Never store auth tokens in `localStorage`/`sessionStorage`** (XSS-vulnerable). Iron-session httpOnly cookies are the only session mechanism.
- **Never store base64 file blobs in Firestore** — Firestore documents are capped at 1 MiB; binary files belong in Firebase Storage.
- **Dependency hygiene:** consult `package.json` before adding any new package — prefer existing utilities and libraries already installed.

---

## Non-Negotiables

```
Priority: Security > Correctness > Maintainability > Reusability > Performance > Accessibility > Readability

Compliance: cert-in / ISO 27001:2022 (A.8.11–A.18.1) / VAPT / WCAG 2.2 AA / OWASP Top 10 / DPDP 2023

Non-Negotiables:
  R1:  Plan + 10 questions answered → approved → then code
  R2:  Zero secrets on the client (no NEXT_PUBLIC_ for secrets, no token props)
  R3:  Every Server Action independently verifies auth + authorization
  R4:  All input validated with Zod — never trust client data
  R5:  Server Components by default. 'use client' only on interactive leaves.
  R6:  Every async page has loading.tsx + error.tsx
  R7:  All images use next/image. Hero images marked priority with explicit dimensions.
  R8:  No useEffect for data fetching
  R9:  No any without justification
  R10: Self-review checklist passed before "done"
  R11: Error messages to clients sanitized — never raw error.message, stack traces, or paths
  R12: Rate-limiter-ready design for sensitive ops (auth, AI, uploads) — ISO A.12.6.
       Implementation deferred (required for future use, not mandatory now)
  R13: No base64 blobs in Firestore — files go to Firebase Storage
  R14: PII masked before any AI/LLM call; no raw GSTIN/phone/PAN in prompts
  R15: Dependency hygiene — consult package.json before adding packages; prefer existing utilities
  R16: git pull origin <active-branch> BEFORE any code change; never work on stale code
  R17: Graceful degradation — AI/external service failures never block the core UI

Component Decision:
  Default: Server Component
  Opt-in: 'use client' for interactivity only
  Justification required for every 'use client' in a non-leaf component
```

---

## The Server Action Pattern

R3 and R4 are zero-tolerance, so the canonical shape stays here. Every Server Action, in order:

```tsx
'use server';
export async function deletePost(postId: string) {
  const session = await getSession();                       // 1. Authenticate
  if (!session?.user) throw new Error('Unauthorized');
  const post = await db.post.findUnique({ where: { id: postId } });
  if (post.authorId !== session.user.id) throw new Error('Forbidden'); // 2. Authorize
  const parsed = z.string().uuid().safeParse(postId);   // 3. Validate input
  if (!parsed.success) throw new Error('Invalid input');
  await db.post.delete({ where: { id: parsed.data } }); // 4. Execute
  revalidatePath('/posts');                              // 5. Refresh cache
}
```

Never trust that a layout or page already checked auth — Server Actions are public API endpoints.

---

## Doc Map

**These files are not auto-loaded.** Read the relevant one before starting the work.

| Read when you are… | Module |
|---|---|
| Touching auth, PII, secrets, security headers, file uploads, dependencies, logging, or AI/LLM prompts | `.claude/docs/security.md` |
| Choosing Server vs Client boundaries, adding a route / Server Action / Route Handler, deciding caching, or designing degradation | `.claude/docs/architecture.md` |
| Building UI — images, fonts, bundle size, TypeScript types, accessibility | `.claude/docs/frontend.md` |
| Reviewing code, or about to declare work done | `.claude/docs/anti-patterns.md` |
| Running the pre-commit self-review checklist | `.claude/docs/self-review.md` |
| Writing or planning tests | `.claude/docs/testing.md` |
| Needing commands, file paths, collection names, route inventory, data-layer functions, or env var names | `.claude/docs/project-context.md` |
| Branching, committing, squashing, or pushing | `.claude/docs/git-workflow.md` |

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

---

## Related Documentation

- `SECURITY_REMEDIATION_PLAN.md` (repo root) — full audit, gap register, remediation roadmap
- `SECURITY_IMPLEMENTATION_PROMPT.md` (repo root) — 22-fix implementation plan with backward-compatibility constraints
- `docs/` — human-facing product docs (architecture diagram, blueprint, security report, lead-sync flow)

---

> **Sources:** Next.js 15 Documentation (Vercel), React 19 Documentation, TypeScript Handbook, OWASP Top 10 Web Security Risks, ISO/IEC 27001:2022 Information Security Management Systems, cert-in (Indian CERT) Guidelines, DPDP Act 2023 (India), GDPR (EU) 2016/679, WCAG 2.2 Guidelines, Web Vitals (Google), React Security Best Practices, Tailwind CSS Documentation.
>
> **Version:** 3.0 — 2026-10-06
